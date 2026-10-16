export type ViewerParams =
    | { kind: "blob"; owner: string; repo: string; rest: string; ref?: string; theme?: string }
    | { kind: "pr"; owner: string; repo: string; pr: string; path: string; range?: string; before?: string; after?: string; theme?: string; diag?: string };

// Extension pages have no server routes, so the viewer takes its input from the URL hash.
export const viewerHash = (params: ViewerParams): string => {
    const entries = Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return new URLSearchParams(entries).toString();
}

export const viewerUrl = (params: ViewerParams): string => `${chrome.runtime.getURL("viewer/viewer.html")}#${viewerHash(params)}`;
