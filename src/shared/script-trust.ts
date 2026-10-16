// Repositories the user chose to "always allow" scripts for. Kept in the extension pages' own storage (shared by the
// preview and options pages, which are the same origin), so the extension needs no `storage` permission.
const KEY = "trustedScriptRepos";

const VALID = /^[^/\s]+\/[^/\s]+$/;

// GitHub treats owner and repository names case-insensitively.
export const repoKey = (owner: string, repo: string): string => `${owner}/${repo}`.toLowerCase();

const save = (repos: string[]): boolean => {
    try {
        if (repos.length) localStorage.setItem(KEY, JSON.stringify(repos));
        else localStorage.removeItem(KEY);
        return true;
    } catch {
        return false;
    }
}

export const listTrusted = (): string[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return Array.from(new Set(parsed.filter((item): item is string => typeof item === "string" && VALID.test(item)))).sort();
    } catch {
        return [];
    }
}

export const isTrusted = (owner: string, repo: string): boolean => listTrusted().includes(repoKey(owner, repo));

// false when storage is unavailable, so the caller can say the choice will not be remembered
export const trustRepo = (owner: string, repo: string): boolean => save(Array.from(new Set([...listTrusted(), repoKey(owner, repo)])).sort());

export const untrustRepo = (key: string): boolean => save(listTrusted().filter(item => item !== key.toLowerCase()));

export const untrustAll = (): boolean => save([]);
