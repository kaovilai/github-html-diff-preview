import { send, type FileRef } from "../shared/messages";
import { collectAssetPaths, getStylesheetPaths, loadStylesheets, sanitizeDocument, type PrepareContext, type SanitizeOptions } from "../core/html-prepare";
import { loadAssets } from "../core/assets";

// No allow-scripts, so nothing in the previewed page can execute even though it shares this page's origin
// (same-origin only lets the diff view read the frames for scroll sync and change navigation); nested frames inherit the sandbox.
export const STATIC_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export const fetchText = (file: FileRef): Promise<string> => send<string>({ type: "file-text", ...file });

export const fetchAsset = (file: FileRef): Promise<string | undefined> => send<string | undefined>({ type: "asset", ...file });

export interface Side {
    owner: string;
    repo: string;
    ref: string;
    path: string;
    html: string;
}

export interface PreparedSide {
    ctx: PrepareContext;
    // a fresh sanitized document each call (the diff mutates its documents)
    makeDocument: () => Document;
}

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

// Loads everything the document refers to (relative stylesheets, images, fonts), once.
export const prepareSide = async (side: Side, options: Omit<SanitizeOptions, "scripts"> & { scripts?: Map<string, string> } = {}): Promise<PreparedSide> => {
    const file = (path: string): FileRef => ({ owner: side.owner, repo: side.repo, ref: side.ref, path });
    const sheetPaths = getStylesheetPaths(parse(side.html), side.path);
    const sheets = await loadStylesheets(sheetPaths, path => fetchText(file(path)));

    const makeDocument = () => {
        const doc = parse(side.html);
        sanitizeDocument(doc, side.path, sheets, options);
        return doc;
    }

    const base = { owner: side.owner, repo: side.repo, ref: side.ref, path: side.path };
    const assets = await loadAssets(collectAssetPaths(makeDocument(), base), path => fetchAsset(file(path)));
    return { ctx: { ...base, assetUrl: path => assets.get(path) }, makeDocument };
}

export const showError = (message: string) => {
    const status = byId("status");
    status.className = "error";
    status.textContent = message;
    status.hidden = false;
}

export const showNotice = (text: string) => {
    const notice = byId("notice");
    notice.textContent = text;
    notice.hidden = false;
}
