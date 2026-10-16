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

const agreesWithPage = (ctx: PrLocation, shas: DiffShas, doc: Document): boolean => {
    const range = ctx.range;
    if (range && /\.{2,3}/.test(range)) {
        const [from, to] = range.split(/\.{2,3}/);
        if (!HEX.test(from) || !HEX.test(to)) return false;
        return shas.before.startsWith(from.toLowerCase()) && shas.after.startsWith(to.toLowerCase());
    }
    if (range) return HEX.test(range) && shas.after.startsWith(range.toLowerCase());
    return !!doc.querySelector(`a[href*="/blob/${shas.after}/"], a[href*="/commit/${shas.after}"]`);
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
    return null;
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
