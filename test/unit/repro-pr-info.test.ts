import { describe, expect, it } from "vitest";
import { PrInfoLoader } from "../../scripts/repro/pr-info";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const make = (routes: { [pattern: string]: unknown }, token?: string) => {
    const calls: { url: string; auth?: string }[] = [];
    const loader = new PrInfoLoader({
        fetch: async (input, init) => {
            const url = String(input);
            calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
            const key = Object.keys(routes).find(pattern => url.includes(pattern));
            return key ? json(routes[key]) : new Response("", { status: 404 });
        },
        token
    });
    return { loader, calls };
}

const A = "a".repeat(40), B = "b".repeat(40), M = "c".repeat(40);

describe("PrInfoLoader (developer tool)", () => {
    it("diffs a whole PR against the merge base, not the base branch tip", async () => {
        const { loader } = make({
            "/pulls/7/files": [{ filename: "a.html", status: "modified" }, { filename: "n.html", status: "renamed", previous_filename: "o.html" }],
            "/pulls/7": { base: { sha: A }, head: { sha: B } },
            "/compare/": { merge_base_commit: { sha: M } }
        });
        const info = await loader.get({ owner: "o", repo: "r", pr: 7 });
        expect(info.before).toBe(M);
        expect(info.after).toBe(B);
        expect(info.files["n.html"]).toEqual({ status: "renamed", previous: "o.html" });
    });

    it("handles a single commit and a commit range", async () => {
        const commit = make({ "/commits/abc1234": { sha: B, parents: [{ sha: A }], files: [{ filename: "a.html", status: "added" }] } });
        expect(await commit.loader.get({ owner: "o", repo: "r", pr: 7, range: "abc1234" })).toMatchObject({ before: A, after: B });

        const range = make({ "/compare/": { merge_base_commit: { sha: M }, files: [{ filename: "a.html", status: "modified" }] } });
        const info = await range.loader.get({ owner: "o", repo: "r", pr: 7, range: `${A.slice(0, 7)}..${B.slice(0, 7)}` });
        expect(info).toMatchObject({ before: M, after: B.slice(0, 7) });
    });

    it("sends the token only when one is given, and only to api.github.com", async () => {
        const anon = make({ "/pulls/7/files": [], "/pulls/7": { base: { sha: A }, head: { sha: B } }, "/compare/": {} });
        await anon.loader.get({ owner: "o", repo: "r", pr: 7 });
        expect(anon.calls.every(call => call.auth === undefined && call.url.startsWith("https://api.github.com/"))).toBe(true);

        const authed = make({ "/pulls/7/files": [], "/pulls/7": { base: { sha: A }, head: { sha: B } }, "/compare/": {} }, "tok");
        await authed.loader.get({ owner: "o", repo: "r", pr: 7 });
        expect(authed.calls.every(call => call.auth === "Bearer tok")).toBe(true);
    });

    it("rejects invalid input before any request", async () => {
        const { loader, calls } = make({});
        await expect(loader.get({ owner: "o/x", repo: "r", pr: 7 })).rejects.toThrow(/Invalid/);
        await expect(loader.get({ owner: "o", repo: "r", pr: 0 })).rejects.toThrow(/Invalid/);
        await expect(loader.get({ owner: "o", repo: "r", pr: 7, range: "nothex..alsonot" })).rejects.toThrow(/Invalid/);
        expect(calls).toHaveLength(0);
    });
});
