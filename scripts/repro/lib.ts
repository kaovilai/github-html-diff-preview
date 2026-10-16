// Offline reproduction of what the extension does with a file or a diff: which stylesheets and assets it would fetch,
// what sanitizing removes, and what the diff reports. Same modules as the extension, no browser.

import { assetMime, DEFAULT_BUDGET } from "../../src/core/assets";
import { buildViews, type DiffStats, type Side, type Views } from "../../src/core/html-diff";
import { collectAssetPaths, getScriptPaths, getStylesheetPaths, loadStylesheets, rewriteUrls, sanitizeDocument, type PrepareContext } from "../../src/core/html-prepare";

export type Parse = (html: string) => Document;

export interface Loc {
    owner: string;
    repo: string;
    ref: string;
    path: string;
}

export interface Fetchers {
    text: (path: string, ref: string) => Promise<string>;
    exists: (path: string, ref: string) => Promise<boolean>;
}

export interface SideReport {
    ref: string;
    path: string;
    bytes: number;
    stylesheets: { path: string; ok: boolean }[];
    assets: { path: string; ok: boolean }[];
    scripts: { path: string; local: boolean }[];
    removedBySanitizer: { scripts: number; handlers: number; javascriptUrls: number; objectsAndFrames: number; baseOrRefresh: number };
    warnings: string[];
}

const count = (doc: Document, selector: string) => doc.querySelectorAll(selector).length;

const removedBySanitizer = (doc: Document): SideReport["removedBySanitizer"] => ({
    scripts: count(doc, "script, noscript"),
    handlers: Array.from(doc.querySelectorAll("*")).filter(el => Array.from(el.attributes).some(a => a.name.toLowerCase().startsWith("on"))).length,
    javascriptUrls: Array.from(doc.querySelectorAll("[href],[src],[action],[formaction]")).filter(el => /^\s*javascript:/i.test(el.getAttribute("href") ?? el.getAttribute("src") ?? el.getAttribute("action") ?? el.getAttribute("formaction") ?? "")).length,
    objectsAndFrames: count(doc, "object, embed, iframe[srcdoc]"),
    baseOrRefresh: count(doc, "base, meta[http-equiv]")
});

export interface Prepared {
    report: SideReport;
    ctx: PrepareContext;
    makeDocument: () => Document;
}

export const prepareSide = async (html: string, loc: Loc, fetchers: Fetchers, parse: Parse): Promise<Prepared> => {
    const original = parse(html);
    const sheetPaths = getStylesheetPaths(original, loc.path);
    const sheets = await loadStylesheets(sheetPaths, path => fetchers.text(path, loc.ref));
    const makeDocument = () => {
        const doc = parse(html);
        sanitizeDocument(doc, loc.path, sheets);
        return doc;
    };

    const base = { owner: loc.owner, repo: loc.repo, ref: loc.ref, path: loc.path };
    const assetPaths = collectAssetPaths(makeDocument(), base);
    const candidates = assetPaths.filter(path => assetMime(path) !== undefined);
    const fetched = candidates.slice(0, DEFAULT_BUDGET.maxAssets);
    const assets = await Promise.all(fetched.map(async path => ({ path, ok: await fetchers.exists(path, loc.ref).catch(() => false) })));

    const warnings: string[] = [];
    for (const path of sheetPaths) if (!sheets.has(path)) warnings.push(`stylesheet ${path} could not be fetched, so its rules are missing from the preview`);
    for (const asset of assets) if (!asset.ok) warnings.push(`asset ${asset.path} could not be fetched`);
    if (candidates.length > fetched.length) warnings.push(`${candidates.length - fetched.length} asset(s) beyond the budget of ${DEFAULT_BUDGET.maxAssets} are not embedded`);
    const ignored = assetPaths.filter(path => assetMime(path) === undefined);
    if (ignored.length) warnings.push(`referenced files that are not images or fonts are not embedded: ${ignored.join(", ")}`);
    const removed = removedBySanitizer(original);
    if (removed.scripts) warnings.push(`${removed.scripts} script/noscript element(s) are removed; content built by JavaScript will not appear`);
    const externalSheets = Array.from(original.querySelectorAll("link[rel~='stylesheet'][href]")).filter(link => /^(https?:)?\/\//i.test(link.getAttribute("href")!));
    if (externalSheets.length) warnings.push(`${externalSheets.length} external stylesheet(s) load from their own servers`);

    return {
        report: {
            ref: loc.ref,
            path: loc.path,
            bytes: html.length,
            stylesheets: sheetPaths.map(path => ({ path, ok: sheets.has(path) })),
            assets,
            scripts: getScriptPaths(original, loc.path).map(path => ({ path, local: true })),
            removedBySanitizer: removed,
            warnings
        },
        ctx: { ...base, assetUrl: () => undefined },
        makeDocument
    };
}

export interface DiffReport {
    before: SideReport | null;
    after: SideReport | null;
    stats: DiffStats | null;
    views?: Views;
}

export const analyzeDiff = async (before: { html: string; loc: Loc } | null, after: { html: string; loc: Loc } | null, fetchers: Fetchers, parse: Parse): Promise<DiffReport> => {
    const [b, a] = await Promise.all([
        before ? prepareSide(before.html, before.loc, fetchers, parse) : null,
        after ? prepareSide(after.html, after.loc, fetchers, parse) : null
    ]);
    if (!b || !a) return { before: b?.report ?? null, after: a?.report ?? null, stats: null };
    const sides: { [side in Side]: Prepared } = { before: b, after: a };
    const views = buildViews(side => sides[side].makeDocument(), (root, side) => rewriteUrls(root, sides[side].ctx));
    return { before: b.report, after: a.report, stats: views.stats, views };
}
