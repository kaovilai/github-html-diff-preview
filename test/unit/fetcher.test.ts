import { describe, expect, it } from "vitest";
import { FetchError, FileFetcher } from "../../src/core/fetcher";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const file = { owner: "o", repo: "r", ref: "main", path: "dir/a.html" };

const make = (handler: Handler) => {
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
        now: () => time
    });
    return { fetcher, calls, advance: (ms: number) => { time += ms; } };
}

const text = (body: string, init: ResponseInit = {}) => new Response(body, init);
const redirected = (body: string, finalUrl: string) => Object.assign(new Response(body, { headers: { "content-type": "text/plain" } }), { finalUrl });

describe("FileFetcher", () => {
    it("reads through the browser's github.com session, with credentials", async () => {
        const { fetcher, calls } = make(() => text("<p>hi</p>"));
        expect(await fetcher.fetchText(file)).toBe("<p>hi</p>");
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://github.com/o/r/raw/main/dir/a.html");
        expect(calls[0].init?.credentials).toBe("include");
    });

    it("never touches the REST API and never sends an Authorization header", async () => {
        const { fetcher, calls } = make(url => url.includes("/raw/") ? text("x") : text("", { status: 404 }));
        await fetcher.fetchText(file);
        await fetcher.fetchDiffEntry("o", "r", "a".repeat(40), "b".repeat(40), "dir/a.html");
        expect(calls.every(call => call.url.startsWith("https://github.com/"))).toBe(true);
        expect(calls.every(call => !(call.init?.headers as Record<string, string> | undefined)?.Authorization)).toBe(true);
    });

    it("follows the private-repo redirect to raw.githubusercontent.com", async () => {
        const { fetcher } = make(() => redirected("secret", "https://raw.githubusercontent.com/o/r/main/dir/a.html?token=abc"));
        expect(await fetcher.fetchText(file)).toBe("secret");
    });

    it("refuses a response that ended up somewhere else, and a sign-in redirect", async () => {
        const elsewhere = make(() => redirected("<html>login</html>", "https://evil.test/login"));
        await expect(elsewhere.fetcher.fetchText(file)).rejects.toThrow(/sign in/i);
        const login = make(() => redirected("x", "https://github.com/login?return_to=x"));
        await expect(login.fetcher.fetchText(file)).rejects.toThrow(/sign in/i);
    });

    it("says it is a sign-in problem when redirected to the login page, and a not-found otherwise", async () => {
        const login = make(() => redirected("x", "https://github.com/login?return_to=x"));
        await expect(login.fetcher.fetchText(file)).rejects.toThrow(/Not signed in to GitHub in this browser/);
        const missing = make(() => text("", { status: 404 }));
        await expect(missing.fetcher.fetchText(file)).rejects.toThrow(/File not found/);
    });

    it("only throttling statuses pause later requests", async () => {
        const weird = make(() => text("", { status: 404, headers: { "retry-after": "120" } }));
        await expect(weird.fetcher.fetchText(file)).rejects.toThrow();
        await expect(weird.fetcher.fetchText(file)).rejects.toThrow(/File not found/);
        expect(weird.calls).toHaveLength(2);
        const busy = make(() => text("", { status: 503, headers: { "retry-after": "5" } }));
        await expect(busy.fetcher.fetchText(file)).rejects.toThrow();
        await expect(busy.fetcher.fetchText(file)).rejects.toThrow(/retry in/);
        expect(busy.calls).toHaveLength(1);
    });

    it("tells the user to sign in when the file is not found", async () => {
        const { fetcher } = make(() => text("", { status: 404 }));
        await expect(fetcher.fetchText(file)).rejects.toThrow(/private, sign in to github\.com/);
    });

    it("keeps the status on the error so the viewer can classify a report", async () => {
        const { fetcher } = make(() => text("", { status: 404 }));
        await expect(fetcher.fetchText(file)).rejects.toMatchObject({ status: 404 });
    });

    it("enforces the size limit using content-length and while streaming", async () => {
        const big = make(() => text("x", { headers: { "content-length": "999999" } }));
        await expect(big.fetcher.fetchBytes(file, 1000)).rejects.toMatchObject({ status: 413 });
        const streamed = make(() => text("x".repeat(5000)));
        await expect(streamed.fetcher.fetchBytes(file, 1000)).rejects.toBeInstanceOf(FetchError);
    });

    it("honours Retry-After instead of hammering GitHub", async () => {
        const { fetcher, calls, advance } = make(() => text("", { status: 429, headers: { "retry-after": "10" } }));
        await expect(fetcher.fetchText(file)).rejects.toThrow();
        await expect(fetcher.fetchText(file)).rejects.toThrow(/retry in/);
        expect(calls).toHaveLength(1);
        advance(11_000);
        await expect(fetcher.fetchText(file)).rejects.toThrow();
        expect(calls).toHaveLength(2);
    });

    it("validates owner, repo, ref and path before any request", async () => {
        const { fetcher, calls } = make(() => text("x"));
        for (const bad of [{ owner: "../x" }, { repo: "a/b" }, { ref: "a..b" }, { path: "../etc/passwd" }]) {
            await expect(fetcher.fetchText({ ...file, ...bad })).rejects.toThrow(/Invalid/);
        }
        expect(calls).toHaveLength(0);
    });

    it("encodes path and branch segments", async () => {
        const { fetcher, calls } = make(() => text("x"));
        await fetcher.fetchText({ ...file, ref: "feature/a+b", path: "dir x/é.html" });
        expect(calls[0].url).toBe("https://github.com/o/r/raw/feature/a%2Bb/dir%20x/%C3%A9.html");
    });

    it("probe reports whether the browser's sign-in reaches the file", async () => {
        const ok = await make(() => text("abc")).fetcher.probe(file);
        expect(ok).toEqual([{ strategy: "session", ok: true, detail: "3 bytes" }]);
        const missing = await make(() => text("", { status: 404 })).fetcher.probe(file);
        expect(missing[0]).toMatchObject({ strategy: "session", ok: false });
    });

    it("reads a file's status from the .diff view, and gives up quietly when it cannot", async () => {
        const diff = "diff --git a/dir/a.html b/dir/a.html\nnew file mode 100644\n--- /dev/null\n+++ b/dir/a.html\n@@ -0,0 +1 @@\n+x\n";
        const found = await make(() => text(diff)).fetcher.fetchDiffEntry("o", "r", "a".repeat(40), "b".repeat(40), "dir/a.html");
        expect(found).toEqual({ status: "added" });
        const none = await make(() => text("", { status: 404 })).fetcher.fetchDiffEntry("o", "r", "a".repeat(40), "b".repeat(40), "dir/a.html");
        expect(none).toBeNull();
    });
});
