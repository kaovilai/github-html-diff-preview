import { describe, expect, it } from "vitest";
import { collectAssetPaths, getScriptPaths, getStylesheetPaths, loadScripts, loadStylesheets, resolveRepoPath, rewriteUrls, sanitizeDocument } from "../../src/core/html-prepare";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const ctx = { owner: "o", repo: "r", ref: "SHA", path: "dir/a.html" };

describe("resolveRepoPath", () => {
    it("resolves relative, parent and root-relative references against the file", () => {
        expect(resolveRepoPath("dir/a.html", "b.png")).toBe("dir/b.png");
        expect(resolveRepoPath("dir/a.html", "../x/y.css")).toBe("x/y.css");
        expect(resolveRepoPath("dir/a.html", "./sub/z.png?v=1#f")).toBe("dir/sub/z.png");
        expect(resolveRepoPath("a.html", "b.png")).toBe("b.png");
    });

    it("ignores absolute, protocol-relative and fragment URLs", () => {
        expect(resolveRepoPath("a.html", "https://x.test/a.png")).toBeNull();
        expect(resolveRepoPath("a.html", "//cdn.test/a.png")).toBeNull();
        expect(resolveRepoPath("a.html", "data:image/png;base64,AAA")).toBeNull();
        expect(resolveRepoPath("a.html", "#top")).toBeNull();
    });
});

describe("sanitizeDocument", () => {
    it("removes everything that can execute", () => {
        const doc = parse(`<head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"></head>
            <body onload="x()"><script>alert(1)</script><noscript>n</noscript><object data="a.swf"></object><embed src="a"><iframe srcdoc="<script>1</script>"></iframe>
            <a href="javascript:alert(1)" onclick="x()">a</a><a href="java\tscript:alert(1)">b</a><img src=x onerror="x()"><form action="javascript:1"></form></body>`);
        sanitizeDocument(doc, "a.html", new Map());
        const html = doc.documentElement.outerHTML;
        expect(html).not.toMatch(/<script|<noscript|<object|<embed|<base|http-equiv|srcdoc/i);
        expect(html).not.toMatch(/\son\w+=/i);
        expect(html).not.toMatch(/javascript:/i);
        expect(html).not.toMatch(/java\tscript/i);
    });

    it("inlines fetched stylesheets and keeps the media attribute", () => {
        const doc = parse('<head><link rel="stylesheet" href="main.css" media="print"></head><body></body>');
        sanitizeDocument(doc, "dir/a.html", new Map([["dir/main.css", "p{color:red}"]]));
        const style = doc.querySelector("style[data-hp-sheet]");
        expect(style?.textContent).toBe("p{color:red}");
        expect(style?.getAttribute("media")).toBe("print");
        expect(doc.querySelector("link")).toBeNull();
    });

    it("keeps scripts only when explicitly allowed, and inlines relative script files", () => {
        const doc = parse('<body onclick="x()"><script src="app.js"></script><script src="https://cdn.test/x.js"></script></body>');
        sanitizeDocument(doc, "dir/a.html", new Map(), { allowScripts: true, scripts: new Map([["dir/app.js", 'var s="</script>";']]) });
        const scripts = Array.from(doc.querySelectorAll("script"));
        expect(scripts).toHaveLength(2);
        expect(scripts[0].hasAttribute("src")).toBe(false);
        expect(scripts[0].textContent).toBe('var s="<\\/script>";');
        expect(doc.body.hasAttribute("onclick")).toBe(true);
    });

    it("still removes <base> and meta refresh when scripts are allowed", () => {
        const doc = parse('<head><base href="https://evil.test/"><meta http-equiv="refresh" content="0"></head><body></body>');
        sanitizeDocument(doc, "a.html", new Map(), { allowScripts: true });
        expect(doc.querySelector("base, meta[http-equiv]")).toBeNull();
    });
});

describe("loadStylesheets", () => {
    const files: { [path: string]: string } = {
        "dir/main.css": '@import "./theme.css" screen;\nbody{background:url(bg.png)}',
        "dir/theme.css": '@import "cycle.css";\n.t{color:blue;background:url(img/t.png)}',
        "dir/cycle.css": '@import "main.css";.c{}'
    };
    const fetchText = async (path: string) => {
        if (!(path in files)) throw new Error("404");
        return files[path];
    };

    it("inlines @import with media, survives cycles, and anchors url() to the sheet's own directory", async () => {
        const sheets = await loadStylesheets(["dir/main.css"], fetchText);
        const css = sheets.get("dir/main.css")!;
        expect(css).toContain("@media screen{");
        expect(css).toContain(".c{}");
        expect(css).toContain("url(hp-repo:/dir/bg.png)");
        expect(css).toContain("url(hp-repo:/dir/img/t.png)");
    });

    it("skips sheets that cannot be fetched", async () => {
        const sheets = await loadStylesheets(["missing.css"], fetchText);
        expect(sheets.size).toBe(0);
    });

    it("bounds the number of requests", async () => {
        let calls = 0;
        const many = Array.from({ length: 40 }, (_, i) => `s${i}.css`);
        await loadStylesheets(many, async () => { calls++; return ""; });
        expect(calls).toBeLessThanOrEqual(16);
    });
});

describe("rewriteUrls", () => {
    it("points repo-relative URLs at GitHub raw when no asset was inlined", () => {
        const doc = parse('<body><img src="a.png"><img srcset="data:image/png;base64,AAA 1x, b.png 2x, sub/c.png?v=2 3x"><img src="sprite.svg#icon"><div style="background:url(./hero.png)"></div></body>');
        rewriteUrls(doc, ctx);
        const imgs = doc.querySelectorAll("img");
        expect(imgs[0].getAttribute("src")).toBe("https://raw.githubusercontent.com/o/r/SHA/dir/a.png");
        expect(imgs[1].getAttribute("srcset")).toBe("data:image/png;base64,AAA 1x, https://raw.githubusercontent.com/o/r/SHA/dir/b.png 2x, https://raw.githubusercontent.com/o/r/SHA/dir/sub/c.png?v=2 3x");
        expect(imgs[2].getAttribute("src")).toBe("https://raw.githubusercontent.com/o/r/SHA/dir/sprite.svg#icon");
        expect(doc.querySelector("div")!.getAttribute("style")).toBe("background:url(https://raw.githubusercontent.com/o/r/SHA/dir/hero.png)");
    });

    it("uses inlined data: assets when available", () => {
        const doc = parse('<body><img src="a.png"><img src="b.png"></body>');
        rewriteUrls(doc, { ...ctx, assetUrl: path => path === "dir/a.png" ? "data:image/png;base64,QQ==" : undefined });
        const imgs = doc.querySelectorAll("img");
        expect(imgs[0].getAttribute("src")).toBe("data:image/png;base64,QQ==");
        expect(imgs[1].getAttribute("src")).toContain("raw.githubusercontent.com");
    });

    it("resolves anchored stylesheet placeholders through the asset map", () => {
        const doc = parse('<head><style data-hp-sheet="x.css">@font-face{src:url(hp-repo:/fonts/a.woff2)}p{background:url("hp-repo:/img/b.png")}</style></head><body></body>');
        rewriteUrls(doc, { ...ctx, assetUrl: path => path === "fonts/a.woff2" ? "data:font/woff2;base64,QQ==" : undefined });
        const css = doc.querySelector("style")!.textContent!;
        expect(css).toContain("url(data:font/woff2;base64,QQ==)");
        expect(css).toContain('url("https://raw.githubusercontent.com/o/r/SHA/img/b.png")');
    });

    it("rewrites links to GitHub blob pages and opens them safely", () => {
        const doc = parse('<body><a href="README.md#install">x</a><a href="#top">y</a><a href="https://example.com">z</a></body>');
        rewriteUrls(doc, ctx);
        const links = doc.querySelectorAll("a");
        expect(links[0].getAttribute("href")).toBe("https://github.com/o/r/blob/SHA/dir/README.md#install");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
        expect(links[1].getAttribute("href")).toBe("#top");
        expect(links[2].getAttribute("target")).toBe("_blank");
    });

    it("encodes branch refs containing slashes", () => {
        const doc = parse('<body><img src="a.png"></body>');
        rewriteUrls(doc, { ...ctx, ref: "feature/x" });
        expect(doc.querySelector("img")!.getAttribute("src")).toBe("https://raw.githubusercontent.com/o/r/feature/x/dir/a.png");
    });
});

describe("asset and script discovery", () => {
    it("collects every repo-relative asset reference, deduplicated", () => {
        const doc = parse('<head><style>p{background:url(bg.png)}</style></head><body><img src="a.png"><img src="a.png"><img srcset="b.png 1x"><img src="https://x.test/c.png"></body>');
        expect(collectAssetPaths(doc, ctx).sort()).toEqual(["dir/a.png", "dir/b.png", "dir/bg.png"]);
    });

    it("lists relative stylesheets and scripts only", () => {
        const doc = parse('<head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="https://x.test/b.css"><script src="a.js"></script><script src="//cdn.test/b.js"></script></head>');
        expect(getStylesheetPaths(doc, "dir/x.html")).toEqual(["dir/a.css"]);
        expect(getScriptPaths(doc, "dir/x.html")).toEqual(["dir/a.js"]);
    });

    it("loads scripts, ignoring failures", async () => {
        const scripts = await loadScripts(["a.js", "b.js"], async path => { if (path === "b.js") throw new Error("404"); return "x"; });
        expect(Array.from(scripts.keys())).toEqual(["a.js"]);
    });
});
