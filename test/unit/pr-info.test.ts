import { describe, expect, it } from "vitest";
import { FileFetcher } from "../../src/core/fetcher";
import { PrInfoLoader } from "../../src/core/pr-info";
import { DEFAULT_SETTINGS } from "../../src/core/settings";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const make = (routes: { [pattern: string]: unknown }) => {
    const calls: string[] = [];
    const getSettings = async () => ({ ...DEFAULT_SETTINGS, token: "tok" });
    const fetcher = new FileFetcher({
        fetch: async input => {
            const url = String(input);
            calls.push(url);
            const key = Object.keys(routes).find(pattern => url.includes(pattern));
            return key ? json(routes[key]) : new Response("", { status: 404 });
        },
        getSettings,
        now: Date.now
    });
    return { loader: new PrInfoLoader(fetcher, getSettings), calls };
}

const A = "a".repeat(40), B = "b".repeat(40), M = "c".repeat(40);

describe("PrInfoLoader", () => {
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

    it("handles a single commit", async () => {
        const { loader } = make({ "/commits/abc1234": { sha: B, parents: [{ sha: A }], files: [{ filename: "a.html", status: "added" }] } });
        const info = await loader.get({ owner: "o", repo: "r", pr: 7, range: "abc1234" });
        expect(info).toMatchObject({ before: A, after: B });
        expect(info.files["a.html"].status).toBe("added");
    });

    it("handles a commit range through a three-dot compare", async () => {
        const { loader, calls } = make({ "/compare/": { merge_base_commit: { sha: M }, files: [{ filename: "a.html", status: "modified" }] } });
        const info = await loader.get({ owner: "o", repo: "r", pr: 7, range: `${A.slice(0, 7)}..${B.slice(0, 7)}` });
        expect(info.before).toBe(M);
        expect(info.after).toBe(B.slice(0, 7));
        expect(calls[0]).toContain(`/compare/${A.slice(0, 7)}...${B.slice(0, 7)}`);
    });

    it("pages through long file lists", async () => {
        const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.html`, status: "modified" }));
        const calls: string[] = [];
        const getSettings = async () => DEFAULT_SETTINGS;
        const fetcher = new FileFetcher({
            fetch: async input => {
                const url = String(input);
                calls.push(url);
                if (url.includes("/pulls/7/files")) return json(url.endsWith("page=1") ? page1 : [{ filename: "last.html", status: "added" }]);
                if (url.includes("/pulls/7")) return json({ base: { sha: A }, head: { sha: B } });
                return json({ merge_base_commit: { sha: M } });
            },
            getSettings,
            now: Date.now
        });
        const info = await new PrInfoLoader(fetcher, getSettings).get({ owner: "o", repo: "r", pr: 7 });
        expect(Object.keys(info.files)).toHaveLength(101);
        expect(calls.filter(url => url.includes("/files")).length).toBe(2);
    });

    it("caches lookups briefly", async () => {
        const { loader, calls } = make({
            "/pulls/7/files": [], "/pulls/7": { base: { sha: A }, head: { sha: B } }, "/compare/": {}
        });
        await loader.get({ owner: "o", repo: "r", pr: 7 });
        const count = calls.length;
        await loader.get({ owner: "o", repo: "r", pr: 7 });
        expect(calls.length).toBe(count);
    });

    it("rejects invalid input before any request", async () => {
        const { loader, calls } = make({});
        await expect(loader.get({ owner: "o/x", repo: "r", pr: 7 })).rejects.toThrow(/Invalid/);
        await expect(loader.get({ owner: "o", repo: "r", pr: 0 })).rejects.toThrow(/Invalid/);
        await expect(loader.get({ owner: "o", repo: "r", pr: 7, range: "nothex..alsonot" })).rejects.toThrow(/Invalid/);
        expect(calls).toHaveLength(0);
    });

    it("tells the user to add a token on 404 for private repositories", async () => {
        const { loader } = make({});
        await expect(loader.get({ owner: "o", repo: "r", pr: 7 })).rejects.toThrow(/token/i);
    });
});
