// Fetches repository files from GitHub without any server of ours and without the REST API.
//
// Everything goes through https://github.com/<o>/<r>/raw/<ref>/<path> with the browser's own github.com login:
// GitHub redirects private-repo requests to raw.githubusercontent.com with a short-lived token, and public ones
// work signed out. Read-only, no stored secret, and nothing counts against the REST API rate limit.

import { findDiffEntry } from "./diff-entry";
import { assertRef, assertRepo, assertRepoPath, assertValid, encodePath, isSha } from "./github-urls";
import type { FileChange, FileRef, ProbeOutcome } from "../shared/messages";

export interface FetcherDeps {
    fetch: typeof fetch;
    now: () => number;
}

export class FetchError extends Error {
    constructor(message: string, readonly status: number, readonly retryable = false) {
        super(message);
    }
}

const GITHUB = "https://github.com";
const SESSION_HOSTS = new Set(["github.com", "raw.githubusercontent.com", "media.githubusercontent.com"]);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BACKOFF_MS = 60_000;

// credentials were attached, so make sure nothing steered us somewhere else or to a sign-in page
const isSessionRedirect = (finalUrl: URL): boolean =>
    !SESSION_HOSTS.has(finalUrl.hostname) || finalUrl.pathname === "/login" || finalUrl.pathname.startsWith("/session");

const readLimited = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
    if (!response.body) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
        return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export class FileFetcher {
    // earliest time github.com may be contacted again after it told us to back off
    private blockedUntil = 0;

    constructor(private deps: FetcherDeps) {}

    private checkBackoff(): void {
        const now = this.deps.now();
        if (now < this.blockedUntil) {
            throw new FetchError(`GitHub asked for a pause; retry in ${Math.ceil((this.blockedUntil - now) / 1000)}s.`, 429);
        }
    }

    private noteRateLimit(response: Response): void {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (retryAfter > 0) this.blockedUntil = this.deps.now() + retryAfter * 1000;
        else if (response.status === 429) this.blockedUntil = this.deps.now() + DEFAULT_BACKOFF_MS;
    }

    private async request(file: FileRef, maxBytes: number): Promise<Uint8Array> {
        this.checkBackoff();
        const url = `${GITHUB}/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/raw/${encodePath(file.ref)}/${encodePath(file.path)}`;
        const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });

        const finalUrl = new URL(response.url || url);
        if (isSessionRedirect(finalUrl)) throw new FetchError("Not signed in to GitHub in this browser.", 401);
        if (!response.ok) {
            this.noteRateLimit(response);
            throw new FetchError(`HTTP ${response.status}`, response.status);
        }
        if ((response.headers.get("content-type") || "").startsWith("text/html") && finalUrl.hostname === "github.com") {
            throw new FetchError("GitHub returned a web page instead of the file.", 404);
        }
        return readLimited(response, maxBytes);
    }

    // Status of one file in the diff between two commits, from github.com's own `.diff` view (browser login, no API).
    // Resolves to null whenever it cannot tell; the caller then infers the status from which side has the file.
    async fetchDiffEntry(owner: string, repo: string, before: string, after: string, path: string): Promise<FileChange | null> {
        assertRepo(owner, repo);
        assertValid(isSha(before) && isSha(after), "commit");
        assertRepoPath(path);
        try {
            this.checkBackoff();
            const url = `${GITHUB}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${before}..${after}.diff`;
            const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });
            const finalUrl = new URL(response.url || url);
            if (!response.ok) {
                this.noteRateLimit(response);
                return null;
            }
            if (isSessionRedirect(finalUrl) || finalUrl.hostname !== "github.com" || !response.body) return null;
            return await findDiffEntry(response.body, path);
        } catch {
            return null;
        }
    }

    async fetchBytes(file: FileRef, maxBytes = DEFAULT_MAX_BYTES): Promise<Uint8Array> {
        assertRepo(file.owner, file.repo);
        assertRef(file.ref);
        assertRepoPath(file.path);
        try {
            return await this.request(file, maxBytes);
        } catch (error) {
            if (!(error instanceof FetchError) || error.status === 413) throw error;
            throw new FetchError(this.describe(error), error.status);
        }
    }

    async fetchText(file: FileRef, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
        return new TextDecoder("utf-8").decode(await this.fetchBytes(file, maxBytes));
    }

    private describe(error: FetchError): string {
        if (error.status === 401 || error.status === 404) {
            return "File not found. If the repository is private, sign in to github.com in this browser first.";
        }
        if (error.status === 429 || error.status === 403) return `GitHub refused the request (rate limit or missing access). ${error.message}`;
        return `Could not fetch the file from GitHub. ${error.message}`;
    }

    // Diagnostics for the options page and issue reports: does the browser's GitHub login reach this file?
    async probe(file: FileRef): Promise<ProbeOutcome[]> {
        assertRepo(file.owner, file.repo);
        assertRef(file.ref);
        assertRepoPath(file.path);
        try {
            const bytes = await this.request(file, DEFAULT_MAX_BYTES);
            return [{ strategy: "session", ok: true, detail: `${bytes.length} bytes` }];
        } catch (error) {
            return [{ strategy: "session", ok: false, detail: error instanceof Error ? error.message : String(error) }];
        }
    }
}
