import { assertRepo, assertValid, isSha } from "./github-urls";
import type { FileFetcher } from "./fetcher";
import type { FileChange, PrDiffInfo, PrInfoRequest } from "../shared/messages";
import type { Settings } from "./settings";

const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const CACHE_TTL_MS = 60 * 1000;

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
    private cache = new Map<string, { at: number; info: Promise<PrDiffInfo> }>();

    constructor(private fetcher: FileFetcher, private getSettings: () => Promise<Settings>, private now: () => number = Date.now) {}

    get(req: PrInfoRequest): Promise<PrDiffInfo> {
        const key = `${req.owner}/${req.repo}#${req.pr}@${req.range ?? ""}`;
        const cached = this.cache.get(key);
        if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.info;

        const info = this.load(req);
        this.cache.set(key, { at: this.now(), info });
        info.catch(() => this.cache.delete(key));
        return info;
    }

    private async json<T>(path: string): Promise<T> {
        return await this.fetcher.apiJson(path, await this.getSettings()) as T;
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

    private async load({ owner, repo, pr, range }: PrInfoRequest): Promise<PrDiffInfo> {
        assertRepo(owner, repo);
        assertValid(Number.isInteger(pr) && pr > 0, "pull request number");
        const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

        if (range && /\.{2,3}/.test(range)) {
            const [from, to] = range.split(/\.{2,3}/);
            assertValid(isSha(from) && isSha(to), "commit range");
            const comparePath = `${repoPath}/compare/${from}...${to}`;
            const first = await this.json<Compare>(`${comparePath}?per_page=${PAGE_SIZE}&page=1`);
            const files = await this.listFiles<Compare>(comparePath, json => json.files, first);
            // the file list is a three-dot compare, so "before" must be the merge base for the two to agree
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
        const baseSha = pull.base.sha;
        const headSha = pull.head.sha;
        const [comparison, files] = await Promise.all([
            this.json<Compare>(`${repoPath}/compare/${baseSha}...${headSha}?per_page=1`),
            this.listFiles<ApiFile[]>(`${repoPath}/pulls/${pr}/files`, json => json)
        ]);
        // GitHub's PR diff is taken against the merge base, not the base branch tip
        return { before: comparison.merge_base_commit?.sha ?? baseSha, after: headSha, files: toFileMap(files) };
    }
}
