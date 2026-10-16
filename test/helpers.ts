// Helpers for reproducing reports without a browser: run the real sanitize/diff pipeline in jsdom, or mount a copy
// of GitHub's markup and let the content scripts act on it.
import { buildViews, type Side, type Views } from "../src/core/html-diff";
import { rewriteUrls, sanitizeDocument } from "../src/core/html-prepare";

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

export interface DiffOptions {
    // repo path of the file on both sides, which relative URLs resolve against
    path?: string;
    owner?: string;
    repo?: string;
    beforeRef?: string;
    afterRef?: string;
    // stylesheets already fetched, keyed by repo path
    sheets?: Map<string, string>;
    // data: URLs for assets, keyed by repo path
    assets?: Map<string, string>;
}

export const diffHtml = (before: string, after: string, options: DiffOptions = {}): Views => {
    const { path = "index.html", owner = "o", repo = "r", beforeRef = "BEFORE", afterRef = "AFTER", sheets = new Map(), assets = new Map() } = options;
    const ctx = {
        before: { owner, repo, ref: beforeRef, path, assetUrl: (p: string) => assets.get(p) },
        after: { owner, repo, ref: afterRef, path, assetUrl: (p: string) => assets.get(p) }
    };
    return buildViews((side: Side) => {
        const doc = parse(side === "before" ? before : after);
        sanitizeDocument(doc, path, sheets);
        return doc;
    }, (root, side) => rewriteUrls(root, ctx[side]));
}

export const totalChanges = (views: Views): number => views.stats.added + views.stats.removed + views.stats.modified;

// jsdom has no CSS.escape or matchMedia, which the content scripts use.
const polyfill = () => {
    const globals = globalThis as unknown as { CSS?: { escape?: (value: string) => string } };
    globals.CSS = globals.CSS ?? {};
    globals.CSS.escape = globals.CSS.escape ?? ((value: string) => value.replace(/["\\[\]]/g, "\\$&"));
    if (!window.matchMedia) {
        window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    }
}

// Puts `html` in the page and points the location at `url` (a github.com path), as GitHub's single-page app would.
export const mountGithubPage = (url: string, html: string) => {
    polyfill();
    const target = new URL(url);
    window.history.replaceState({}, "", target.pathname + target.search);
    document.body.innerHTML = html;
}
