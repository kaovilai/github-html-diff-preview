import { describe, expect, it } from "vitest";
import { clipboardHtml, CLIPPED_MARKER, defaultKind, describeBrowser, htmlFitsInAddress, issueUrl, REPO } from "../../src/shared/report";

const base = { urls: "https://github.com/o/r/blob/main/a.html", browser: "Chrome 141.0.0.0", version: "0.2.0" };

describe("issueUrl", () => {
    it("opens the right form on this repository with every field prefilled", () => {
        const url = new URL(issueUrl({ ...base, kind: "access", error: "File not found.", probe: "FAIL session: HTTP 404" }));
        expect(url.origin + url.pathname).toBe(`https://github.com/${REPO}/issues/new`);
        expect(url.searchParams.get("template")).toBe("access_problem.yml");
        expect(url.searchParams.get("title")).toBe("[access] File not found.");
        expect(url.searchParams.get("urls")).toBe(base.urls);
        expect(url.searchParams.get("actual")).toBe("File not found.");
        expect(url.searchParams.get("probe")).toBe("FAIL session: HTTP 404");
        expect(url.searchParams.get("criteria")).toMatch(/^- /);
        expect(url.searchParams.get("browser")).toBe("Chrome 141.0.0.0");
        expect(url.searchParams.get("version")).toBe("0.2.0");
    });

    it("picks the template by kind and leaves the probe out of the others", () => {
        expect(new URL(issueUrl({ ...base, kind: "render" })).searchParams.get("template")).toBe("rendering_bug.yml");
        const other = new URL(issueUrl({ ...base, kind: "other", probe: "ignored" }));
        expect(other.searchParams.get("template")).toBe("bug_report.yml");
        expect(other.searchParams.has("probe")).toBe(false);
    });

    it("keeps the address short enough for GitHub and never carries a token field", () => {
        const long = "x".repeat(20000);
        const url = issueUrl({ ...base, kind: "access", urls: long, error: long, probe: long });
        expect(url.length).toBeLessThan(5000);
        expect(url).not.toMatch(/token|authorization|secret/i);
    });

    it("keeps non-ASCII and multi-line text within the address budget", () => {
        const cjk = "文件".repeat(2000);
        const lines = "line\n".repeat(4000);
        const url = issueUrl({ ...base, kind: "access", urls: cjk, error: cjk, probe: lines });
        expect(url.length).toBeLessThan(7000);
        const parsed = new URL(url);
        expect(parsed.searchParams.get("urls")!.endsWith("…")).toBe(true);
        // never cuts a character in half
        expect(parsed.searchParams.get("urls")).not.toMatch(/\uFFFD/);
    });

    it("uses what the user confirmed, verbatim, and a placeholder when there is no error", () => {
        const url = new URL(issueUrl({ ...base, kind: "render", urls: "  https://github.com/o/PRIVATE/blob/main/a.html \n(file: a.html)  " }));
        expect(url.searchParams.get("urls")).toBe("https://github.com/o/PRIVATE/blob/main/a.html \n(file: a.html)");
        expect(url.searchParams.get("actual")).toBe("(describe what happened)");
    });
});

describe("sharing the page's HTML", () => {
    it("leaves the HTML out unless it was chosen", () => {
        const url = new URL(issueUrl({ ...base, kind: "render" }));
        expect(url.searchParams.has("before_html")).toBe(false);
        expect(url.searchParams.has("after_html")).toBe(false);
    });

    it("puts a file that fits into the form verbatim, on the side it belongs to", () => {
        const html = "<body><h1>Hi & \"bye\"</h1>\n<p>ü</p></body>";
        const url = new URL(issueUrl({ ...base, kind: "render", html: { after: html } }));
        expect(url.searchParams.get("after_html")).toBe(html);
        expect(url.searchParams.has("before_html")).toBe(false);
        expect(htmlFitsInAddress({ after: html })).toBe(true);
    });

    it("shares both sides of a diff, and skips an empty side", () => {
        const both = new URL(issueUrl({ ...base, kind: "render", html: { before: "<p>old</p>", after: "<p>new</p>" } }));
        expect(both.searchParams.get("before_html")).toBe("<p>old</p>");
        expect(both.searchParams.get("after_html")).toBe("<p>new</p>");
        const added = new URL(issueUrl({ ...base, kind: "render", html: { before: "", after: "<p>new</p>" } }));
        expect(added.searchParams.has("before_html")).toBe(false);
    });

    it("clips long HTML, says so in the text, and still fits the address for any content", () => {
        for (const text of ["<p>x</p>\n".repeat(5000), "文".repeat(5000)]) {
            const html = { before: text, after: text };
            expect(htmlFitsInAddress(html)).toBe(false);
            const url = issueUrl({ ...base, kind: "access", urls: "u".repeat(9000), error: "e".repeat(9000), probe: "p".repeat(9000), html });
            expect(url.length).toBeLessThan(8000);
            const parsed = new URL(url);
            for (const side of ["before_html", "after_html"]) {
                expect(parsed.searchParams.get(side)!.endsWith(CLIPPED_MARKER)).toBe(true);
                expect(parsed.searchParams.get(side)).not.toMatch(/\uFFFD/);
            }
        }
    });

    it("keeps the whole HTML for the clipboard, labelled by side, below GitHub's field limit", () => {
        expect(clipboardHtml({ after: "<p>a</p>" })).toBe("<p>a</p>");
        expect(clipboardHtml({ before: "<p>b</p>", after: "<p>a</p>" })).toBe("<!-- before -->\n<p>b</p>\n<!-- after -->\n<p>a</p>");
        expect(clipboardHtml({ after: "x".repeat(200000) }).length).toBeLessThan(65536);
    });
});

describe("defaultKind", () => {
    it("treats not-found, access and rate-limit failures as access problems", () => {
        for (const status of [401, 403, 404, 429]) expect(defaultKind(status, true)).toBe("access");
    });
    it("treats other errors as something else, and no error as a rendering report", () => {
        expect(defaultKind(undefined, true)).toBe("other");
        expect(defaultKind(500, true)).toBe("other");
        expect(defaultKind(undefined, false)).toBe("render");
    });
});

describe("describeBrowser", () => {
    it("names the browser and version", () => {
        expect(describeBrowser("Mozilla/5.0 ... Chrome/141.0.7390.55 Safari/537.36")).toBe("Chrome 141.0.7390.55");
        expect(describeBrowser("Mozilla/5.0 ... Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3000.1")).toBe("Edge 141.0.3000.1");
        expect(describeBrowser("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/140.0")).toBe("Firefox 140.0");
    });
});
