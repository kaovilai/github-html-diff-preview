// Messages between extension pages / content scripts and the background worker.

export interface PrInfoRequest {
    owner: string;
    repo: string;
    pr: number;
    range?: string;
}

export interface FileRef {
    owner: string;
    repo: string;
    ref: string;
    path: string;
}

export type Request =
    | { type: "resolve-blob"; owner: string; repo: string; rest: string; ref?: string }
    | ({ type: "file-text" } & FileRef)
    | ({ type: "asset" } & FileRef)
    | ({ type: "pr-info" } & PrInfoRequest)
    | { type: "probe"; url: string }
    | { type: "open-preview"; owner: string; repo: string; rest: string; ref?: string };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ResolvedBlob {
    ref: string;
    path: string;
    text: string;
}

export interface FileChange {
    status: string;
    previous?: string;
}

export interface PrDiffInfo {
    before: string | null;
    after: string;
    files: { [path: string]: FileChange };
}

export type ProbeOutcome = { strategy: string; ok: boolean; detail: string };

export const send = async <T>(request: Request): Promise<T> => {
    const response: Response<T> | undefined = await chrome.runtime.sendMessage(request);
    if (!response) throw new Error("No response from the extension background worker.");
    if (!response.ok) throw new Error(response.error);
    return response.data;
}
