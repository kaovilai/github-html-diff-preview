import { describe, expect, it } from "vitest";
import { buildViews, type Side } from "../../src/core/html-diff";
import { rewriteUrls, sanitizeDocument } from "../../src/core/html-prepare";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const run = (before: string, after: string) => {
    const ctx = {
        before: { owner: "o", repo: "r", ref: "AAA1111", path: "dir/a.html" },
        after: { owner: "o", repo: "r", ref: "BBB2222", path: "dir/a.html" }
    };
    return buildViews((side: Side) => {
        const doc = parse(side === "before" ? before : after);
        sanitizeDocument(doc, "dir/a.html", new Map());
        return doc;
    }, (root, side) => rewriteUrls(root, ctx[side]));
}

const total = (v: ReturnType<typeof run>) => v.stats.added + v.stats.removed + v.stats.modified;

describe("html-diff", () => {
    it("reports no change for identical documents", () => {
        expect(total(run("<body><p>a</p></body>", "<body><p>a</p></body>"))).toBe(0);
    });

    it("does not flag an unchanged relative URL even though each side resolves to a different commit", () => {
        const v = run('<body><img src="logo.png"><p>one</p></body>', '<body><img src="logo.png"><p>two</p></body>');
        expect(v.stats.modified).toBe(0);
        expect(v.after).toContain("/BBB2222/dir/logo.png");
        expect(v.before).toContain("/AAA1111/dir/logo.png");
    });

    it("marks added and removed nodes", () => {
        const v = run("<body><p>keep</p><p>old</p></body>", "<body><p>keep</p><p>new</p></body>");
        expect(v.stats.added).toBeGreaterThan(0);
        expect(v.stats.removed).toBeGreaterThan(0);
        expect(v.after).toContain("data-hp-added");
        expect(v.before).toContain("data-hp-removed");
    });

    it("compares text the way it renders", () => {
        expect(total(run("<body><p>Hello <b>world</b></p></body>", "<body><p>Hello<b>world</b></p></body>"))).toBeGreaterThan(0);
        expect(total(run("<body><div><p>a</p></div></body>", "<body><div>\n   <p>\n  a\n </p>\n</div></body>"))).toBe(0);
        expect(total(run("<body><pre><span>a</span>\n<span>b</span></pre></body>", "<body><pre><span>a</span><span>b</span></pre></body>"))).toBeGreaterThan(0);
    });

    it("detects body attribute changes", () => {
        const v = run("<body><p>x</p></body>", '<body class="dark"><p>x</p></body>');
        expect(v.stats.modified).toBe(1);
        expect(v.after).toContain('<body class="dark" data-hp-modified');
    });

    it("keeps a removal bubble inside the table after the document is re-parsed", () => {
        const v = run(
            "<body><table><tbody><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></tbody></table></body>",
            "<body><table><tbody><tr><td>1</td></tr><tr><td>3</td></tr></tbody></table></body>"
        );
        const reparsed = parse(v.inline);
        const bubble = reparsed.querySelector("hp-del");
        expect(bubble?.closest("td")).not.toBeNull();
        expect(bubble?.closest("table")).not.toBeNull();
        expect(reparsed.querySelectorAll("hp-del")).toHaveLength(1);
    });

    it("places a removed <option> bubble outside the <select>", () => {
        const v = run("<body><select><option>a</option><option>b</option></select></body>", "<body><select><option>a</option></select></body>");
        const reparsed = parse(v.inline);
        expect(reparsed.querySelector("hp-del")).not.toBeNull();
        expect(reparsed.querySelector("select hp-del")).toBeNull();
    });

    it("renders removed content in a declarative shadow root so no script is needed", () => {
        const v = run("<body><p>a</p><p>gone</p></body>", "<body><p>a</p></body>");
        expect(v.inline).toContain('<template shadowrootmode="open">');
        expect(v.inline).toContain("gone");
    });

    it("does not insert bubbles into the before/after views", () => {
        const v = run("<body><p>a</p><p>gone</p></body>", "<body><p>a</p></body>");
        expect(v.before).not.toContain("<hp-del");
        expect(v.after).not.toContain("<hp-del");
    });
});
