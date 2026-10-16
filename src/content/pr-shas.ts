// GitHub's own diff view asks for `/<owner>/<repo>/diffs/<before>..<after>` when it loads, so the exact commits it is
// showing (merge base and head for a whole PR, or the chosen range/commit) are already on the page. Reading them from
// the page's resource timing needs no API request, so it also works for private repositories.

import type { PrLocation } from "../core/github-urls";

export interface DiffShas {
    before: string;
    after: string;
}

const entryPattern = (owner: string, repo: string): RegExp =>
    new RegExp(`^https://github\\.com/${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/diffs/([0-9a-f]{40})\\.\\.([0-9a-f]{40})(?:[?#]|$)`, "i");

// The timeline can hold requests from pages visited earlier, so a candidate is only trusted when the page itself
// agrees: the URL's commit/range, or (whole PR) a link to a file at that commit.
const HEX = /^[0-9a-f]{7,40}$/i;

// The commits named in the URL's range, if it has one: true/false when it says something, null when it does not.
const agreesWithRange = (range: string | undefined, shas: DiffShas): boolean | null => {
    if (!range) return null;
    if (/\.{2,3}/.test(range)) {
        const [from, to] = range.split(/\.{2,3}/);
        if (!HEX.test(from) || !HEX.test(to)) return false;
        return shas.before.startsWith(from.toLowerCase()) && shas.after.startsWith(to.toLowerCase());
    }
    return HEX.test(range) && shas.after.startsWith(range.toLowerCase());
}

const agreesWithPage = (ctx: PrLocation, shas: DiffShas, doc: Document): boolean => {
    const range = agreesWithRange(ctx.range, shas);
    if (range !== null) return range;
    return !!doc.querySelector(`a[href*="/blob/${shas.after}/"], a[href*="/commit/${shas.after}"]`);
}

const FULL_SHA = /^[0-9a-f]{40}$/i;
const sha = (value: unknown): string | null => typeof value === "string" && FULL_SHA.test(value) ? value.toLowerCase() : null;

// The signed-in Files changed page ships its own data as JSON (`react-app.embeddedData`), including the commits each
// file's diff compares. It has no file links at the head commit to cross-check, so the data vouches for itself: it must
// be about this pull request in this repository, and agree with the commit or range in the address; for the whole pull
// request the diff must end at the pull request's head.
const dig = (value: unknown, ...keys: string[]): unknown =>
    keys.reduce((node, key) => node !== null && typeof node === "object" ? (node as { [key: string]: unknown })[key] : undefined, value);

const fromEmbeddedData = (ctx: PrLocation, doc: Document): DiffShas | null => {
    const lower = (value: unknown) => typeof value === "string" ? value.toLowerCase() : null;
    for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[data-target="react-app.embeddedData"]'))) {
        let payload: unknown;
        try {
            payload = dig(JSON.parse(script.textContent ?? ""), "payload");
        } catch {
            continue;
        }
        const route = dig(payload, "pullRequestsChangesRoute");
        if (String(dig(route, "pullRequest", "number")) !== ctx.pr) continue;
        if (lower(dig(route, "repository", "ownerLogin")) !== ctx.owner.toLowerCase() || lower(dig(route, "repository", "name")) !== ctx.repo.toLowerCase()) continue;

        const diffs = dig(route, "diffContents");
        const entry = Array.isArray(diffs) ? diffs.find(item => sha(dig(item, "oldCommitOid")) && sha(dig(item, "newCommitOid"))) : undefined;
        const before = sha(dig(entry, "oldCommitOid")) ?? sha(dig(route, "comparison", "fullDiff", "baseOid"));
        const after = sha(dig(entry, "newCommitOid")) ?? sha(dig(route, "comparison", "fullDiff", "headOid"));
        if (!before || !after) continue;
        const shas = { before, after };

        const range = agreesWithRange(ctx.range, shas);
        if (range === false) continue;
        if (range === null) {
            const head = sha(dig(payload, "pullRequestsLayoutRoute", "pullRequest", "headSha"));
            if (head && head !== after) continue;
        }
        return shas;
    }
    return null;
}

export const findDiffShas = (ctx: PrLocation, doc: Document = document, entries: PerformanceEntryList = performance.getEntriesByType("resource")): DiffShas | null => {
    const pattern = entryPattern(ctx.owner, ctx.repo);
    const urls = [
        ...Array.from(entries, entry => entry.name).reverse(),
        ...Array.from(doc.querySelectorAll<HTMLElement>("deferred-diff-lines[data-url]"), element => element.getAttribute("data-url")!)
    ];
    for (const url of urls) {
        let normalized: string;
        try {
            normalized = new URL(url, "https://github.com").href;
        } catch {
            continue;
        }
        const match = pattern.exec(normalized);
        if (!match) continue;
        const shas = { before: match[1].toLowerCase(), after: match[2].toLowerCase() };
        if (agreesWithPage(ctx, shas, doc)) return shas;
    }
    return fromEmbeddedData(ctx, doc);
}

// A resource timing entry only exists once the response has finished, so right after the diff first appears the request
// may still be in flight. Wait briefly for it instead of giving up straight away (null falls back to the REST API).
export const waitForDiffShas = (ctx: PrLocation, timeoutMs = 4000): Promise<DiffShas | null> => {
    const now = findDiffShas(ctx);
    if (now || typeof PerformanceObserver === "undefined") return Promise.resolve(now);

    return new Promise(resolve => {
        const finish = (shas: DiffShas | null) => {
            observer.disconnect();
            clearTimeout(timer);
            resolve(shas);
        };
        const observer = new PerformanceObserver(() => {
            const found = findDiffShas(ctx);
            if (found) finish(found);
        });
        const timer = setTimeout(() => finish(findDiffShas(ctx)), timeoutMs);
        observer.observe({ type: "resource" });
    });
}
