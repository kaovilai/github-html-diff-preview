import { describe, expect, it } from "vitest";
import { FetchError, FileFetcher } from "../../src/core/fetcher";
import { DEFAULT_SETTINGS, type Settings } from "../../src/core/settings";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const file = { owner: "o", repo: "r", ref: "main", path: "dir/a.html" };

const make = (handler: Handler, settings: Partial<Settings> = {}) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let time = 1_000_000;
    const fetcher = new FileFetcher({
        fetch: async (input, init) => {
            const url = String(input);
            calls.push({ url, init });
            const response = await handler(url, init);
            // Response.url is read-only and empty for synthetic responses, so emulate what a real redirect reports
            Object.defineProperty(response, "url", { value: (response as { finalUrl?: string }).finalUrl ?? url });
            return response;
        },
        getSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
        now: () => time
    });
    return { fetcher, calls, advance: (ms: number) => { time += ms; } };
}

const text = (body: string, init: ResponseInit = {}) => new Response(body, init);
const redirected = (body: string, finalUrl: string) => Object.assign(new Response(body, { headers: { "content-type": "text/plain" } }), { finalUrl });

describe("FileFetcher", () => {
    it("fetches through the browser's github.com session first, with credentials", async () => {
        const { fetcher, calls } = make(url => url.startsWith("https://github.com/") ? text("<p>hi</p>") : text("", { status: 500 }));
        expect(await fetcher.fetchText(file)).toBe("<p>hi</p>");
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://github.com/o/r/raw/main/dir/a.html");
        expect(calls[0].init?.credentials).toBe("include");
    });

    it("follows the private-repo redirect to raw.githubusercontent.com", async () => {
        const { fetcher } = make(() => redirected("secret", "https://raw.githubusercontent.com/o/r/main/dir/a.html?token=abc"));
        expect(await fetcher.fetchText(file)).toBe("secret");
    });

    it("refuses a session response that ended up somewhere else", async () => {
        const { fetcher } = make(() => redirected("<html>login</html>", "https://evil.test/login"), { authMode: "session" });
        await expect(fetcher.fetchText(file)).rejects.toThrow(/Not signed in/);
    });

    it("treats a GitHub login redirect as not signed in", async () => {
        const { fetcher } = make(() => redirected("x", "https://github.com/login?return_to=x"), { authMode: "session" });
        await expect(fetcher.fetchText(file)).rejects.toThrow(/Not signed in/);
    });

    it("falls back to the token API, and never sends the token to github.com", async () => {
        const { fetcher, calls } = make(url => url.startsWith("https://github.com/") ? text("", { status: 404 }) : text("via api"), { token: "tok" });
        expect(await fetcher.fetchText(file)).toBe("via api");
        const api = calls.find(call => call.url.startsWith("https://api.github.com/"))!;
        expect((api.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        expect(api.url).toBe("https://api.github.com/repos/o/r/contents/dir/a.html?ref=main");
        expect(calls.filter(call => call.url.startsWith("https://github.com/")).every(call => !(call.init?.headers as Record<string, string> | undefined)?.Authorization)).toBe(true);
    });

    it("skips the token strategy when none is configured and ends with anonymous access", async () => {
        const { fetcher, calls } = make(url => url.startsWith("https://api.github.com/") ? text("anon") : text("", { status: 404 }));
        expect(await fetcher.fetchText(file)).toBe("anon");
        const api = calls.find(call => call.url.startsWith("https://api.github.com/"))!;
        expect((api.init?.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("token-only mode without a token explains what to do", async () => {
        const { fetcher } = make(() => text("x"), { authMode: "token" });
        await expect(fetcher.fetchText(file)).rejects.toThrow(/token/i);
    });

    it("reports a helpful error when nothing works", async () => {
        const { fetcher } = make(() => text("", { status: 404 }));
        await expect(fetcher.fetchText(file)).rejects.toThrow(/private repository/);
    });

    it("enforces the size limit using content-length and while streaming", async () => {
        const big = make(() => text("x", { headers: { "content-length": "999999" } }), { authMode: "session" });
        await expect(big.fetcher.fetchBytes(file, 1000)).rejects.toMatchObject({ status: 413 });
        const streamed = make(() => text("x".repeat(5000)), { authMode: "session" });
        await expect(streamed.fetcher.fetchBytes(file, 1000)).rejects.toBeInstanceOf(FetchError);
    });

    it("backs off after a rate limit instead of hammering the API", async () => {
        const reset = Math.floor(1_000_000 / 1000) + 30;
        const { fetcher, calls, advance } = make(() => text("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }), { authMode: "anonymous" });
        await expect(fetcher.fetchText(file)).rejects.toThrow(/rate limit/i);
        const before = calls.length;
        await expect(fetcher.fetchText(file)).rejects.toThrow(/rate limit/i);
        expect(calls.length).toBe(before);
        advance(31_000);
        await expect(fetcher.fetchText(file)).rejects.toThrow();
        expect(calls.length).toBe(before + 1);
    });

    it("honours Retry-After on the session endpoint", async () => {
        const { fetcher, calls } = make(() => text("", { status: 429, headers: { "retry-after": "10" } }), { authMode: "session" });
        await expect(fetcher.fetchText(file)).rejects.toThrow();
        await expect(fetcher.fetchText(file)).rejects.toThrow(/retry in/);
        expect(calls).toHaveLength(1);
    });

    it("validates owner, repo, ref and path before any request", async () => {
        const { fetcher, calls } = make(() => text("x"));
        for (const bad of [{ owner: "../x" }, { repo: "a/b" }, { ref: "a..b" }, { path: "../etc/passwd" }]) {
            await expect(fetcher.fetchText({ ...file, ...bad })).rejects.toThrow(/Invalid/);
        }
        expect(calls).toHaveLength(0);
    });

    it("encodes path and branch segments", async () => {
        const { fetcher, calls } = make(() => text("x"), { authMode: "session" });
        await fetcher.fetchText({ ...file, ref: "feature/a+b", path: "dir x/é.html" });
        expect(calls[0].url).toBe("https://github.com/o/r/raw/feature/a%2Bb/dir%20x/%C3%A9.html");
    });

    it("probe reports every strategy separately", async () => {
        const { fetcher } = make(url => url.startsWith("https://github.com/") ? text("abc") : text("", { status: 404 }), { token: "tok" });
        const outcomes = await fetcher.probe(file);
        expect(outcomes.map(o => [o.strategy, o.ok])).toEqual([["session", true], ["token", false], ["anonymous", false]]);
    });
});
