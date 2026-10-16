import { describe, expect, it } from "vitest";
import { analyzeDiff, prepareSide, type Fetchers } from "../../scripts/repro/lib";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const loc = { owner: "o", repo: "r", ref: "main", path: "docs/index.html" };

const fetchers = (files: { [path: string]: string }): Fetchers => ({
    text: async path => { if (!(path in files)) throw new Error("404"); return files[path]; },
    exists: async path => path in files
});

describe("repro analysis", () => {
    it("reports stylesheets, assets and sanitizing for a file", async () => {
        const html = '<head><link rel="stylesheet" href="site.css"><link rel="stylesheet" href="missing.css"><link rel="stylesheet" href="https://cdn.test/x.css"></head><body onload="x()"><img src="a.png"><img src="gone.png"><script>1</script></body>';
        const { report } = await prepareSide(html, loc, fetchers({ "docs/site.css": "p{background:url(bg.png)}", "docs/a.png": "x", "docs/bg.png": "x" }), parse);
        expect(report.stylesheets).toEqual([{ path: "docs/site.css", ok: true }, { path: "docs/missing.css", ok: false }]);
        expect(report.assets.map(a => [a.path, a.ok]).sort()).toEqual([["docs/a.png", true], ["docs/bg.png", true], ["docs/gone.png", false]]);
        expect(report.removedBySanitizer).toMatchObject({ scripts: 1, handlers: 1 });
        expect(report.warnings.join("\n")).toMatch(/missing\.css could not be fetched/);
        expect(report.warnings.join("\n")).toMatch(/gone\.png could not be fetched/);
        expect(report.warnings.join("\n")).toMatch(/external stylesheet/);
        expect(report.warnings.join("\n")).toMatch(/script\/noscript/);
    });

    it("diffs two sides and returns the stats and views", async () => {
        const none = fetchers({});
        const report = await analyzeDiff(
            { html: "<body><p>a</p></body>", loc: { ...loc, ref: "A" } },
            { html: "<body><p>a</p><p>b</p></body>", loc: { ...loc, ref: "B" } }, none, parse);
        expect(report.stats).toEqual({ added: 1, removed: 0, modified: 0 });
        expect(report.views?.inline).toContain("data-hp-added");
    });

    it("has no diff stats for an added or removed file", async () => {
        const report = await analyzeDiff(null, { html: "<body></body>", loc }, fetchers({}), parse);
        expect(report.stats).toBeNull();
        expect(report.after?.path).toBe("docs/index.html");
    });
});
