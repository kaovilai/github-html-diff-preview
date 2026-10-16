import { describe, expect, it } from "vitest";
import { assertRepoPath, isSha, isValidName, isValidRef, parseBlobPath, parsePrPath, refCandidates } from "../../src/core/github-urls";

describe("validation", () => {
    it("accepts normal owner/repo names and rejects traversal and separators", () => {
        expect(isValidName("kaovilai")).toBe(true);
        expect(isValidName("my.repo-1_x")).toBe(true);
        for (const bad of ["", ".", "..", "a/b", "a b", "a?b", "a#b", "a%2f"]) expect(isValidName(bad)).toBe(false);
    });

    it("accepts branch, tag and sha refs and rejects odd ones", () => {
        for (const ok of ["main", "feature/x", "v1.2.3", "a".repeat(40), "release-1.17"]) expect(isValidRef(ok)).toBe(true);
        for (const bad of ["", "/x", "x/", "a//b", "a..b", "a\\b", "a b", "x?y=1", "x&y"]) expect(isValidRef(bad)).toBe(false);
    });

    it("recognises commit shas", () => {
        expect(isSha("deadbeef")).toBe(true);
        expect(isSha("xyz")).toBe(false);
    });

    it("rejects path traversal in file paths", () => {
        expect(() => assertRepoPath("a/b.html")).not.toThrow();
        for (const bad of ["", "../a.html", "a/../b.html", "a//b.html", "./a.html", "/a.html"]) expect(() => assertRepoPath(bad)).toThrow();
    });
});

describe("parseBlobPath", () => {
    it("parses html blob pages", () => {
        expect(parseBlobPath("/o/r/blob/main/docs/index.html")).toEqual({ owner: "o", repo: "r", rest: "main/docs/index.html" });
        expect(parseBlobPath("/o/r/blob/feature/x/a%20b.HTM")).toEqual({ owner: "o", repo: "r", rest: "feature/x/a b.HTM" });
    });

    it("ignores other pages", () => {
        for (const path of ["/o/r/blob/main/readme.md", "/o/r/tree/main/a.html", "/o/r", "/o/r/blob/a.html"]) expect(parseBlobPath(path)).toBeNull();
    });
});

describe("parsePrPath", () => {
    it("parses the whole PR, ranges and commits", () => {
        expect(parsePrPath("/o/r/pull/5/files")).toEqual({ owner: "o", repo: "r", pr: "5", range: undefined });
        expect(parsePrPath("/o/r/pull/5/changes/abc1234..def5678")?.range).toBe("abc1234..def5678");
        expect(parsePrPath("/o/r/pull/5/commits/abc1234")?.range).toBe("abc1234");
    });

    it("ignores the conversation tab", () => {
        expect(parsePrPath("/o/r/pull/5")).toBeNull();
    });
});

describe("refCandidates", () => {
    it("lists ref/path splits, shortest ref first", () => {
        expect(refCandidates("feature/x/docs/a.html")).toEqual([
            { ref: "feature", path: "x/docs/a.html" },
            { ref: "feature/x", path: "docs/a.html" },
            { ref: "feature/x/docs", path: "a.html" }
        ]);
    });

    it("caps the number of candidates", () => {
        expect(refCandidates("a/b/c/d/e/f/g/h.html", 3)).toHaveLength(3);
    });
});

describe("refCandidates hint", () => {
    it("uses a hint that really is a prefix of the URL", () => {
        expect(refCandidates("feature/x/docs/a.html", 5, "feature/x")).toEqual([{ ref: "feature/x", path: "docs/a.html" }]);
    });

    it("ignores a hint that does not match the URL", () => {
        expect(refCandidates("main/a.html", 5, "evil/other")).toEqual([{ ref: "main", path: "a.html" }]);
        expect(refCandidates("main/a.html", 5, "main/a.html")).toEqual([{ ref: "main", path: "a.html" }]);
    });
});
