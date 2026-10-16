// Developer tool only (the extension itself never calls the REST API): finds the two commits a pull request compares
// and its changed files, for `npm run repro -- pr`. Runs in CI with GITHUB_TOKEN or locally with GH_TOKEN.

import { assertRepo, assertValid, isSha } from "../../src/core/github-urls";
import type { FileChange } from "../../src/shared/messages";

export interface PrInfoRequest {
    owner: string;
    repo: string;
    pr: number;
    range?: string;
}

export interface PrDiffInfo {
    before: string | null;
    after: string;
    files: { [path: string]: FileChange };
}

const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

interface ApiFile { filename: string; status: string; previous_filename?: string }
interface Compare { files?: ApiFile[]; merge_base_commit?: { sha: string } }
interface Commit { sha: string; files?: ApiFile[]; parents?: { sha: string }[] }
interface Pull { base: { sha: string }; head: { sha: string } }

const toFileMap = (files: ApiFile[]): { [path: string]: FileChange } => {
    const map: { [path: string]: FileChange } = {};
    for (const file of files) map[file.filename] = { status: file.status, previous: file.previous_filename };
    return map;
}

export class PrInfoLoader {
    constructor(private deps: { fetch: typeof fetch; token?: string }) {}

    private async json<T>(path: string): Promise<T> {
        const headers: { [name: string]: string } = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
        if (this.deps.token) headers["Authorization"] = `Bearer ${this.deps.token}`;
        const response = await this.deps.fetch(`${API}${path}`, { headers });
        if (!response.ok) throw new Error(`GitHub API request failed (HTTP ${response.status}) for ${path}.`);
        return response.json() as Promise<T>;
    }

    // `first` is page 1 when the caller already fetched it, so it is not requested twice.
    private async listFiles<T>(path: string, pick: (json: T) => ApiFile[] | undefined, first?: T): Promise<ApiFile[]> {
        const files: ApiFile[] = [];
        const separator = path.includes("?") ? "&" : "?";
        for (let page = 1; page <= MAX_PAGES; page++) {
            const json = page === 1 && first !== undefined ? first : await this.json<T>(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);
            const items = pick(json) || [];
            files.push(...items);
            if (items.length < PAGE_SIZE) break;
        }
        return files;
    }

    async get({ owner, repo, pr, range }: PrInfoRequest): Promise<PrDiffInfo> {
        assertRepo(owner, repo);
        assertValid(Number.isInteger(pr) && pr > 0, "pull request number");
        const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

        if (range && /\.{2,3}/.test(range)) {
            const [from, to] = range.split(/\.{2,3}/);
            assertValid(isSha(from) && isSha(to), "commit range");
            const comparePath = `${repoPath}/compare/${from}...${to}`;
            const first = await this.json<Compare>(`${comparePath}?per_page=${PAGE_SIZE}&page=1`);
            const files = await this.listFiles<Compare>(comparePath, json => json.files, first);
            return { before: first.merge_base_commit?.sha ?? from, after: to, files: toFileMap(files) };
        }

        if (range) {
            assertValid(isSha(range), "commit");
            const commitPath = `${repoPath}/commits/${range}`;
            const commit = await this.json<Commit>(`${commitPath}?per_page=${PAGE_SIZE}&page=1`);
            const files = await this.listFiles<Commit>(commitPath, json => json.files, commit);
            return { before: commit.parents?.[0]?.sha ?? null, after: commit.sha, files: toFileMap(files) };
        }

        const pull = await this.json<Pull>(`${repoPath}/pulls/${pr}`);
        const [comparison, files] = await Promise.all([
            this.json<Compare>(`${repoPath}/compare/${pull.base.sha}...${pull.head.sha}?per_page=1`),
            this.listFiles<ApiFile[]>(`${repoPath}/pulls/${pr}/files`, json => json)
        ]);
        // GitHub's PR diff is taken against the merge base, not the base branch tip
        return { before: comparison.merge_base_commit?.sha ?? pull.base.sha, after: pull.head.sha, files: toFileMap(files) };
    }
}
