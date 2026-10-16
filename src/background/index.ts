import { FileFetcher, FetchError } from "../core/fetcher";
import { PrInfoLoader } from "../core/pr-info";
import { assetMime, DEFAULT_BUDGET, toDataUrl } from "../core/assets";
import { assertRef, assertRepo, assertRepoPath, parseBlobPath, refCandidates } from "../core/github-urls";
import { loadSettings } from "../core/settings";
import type { FileRef, Request, Response, ResolvedBlob } from "../shared/messages";
import { viewerUrl } from "../shared/viewer-url";

const fetcher = new FileFetcher({ fetch: (input, init) => fetch(input, init), getSettings: loadSettings, now: Date.now });
const prInfo = new PrInfoLoader(fetcher, loadSettings);

const MENU_PAGE = "preview-page";
const MENU_LINK = "preview-link";

// Only the extension's own pages may read file contents through the worker (it can attach the user's GitHub session
// or token); content scripts on github.com may only ask it to open a preview tab.
const isOwnPage = (sender: chrome.runtime.MessageSender): boolean => {
    const url = sender.url ?? "";
    return sender.id === chrome.runtime.id && (url.startsWith(chrome.runtime.getURL("viewer/viewer.html")) || url.startsWith(chrome.runtime.getURL("options/options.html")));
}

const resolveBlob = async (owner: string, repo: string, rest: string, hint?: string): Promise<ResolvedBlob> => {
    assertRepo(owner, repo);
    const candidates = refCandidates(rest, 5, hint);
    let lastError: unknown = new Error("Invalid file location.");
    for (const { ref, path } of candidates) {
        try {
            return { ref, path, text: await fetcher.fetchText({ owner, repo, ref, path }) };
        } catch (error) {
            lastError = error;
            // a different ref/path split can still work after a miss, but not after a rate limit or size error
            if (!(error instanceof FetchError) || error.status !== 404 && error.status !== 401) throw error;
        }
    }
    throw lastError;
}

const fetchAsset = async (file: FileRef): Promise<string | undefined> => {
    const mime = assetMime(file.path);
    if (!mime) return undefined;
    return toDataUrl(mime, await fetcher.fetchBytes(file, DEFAULT_BUDGET.maxBytesEach));
}

const probe = async (url: string) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") throw new Error("Not a github.com URL.");
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(decodeURIComponent(parsed.pathname));
    if (!match) throw new Error("Expected a github.com/<owner>/<repo>/blob/<ref>/<path> URL.");
    const [, owner, repo, rest] = match;
    let first: { ref: string; path: string; outcomes: Awaited<ReturnType<FileFetcher["probe"]>> } | undefined;
    for (const { ref, path } of refCandidates(rest)) {
        const outcomes = await fetcher.probe({ owner, repo, ref, path });
        first ??= { ref, path, outcomes };
        if (outcomes.some(outcome => outcome.ok)) return { ref, path, outcomes };
    }
    if (!first) throw new Error("Expected a github.com/<owner>/<repo>/blob/<ref>/<path> URL.");
    return first;
}

const handle = async (request: Request, sender: chrome.runtime.MessageSender): Promise<unknown> => {
    if (request.type === "open-preview") {
        if (!sender.tab?.url?.startsWith("https://github.com/")) throw new Error("Request not allowed from this context.");
        assertRepo(request.owner, request.repo);
        await chrome.tabs.create({ url: viewerUrl({ kind: "blob", owner: request.owner, repo: request.repo, rest: request.rest, ref: request.ref }), index: sender.tab.index + 1, openerTabId: sender.tab.id });
        return null;
    }

    if (!isOwnPage(sender)) throw new Error("Request not allowed from this context.");
    switch (request.type) {
        case "resolve-blob":
            return resolveBlob(request.owner, request.repo, request.rest, request.ref);
        case "file-text":
            return fetcher.fetchText(request);
        case "asset":
            assertRepo(request.owner, request.repo);
            assertRef(request.ref);
            assertRepoPath(request.path);
            return fetchAsset(request);
        case "pr-info":
            return prInfo.get(request);
        case "probe":
            return probe(request.url);
        default:
            throw new Error("Unknown request.");
    }
}

chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse: (response: Response<unknown>) => void) => {
    handle(request, sender).then(
        data => sendResponse({ ok: true, data }),
        error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
    return true;
});

const openBlob = async (url: string | undefined, tab?: chrome.tabs.Tab) => {
    if (!url) return;
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return;
    const blob = parseBlobPath(parsed.pathname);
    if (!blob) return;
    // the page knows which part of the URL is the branch name; ask it when this is the page being viewed
    let ref: string | undefined;
    if (tab?.id !== undefined && tab.url === url) {
        ref = await chrome.tabs.sendMessage(tab.id, { type: "get-ref", rest: blob.rest }).then(reply => reply?.ref, () => undefined);
    }
    await chrome.tabs.create({ url: viewerUrl({ kind: "blob", ...blob, ref }), index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: MENU_PAGE, title: "Preview HTML file", contexts: ["page"], documentUrlPatterns: ["https://github.com/*.html", "https://github.com/*.htm"] });
        chrome.contextMenus.create({ id: MENU_LINK, title: "Preview HTML file", contexts: ["link"], targetUrlPatterns: ["https://github.com/*/blob/*.html", "https://github.com/*/blob/*.htm"] });
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    void openBlob(info.menuItemId === MENU_LINK ? info.linkUrl : info.pageUrl, tab);
});

chrome.commands.onCommand.addListener(async command => {
    if (command !== "preview") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await openBlob(tab?.url, tab);
});

chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage();
});
