import { describe, expect, it } from "vitest";
import { defaultKind, describeBrowser, issueUrl, REPO } from "../../src/shared/report";

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

    it("uses what the user confirmed, verbatim, and a placeholder when there is no error", () => {
        const url = new URL(issueUrl({ ...base, kind: "render", urls: "  https://github.com/o/PRIVATE/blob/main/a.html \n(file: a.html)  " }));
        expect(url.searchParams.get("urls")).toBe("https://github.com/o/PRIVATE/blob/main/a.html \n(file: a.html)");
        expect(url.searchParams.get("actual")).toBe("(describe what happened)");
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
