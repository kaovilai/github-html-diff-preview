// Fetches repository files from GitHub without any server of ours.
//
// Strategies, tried in order for the "auto" auth mode:
//   session   https://github.com/<o>/<r>/raw/<ref>/<path> with the browser's own github.com login
//             (GitHub redirects private-repo requests to raw.githubusercontent.com with a short-lived
//             token). Needs no stored secret and does not count against the REST API rate limit.
//   token     api.github.com contents API with the user's personal access token.
//   anonymous api.github.com contents API without credentials (public repositories, 60 requests/hour).

import { findDiffEntry } from "./diff-entry";
import { assertRef, assertRepo, assertRepoPath, assertValid, encodePath, isSha } from "./github-urls";
import type { FileChange, FileRef, ProbeOutcome } from "../shared/messages";
import type { AuthMode, Settings } from "./settings";

export type Strategy = "session" | "token" | "anonymous";

export interface FetcherDeps {
    fetch: typeof fetch;
    getSettings: () => Promise<Settings>;
    now: () => number;
}

export class FetchError extends Error {
    constructor(message: string, readonly status: number, readonly retryable = false) {
        super(message);
    }
}

const API = "https://api.github.com";
const GITHUB = "https://github.com";
const SESSION_HOSTS = new Set(["github.com", "raw.githubusercontent.com", "media.githubusercontent.com"]);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BACKOFF_MS = 60_000;

const ORDER: { [mode in AuthMode]: Strategy[] } = {
    auto: ["session", "token", "anonymous"],
    session: ["session"],
    token: ["token"],
    anonymous: ["anonymous"]
};

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
    // earliest time each endpoint family may be contacted again after GitHub told us to back off
    private blockedUntil: { [family: string]: number } = {};

    constructor(private deps: FetcherDeps) {}

    private checkBackoff(family: string): void {
        const until = this.blockedUntil[family] ?? 0;
        const now = this.deps.now();
        if (now < until) {
            throw new FetchError(`GitHub rate limit reached; retry in ${Math.ceil((until - now) / 1000)}s.`, 429);
        }
    }

    private noteRateLimit(family: string, response: Response): void {
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        const retryAfter = Number(response.headers.get("retry-after"));
        let until = 0;
        if (retryAfter > 0) until = this.deps.now() + retryAfter * 1000;
        else if (remaining === "0" && reset > 0) until = reset * 1000;
        else if (response.status === 429) until = this.deps.now() + DEFAULT_BACKOFF_MS;
        if (until > 0) this.blockedUntil[family] = until;
    }

    private async viaSession(file: FileRef, maxBytes: number): Promise<Uint8Array> {
        this.checkBackoff("session");
        const url = `${GITHUB}/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/raw/${encodePath(file.ref)}/${encodePath(file.path)}`;
        const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });

        const finalUrl = new URL(response.url || url);
        if (isSessionRedirect(finalUrl)) {
            throw new FetchError("Not signed in to GitHub in this browser.", 401);
        }
        if (!response.ok) {
            this.noteRateLimit("session", response);
            throw new FetchError(`HTTP ${response.status}`, response.status);
        }
        if ((response.headers.get("content-type") || "").startsWith("text/html") && finalUrl.hostname === "github.com") {
            throw new FetchError("GitHub returned a web page instead of the file.", 404);
        }
        return readLimited(response, maxBytes);
    }

    private async viaApi(file: FileRef, token: string | null, maxBytes: number): Promise<Uint8Array> {
        this.checkBackoff("api");
        const url = `${API}/repos/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/contents/${encodePath(file.path)}?ref=${encodeURIComponent(file.ref)}`;
        const headers: { [name: string]: string } = {
            "Accept": "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28"
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const response = await this.deps.fetch(url, { headers, credentials: "omit" });
        if (!response.ok) {
            this.noteRateLimit("api", response);
            throw new FetchError(`HTTP ${response.status}`, response.status);
        }
        return readLimited(response, maxBytes);
    }

    private run(strategy: Strategy, file: FileRef, token: string, maxBytes: number): Promise<Uint8Array> {
        if (strategy === "session") return this.viaSession(file, maxBytes);
        if (strategy === "token") return this.viaApi(file, token, maxBytes);
        return this.viaApi(file, null, maxBytes);
    }

    async fetchBytes(file: FileRef, maxBytes = DEFAULT_MAX_BYTES): Promise<Uint8Array> {
        assertRepo(file.owner, file.repo);
        assertRef(file.ref);
        assertRepoPath(file.path);

        const settings = await this.deps.getSettings();
        const strategies = ORDER[settings.authMode].filter(s => s !== "token" || settings.token);
        if (!strategies.length) throw new FetchError("No GitHub token is configured. Add one in the extension options.", 401);

        const failures: string[] = [];
        let status = 0;
        for (const strategy of strategies) {
            try {
                return await this.run(strategy, file, settings.token, maxBytes);
            } catch (error) {
                if (error instanceof FetchError && error.status === 413) throw error;
                const fetchError = error instanceof FetchError ? error : new FetchError(String(error), 0);
                failures.push(`${strategy}: ${fetchError.message}`);
                // the most informative status wins: a 404 from an authorized strategy beats a login failure
                if (status === 0 || fetchError.status === 404 || fetchError.status === 429) status = fetchError.status;
            }
        }
        throw new FetchError(this.describe(status, failures), status);
    }

    // Status of one file in the diff between two commits, from github.com's own `.diff` view (browser login, no API).
    // Resolves to null whenever it cannot tell; the caller then infers the status from which side has the file.
    async fetchDiffEntry(owner: string, repo: string, before: string, after: string, path: string): Promise<FileChange | null> {
        assertRepo(owner, repo);
        assertValid(isSha(before) && isSha(after), "commit");
        assertRepoPath(path);
        try {
            this.checkBackoff("session");
            const url = `${GITHUB}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${before}..${after}.diff`;
            const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });
            const finalUrl = new URL(response.url || url);
            if (!response.ok) {
                this.noteRateLimit("session", response);
                return null;
            }
            if (isSessionRedirect(finalUrl) || finalUrl.hostname !== "github.com" || !response.body) return null;
            return await findDiffEntry(response.body, path);
        } catch {
            return null;
        }
    }

    async fetchText(file: FileRef, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
        return new TextDecoder("utf-8").decode(await this.fetchBytes(file, maxBytes));
    }

    private describe(status: number, failures: string[]): string {
        const detail = failures.join("; ");
        if (status === 429 || status === 403) return `GitHub refused the request (rate limit or missing access). ${detail}`;
        if (status === 404 || status === 401) {
            return `File not found. For a private repository, sign in to github.com in this browser or add a token in the extension options. ${detail}`;
        }
        return `Could not fetch the file from GitHub. ${detail}`;
    }

    // Diagnostics: tries each strategy on its own so the user can see which ones work for a file.
    async probe(file: FileRef): Promise<ProbeOutcome[]> {
        assertRepo(file.owner, file.repo);
        assertRef(file.ref);
        assertRepoPath(file.path);
        const settings = await this.deps.getSettings();
        const strategies: Strategy[] = ["session", "token", "anonymous"];
        const out: ProbeOutcome[] = [];
        for (const strategy of strategies) {
            if (strategy === "token" && !settings.token) {
                out.push({ strategy, ok: false, detail: "skipped (no token configured)" });
                continue;
            }
            try {
                const bytes = await this.run(strategy, file, settings.token, DEFAULT_MAX_BYTES);
                out.push({ strategy, ok: true, detail: `${bytes.length} bytes` });
            } catch (error) {
                out.push({ strategy, ok: false, detail: error instanceof Error ? error.message : String(error) });
            }
        }
        return out;
    }

    // Uses the stricter API-only path for metadata that the raw endpoint cannot provide.
    async apiJson(path: string, settings: Settings): Promise<unknown> {
        this.checkBackoff("api");
        const tokens: (string | null)[] = settings.authMode === "anonymous" || !settings.token ? [null] : [settings.token, null];
        let status = 0;
        for (const token of tokens) {
            const headers: { [name: string]: string } = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const response = await this.deps.fetch(`${API}${path}`, { headers, credentials: "omit" });
            if (response.ok) return response.json();
            this.noteRateLimit("api", response);
            status = response.status;
            if (status !== 401 && status !== 403 && status !== 404) break;
        }
        if (status === 404) throw new FetchError("Not found. If this is a private repository, add a GitHub token in the extension options (pull request previews need the API).", 404);
        if (status === 401 || status === 403) throw new FetchError("GitHub denied the request (rate limit or missing access). Add a GitHub token in the extension options.", status);
        throw new FetchError(`GitHub API request failed (HTTP ${status}).`, status);
    }
}
