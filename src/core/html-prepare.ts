// Prepares HTML documents from a repository for rendering in a locked-down frame.
//
// Two separate steps, so the diff can compare documents that have NOT had their URLs
// rewritten (rewriting embeds each side's commit SHA, which would make every untouched
// <img src="logo.png"> look changed):
//   1. sanitizeDocument: strips anything that executes and inlines repo-relative stylesheets.
//   2. rewriteUrls: points repo-relative URLs at inlined data: assets, or at GitHub raw as a fallback.

import { encodePath } from "./github-urls";

export interface PrepareContext {
    owner: string;
    repo: string;
    ref: string;
    // repo path of the HTML file being rendered
    path: string;
    // data: URL for a repo path whose bytes were already fetched; undefined falls back to a GitHub raw URL
    assetUrl?: (repoPath: string) => string | undefined;
}

type FetchText = (path: string) => Promise<string>;

export interface SanitizeOptions {
    // keep <script>, inline handlers and javascript: URLs (explicit opt-in, never used for diffs)
    allowScripts?: boolean;
    scripts?: Map<string, string>;
}

// Stylesheets are rewritten once, against their own location, into this scheme. It is resolved to a real
// URL by rewriteUrls, which keeps the diffed text independent of the commit the sheet came from.
const REPO_SCHEME = "hp-repo:";
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
const IMPORT_RULE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*([^;]*);/gi;
const CSS_URL = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
const MAX_STYLESHEETS = 8;
const MAX_STYLESHEET_FETCHES = 16;
const MAX_IMPORT_DEPTH = 3;
const MAX_SCRIPTS = 8;
const URL_ATTRIBUTES = ["src", "poster", "data"];

const dirOf = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

// the "?query#fragment" tail of a URL, which repository lookups ignore but rendering needs
const suffixOf = (href: string): string => /[?#].*$/.exec(href.trim())?.[0] ?? "";

export const resolveRepoPath = (fromFile: string, href: string): string | null => {
    const clean = href.trim().split("#")[0].split("?")[0];
    if (!clean || ABSOLUTE_URL.test(clean)) return null;
    const dir = dirOf(fromFile);
    try {
        const resolved = new URL(clean, `https://repo.invalid/${dir}${dir ? "/" : ""}`);
        return decodeURIComponent(resolved.pathname.replace(/^\//, ""));
    } catch {
        return null;
    }
}

const rawUrl = (ctx: PrepareContext, repoPath: string, suffix: string): string => {
    return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${encodePath(ctx.ref)}/${encodePath(repoPath)}${suffix}`;
}

const blobUrl = (ctx: PrepareContext, href: string): string => {
    const path = resolveRepoPath(ctx.path, href);
    if (path === null) return href;
    return `https://github.com/${ctx.owner}/${ctx.repo}/blob/${encodePath(ctx.ref)}/${encodePath(path)}${suffixOf(href)}`;
}

// URL for a repo-relative asset reference found in `fromFile`.
const assetUrl = (ctx: PrepareContext, fromFile: string, href: string): string => {
    const path = resolveRepoPath(fromFile, href);
    if (path === null) return href;
    return ctx.assetUrl?.(path) ?? rawUrl(ctx, path, suffixOf(href));
}

const rewriteCssUrls = (css: string, ctx: PrepareContext, fromFile: string): string => {
    return css.replace(CSS_URL, (match, quote: string, url: string) => {
        const trimmed = url.trim();
        if (trimmed.startsWith(REPO_SCHEME)) {
            const path = decodeURIComponent(trimmed.slice(REPO_SCHEME.length).replace(/^\//, "").split(/[?#]/)[0]);
            const resolved = ctx.assetUrl?.(path) ?? rawUrl(ctx, path, suffixOf(trimmed));
            return `url(${quote}${resolved}${quote})`;
        }
        if (ABSOLUTE_URL.test(trimmed)) return match;
        return `url(${quote}${assetUrl(ctx, fromFile, url)}${quote})`;
    });
}

// Rewrites a sheet's relative url()s into placeholders that no longer depend on where the sheet lives.
const anchorCssUrls = (css: string, sheetPath: string): string => {
    return css.replace(CSS_URL, (match, quote: string, url: string) => {
        if (ABSOLUTE_URL.test(url.trim())) return match;
        const path = resolveRepoPath(sheetPath, url);
        if (path === null) return match;
        return `url(${quote}${REPO_SCHEME}/${encodePath(path)}${suffixOf(url)}${quote})`;
    });
}

// srcset candidates are "<url> <descriptor>, ..." but a URL may itself contain commas
// (data: URLs), so split by the spec's rules rather than on every comma.
const rewriteSrcset = (srcset: string, rewrite: (url: string) => string): string => {
    const candidates: string[] = [];
    let i = 0;
    while (i < srcset.length) {
        while (i < srcset.length && (/\s/.test(srcset[i]) || srcset[i] === ",")) i++;
        const start = i;
        while (i < srcset.length && !/\s/.test(srcset[i])) i++;
        const url = srcset.slice(start, i);
        if (!url) break;

        const trailingCommas = /,+$/.exec(url);
        if (trailingCommas) {
            candidates.push(rewrite(url.slice(0, -trailingCommas[0].length)));
            continue;
        }

        const descriptorStart = i;
        let depth = 0;
        while (i < srcset.length && !(srcset[i] === "," && depth === 0)) {
            if (srcset[i] === "(") depth++;
            else if (srcset[i] === ")") depth--;
            i++;
        }
        candidates.push(rewrite(url) + srcset.slice(descriptorStart, i).replace(/\s+$/, ""));
    }
    return candidates.join(", ");
}

const linkedStylesheets = (doc: Document): HTMLLinkElement[] => {
    return Array.from(doc.querySelectorAll<HTMLLinkElement>("link[rel~='stylesheet'][href]"))
        .filter(link => !ABSOLUTE_URL.test(link.getAttribute("href")!.trim()));
}

const relativeScripts = (doc: Document): HTMLScriptElement[] => {
    return Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))
        .filter(script => !ABSOLUTE_URL.test(script.getAttribute("src")!.trim()));
}

const pathsOf = (elements: Element[], attribute: string, filePath: string, max: number): string[] => {
    const paths: string[] = [];
    for (const el of elements) {
        const path = resolveRepoPath(filePath, el.getAttribute(attribute)!);
        if (path !== null && paths.indexOf(path) < 0) paths.push(path);
    }
    return paths.slice(0, max);
}

// Repo paths of the relative stylesheets sanitizeDocument will try to inline.
export const getStylesheetPaths = (doc: Document, filePath: string): string[] => {
    return pathsOf(linkedStylesheets(doc), "href", filePath, MAX_STYLESHEETS);
}

export const getScriptPaths = (doc: Document, filePath: string): string[] => {
    return pathsOf(relativeScripts(doc), "src", filePath, MAX_SCRIPTS);
}

export interface ScriptSummary {
    // repo paths of the scripts in this repository that script mode will fetch and run
    local: string[];
    // addresses of scripts hosted elsewhere, exactly as written; the sandbox's default policy never loads them
    remote: string[];
    // inline scripts that run
    inline: number;
}

// Script types that run code (data blocks such as JSON-LD and import maps do not).
const EXECUTABLE_SCRIPT_TYPE = /^(|module|(text|application)\/(x-)?(java|ecma)script)$/i;

// What turning on script mode would run for this page; shown to the user before they agree.
export const describeScripts = (doc: Document, filePath: string): ScriptSummary => {
    const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>("script")).filter(script => EXECUTABLE_SCRIPT_TYPE.test((script.getAttribute("type") ?? "").trim()));
    const remote: string[] = [];
    let inline = 0;
    for (const script of scripts) {
        const src = script.getAttribute("src");
        if (src === null) {
            if (script.textContent?.trim()) inline++;
        } else if (ABSOLUTE_URL.test(src.trim())) {
            if (remote.indexOf(src.trim()) < 0) remote.push(src.trim());
        }
    }
    return { local: pathsOf(scripts.filter(script => script.hasAttribute("src") && !ABSOLUTE_URL.test(script.getAttribute("src")!.trim())), "src", filePath, MAX_SCRIPTS), remote, inline };
}

// Fetches stylesheets with their relative @import rules inlined (bounded depth, no cycles).
// url() references inside each sheet are anchored to that sheet's own location, so the
// result is self-contained.
export const loadStylesheets = async (paths: string[], fetchText: FetchText): Promise<Map<string, string>> => {
    const sheets = new Map<string, string>();
    let fetches = 0;

    const load = async (path: string, depth: number, ancestors: string[]): Promise<string | undefined> => {
        if (fetches >= MAX_STYLESHEET_FETCHES) return undefined;
        fetches++;

        let css: string;
        try {
            css = await fetchText(path);
        } catch {
            return undefined;
        }

        const chain = [...ancestors, path];
        let out = "";
        let last = 0;
        for (const match of Array.from(css.matchAll(IMPORT_RULE))) {
            out += css.slice(last, match.index!);
            last = match.index! + match[0].length;

            const [rule, , url, media] = match;
            const importPath = ABSOLUTE_URL.test(url) ? null : resolveRepoPath(path, url);
            const inlined = importPath !== null && depth < MAX_IMPORT_DEPTH && chain.indexOf(importPath) < 0
                ? await load(importPath, depth + 1, chain)
                : undefined;

            if (inlined === undefined) out += rule;
            else out += media.trim() ? `@media ${media.trim()}{${inlined}}` : inlined;
        }
        out += css.slice(last);
        return anchorCssUrls(out, path);
    }

    await Promise.all(paths.map(async path => {
        const css = await load(path, 0, []);
        if (css !== undefined) sheets.set(path, css);
    }));
    return sheets;
}

export const loadScripts = async (paths: string[], fetchText: FetchText): Promise<Map<string, string>> => {
    const scripts = new Map<string, string>();
    await Promise.all(paths.map(async path => {
        try {
            scripts.set(path, await fetchText(path));
        } catch { /* a missing script simply does not run */ }
    }));
    return scripts;
}

// Browsers ignore ASCII whitespace and control characters inside a URL's scheme ("java\tscript:" still runs).
const isScriptUrl = (value: string): boolean => /^javascript:/i.test(Array.from(value).filter(char => char.charCodeAt(0) > 0x20).join(""));

export const sanitizeDocument = (doc: Document, filePath: string, sheets: Map<string, string>, options: SanitizeOptions = {}) => {
    const { allowScripts = false, scripts = new Map<string, string>() } = options;
    doc.querySelectorAll("base, meta[http-equiv], object, embed, iframe[srcdoc]").forEach(el => el.remove());
    if (!allowScripts) doc.querySelectorAll("script, noscript").forEach(el => el.remove());

    for (const link of linkedStylesheets(doc)) {
        const path = resolveRepoPath(filePath, link.getAttribute("href")!);
        const css = path === null ? undefined : sheets.get(path);
        if (css === undefined) continue;

        const style = doc.createElement("style");
        style.setAttribute("data-hp-sheet", path!);
        const media = link.getAttribute("media");
        if (media) style.setAttribute("media", media);
        style.textContent = css;
        link.replaceWith(style);
    }

    if (allowScripts) {
        // raw.githubusercontent.com serves text/plain with nosniff, which browsers refuse to run as a script
        for (const script of relativeScripts(doc)) {
            const path = resolveRepoPath(filePath, script.getAttribute("src")!);
            const code = path === null ? undefined : scripts.get(path);
            if (code === undefined) continue;
            script.removeAttribute("src");
            script.textContent = code.replace(/<\/script/gi, "<\\/script");
        }
        return;
    }

    doc.querySelectorAll("*").forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on") || name === "srcdoc") {
                el.removeAttribute(attr.name);
            } else if (isScriptUrl(attr.value) && (name === "href" || name === "src" || name === "action" || name === "formaction" || name === "xlink:href")) {
                el.removeAttribute(attr.name);
            }
        }
    });
}

const rewriteElement = (el: Element, ctx: PrepareContext) => {
    const tag = el.tagName.toLowerCase();

    if (tag === "style") el.textContent = rewriteCssUrls(el.textContent || "", ctx, ctx.path);

    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", rewriteCssUrls(style, ctx, ctx.path));

    for (const name of URL_ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value && !ABSOLUTE_URL.test(value.trim())) el.setAttribute(name, assetUrl(ctx, ctx.path, value));
    }

    const srcset = el.getAttribute("srcset");
    if (srcset) {
        el.setAttribute("srcset", rewriteSrcset(srcset, url => ABSOLUTE_URL.test(url) ? url : assetUrl(ctx, ctx.path, url)));
    }

    if (tag === "link") {
        const href = el.getAttribute("href");
        if (href && !ABSOLUTE_URL.test(href.trim())) el.setAttribute("href", assetUrl(ctx, ctx.path, href));
    } else if (tag === "a" || tag === "area") {
        const href = el.getAttribute("href");
        if (href && !href.trim().startsWith("#")) {
            el.setAttribute("href", ABSOLUTE_URL.test(href.trim()) ? href : blobUrl(ctx, href));
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
        }
    }
}

// Rewrites repo-relative URLs under `root` (a document, fragment or element) in place.
export const rewriteUrls = (root: Node, ctx: PrepareContext) => {
    if (root.nodeType === 1) rewriteElement(root as Element, ctx);
    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
        (root as ParentNode).querySelectorAll("*").forEach(el => rewriteElement(el, ctx));
    }
}

// Repo paths of every asset rewriteUrls would point at, in first-seen order. Works on a throwaway copy.
export const collectAssetPaths = (doc: Document, ctx: Omit<PrepareContext, "assetUrl">): string[] => {
    const seen = new Set<string>();
    const copy = doc.cloneNode(true) as Document;
    rewriteUrls(copy, { ...ctx, assetUrl: path => { seen.add(path); return undefined; } });
    return Array.from(seen);
}

export const serializeDocument = (doc: Document): string => "<!DOCTYPE html>" + doc.documentElement.outerHTML;
