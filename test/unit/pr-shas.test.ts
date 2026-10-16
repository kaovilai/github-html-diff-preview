import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDiffShas } from "../../src/content/pr-shas";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const entry = (name: string) => ({ name }) as PerformanceEntry;
const request = (before: string, after: string, repo = "o/r") => entry(`https://github.com/${repo}/diffs/${before}..${after}?base_sha=${before}&whitespace_ignored=false`);
const page = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("findDiffShas", () => {
    it("takes the commits from the page's own diff request when a file link at the head agrees", () => {
        const doc = page(`<a href="/o/r/blob/${B}/x.html">View file</a>`);
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5" }, doc, [request(A, B)])).toEqual({ before: A, after: B });
    });

    it("reads the commit range from GitHub's deferred diff-lines markup", () => {
        const doc = page(readFileSync(path.resolve(__dirname, "../fixtures/github-dom/pr-files-classic.html"), "utf8"));
        expect(findDiffShas({ owner: "redhat-et", repo: "pricetag-metering", pr: "91" }, doc, [])).toEqual({
            before: "b08921a4e275b70b9a27091dac57c1d9949ecc13",
            after: "99ffc9f598ed396c1acd035fb5b386f6a485b1dd"
        });
    });

    describe("from the signed-in page's embedded data", () => {
        const OLD = "b08921a4e275b70b9a27091dac57c1d9949ecc13", NEW = "99ffc9f598ed396c1acd035fb5b386f6a485b1dd";
        const ctx = { owner: "redhat-et", repo: "pricetag-metering", pr: "91" };
        const fixture = () => readFileSync(path.resolve(__dirname, "../fixtures/github-dom/pr-files-react-embedded.html"), "utf8");
        // the same page with a field changed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type Json = any;
        const edited = (change: (route: Json, payload: Json) => void) => {
            const doc = page(fixture());
            const script = doc.querySelector("script")!;
            const payload = JSON.parse(script.textContent!).payload;
            change(payload.pullRequestsChangesRoute, payload);
            script.textContent = JSON.stringify({ payload });
            return doc;
        };

        it("finds the compared commits on the real signed-in page, which has no request entry, link or deferred markup", () => {
            expect(findDiffShas(ctx, page(fixture()), [])).toEqual({ before: OLD, after: NEW });
        });

        it("uses the whole-diff commits when no file entry names them", () => {
            const doc = edited(route => { route.diffContents = []; });
            expect(findDiffShas(ctx, doc, [])).toEqual({ before: OLD, after: NEW });
        });

        it("ignores data about another pull request or repository", () => {
            expect(findDiffShas({ ...ctx, pr: "92" }, page(fixture()), [])).toBeNull();
            expect(findDiffShas({ ...ctx, repo: "other" }, page(fixture()), [])).toBeNull();
            expect(findDiffShas({ ...ctx, owner: "REDHAT-ET", repo: "Pricetag-Metering" }, page(fixture()), [])).toEqual({ before: OLD, after: NEW });
        });

        it("must agree with the commit or range in the address", () => {
            expect(findDiffShas({ ...ctx, range: `${OLD.slice(0, 7)}..${NEW.slice(0, 7)}` }, page(fixture()), [])).toEqual({ before: OLD, after: NEW });
            expect(findDiffShas({ ...ctx, range: NEW.slice(0, 10) }, page(fixture()), [])).toEqual({ before: OLD, after: NEW });
            expect(findDiffShas({ ...ctx, range: "1234567..89abcde" }, page(fixture()), [])).toBeNull();
            expect(findDiffShas({ ...ctx, range: "1234567" }, page(fixture()), [])).toBeNull();
        });

        it("for the whole pull request, the diff must end at the pull request's head", () => {
            const stale = edited((_route, payload) => { payload.pullRequestsLayoutRoute.pullRequest.headSha = "1".repeat(40); });
            expect(findDiffShas(ctx, stale, [])).toBeNull();
            const noLayout = edited((_route, payload) => { delete payload.pullRequestsLayoutRoute; });
            expect(findDiffShas(ctx, noLayout, [])).toEqual({ before: OLD, after: NEW });
        });

        it("rejects malformed data instead of throwing", () => {
            const doc = page(`<script type="application/json" data-target="react-app.embeddedData">{not json</script>`);
            expect(findDiffShas(ctx, doc, [])).toBeNull();
            const short = edited(route => { route.diffContents = [{ oldCommitOid: "abc", newCommitOid: "def" }]; route.comparison = {}; });
            expect(findDiffShas(ctx, short, [])).toBeNull();
            expect(findDiffShas(ctx, page(`<script type="application/json" data-target="react-app.embeddedData">{"payload":null}</script>`), [])).toBeNull();
        });

        it("still prefers the page's own diff request when there is one", () => {
            const doc = page(fixture() + `<a href="/redhat-et/pricetag-metering/blob/${C}/x.html">x</a>`);
            expect(findDiffShas(ctx, doc, [request(A, C, "redhat-et/pricetag-metering")])).toEqual({ before: A, after: C });
        });
    });

    it("prefers the most recent request", () => {
        const doc = page(`<a href="/o/r/blob/${C}/x.html">x</a>`);
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5" }, doc, [request(A, B), request(B, C)])).toEqual({ before: B, after: C });
    });

    it("ignores a request that the page does not corroborate (left over from another page)", () => {
        const doc = page(`<a href="/o/r/blob/${C}/x.html">x</a>`);
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5" }, doc, [request(A, B)])).toBeNull();
    });

    it("ignores requests for other repositories and unrelated URLs", () => {
        const doc = page(`<a href="/o/r/blob/${B}/x.html">x</a>`);
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5" }, doc, [request(A, B, "evil/other"), entry("https://github.com/o/r/pull/5")])).toBeNull();
    });

    it("checks a commit range against the address instead of the page links", () => {
        const doc = page("");
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5", range: `${A.slice(0, 7)}..${B.slice(0, 7)}` }, doc, [request(A, B)])).toEqual({ before: A, after: B });
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5", range: `${C.slice(0, 7)}..${B.slice(0, 7)}` }, doc, [request(A, B)])).toBeNull();
    });

    it("never trusts a malformed range", () => {
        const doc = page("");
        for (const range of ["abc..", "..abc1234", "xyz..zzz", `${A.slice(0, 7)}..`]) {
            expect(findDiffShas({ owner: "o", repo: "r", pr: "5", range }, doc, [request(A, B)])).toBeNull();
        }
    });

    it("checks a single commit against the address", () => {
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5", range: B.slice(0, 8) }, page(""), [request(A, B)])).toEqual({ before: A, after: B });
        expect(findDiffShas({ owner: "o", repo: "r", pr: "5", range: C.slice(0, 8) }, page(""), [request(A, B)])).toBeNull();
    });

    it("does not treat a repo name's regex characters as a pattern", () => {
        const doc = page(`<a href="/o/r.x/blob/${B}/x.html">x</a>`);
        expect(findDiffShas({ owner: "o", repo: "r.x", pr: "5" }, doc, [request(A, B, "o/rZx")])).toBeNull();
        expect(findDiffShas({ owner: "o", repo: "r.x", pr: "5" }, doc, [request(A, B, "o/r.x")])).toEqual({ before: A, after: B });
    });
});
