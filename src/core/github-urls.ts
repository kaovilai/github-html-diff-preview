// Parsing and validation of GitHub URL pieces. Values that originate from a page URL or an
// extension-page hash end up in request paths, so they are validated here, not just encoded.

export const HTML_FILE = /\.html?$/i;

const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{7,40}$/i;
// branch/tag names: no leading/trailing/double slashes, no "..", no control characters
const REF = /^(?!\/)(?!.*(?:\/\/|\.\.|\/$|@\{|\\))[\w.\-/+@~^#%]+$/;

export interface BlobLocation {
    owner: string;
    repo: string;
    // "<ref>/<path>" exactly as in the URL; branch names may contain slashes, so the split is resolved later
    rest: string;
}

export interface PrLocation {
    owner: string;
    repo: string;
    pr: string;
    // undefined = whole PR, "<sha>" = single commit, "<from>..<to>" = commit range
    range?: string;
}

export const isValidName = (value: string): boolean => NAME.test(value);

export const isSha = (value: string): boolean => SHA.test(value);

export const isValidRef = (value: string): boolean => value.length <= 255 && REF.test(value);

export const assertValid = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`Invalid ${what}.`);
}

export const assertRepo = (owner: string, repo: string): void => {
    assertValid(isValidName(owner) && isValidName(repo), "repository");
}

export const assertRef = (ref: string): void => assertValid(isValidRef(ref), "ref");

export const assertRepoPath = (path: string): void => {
    assertValid(path.length > 0 && path.length <= 1024 && path.split("/").every(s => s !== "" && s !== "." && s !== ".."), "file path");
}

export const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

export const parseBlobPath = (pathname: string): BlobLocation | null => {
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(pathname);
    if (!match) return null;
    let rest: string;
    try {
        rest = decodeURIComponent(match[3]);
    } catch {
        return null;
    }
    if (!HTML_FILE.test(rest) || !rest.includes("/")) return null;
    return { owner: match[1], repo: match[2], rest };
}

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:(?:files|changes)(?:\/([^/]+))?|commits\/([0-9a-f]{7,40}))\/?$/;

export const parsePrPath = (pathname: string): PrLocation | null => {
    const match = PR_PATH.exec(pathname);
    if (!match) return null;
    return { owner: match[1], repo: match[2], pr: match[3], range: match[4] || match[5] };
}

// Splits "<ref>/<path>" into every plausible (ref, path) pair, shortest ref first. `hint` is a ref name the page
// itself displayed; it is trusted only when it really is a prefix of `rest`, so a wrong hint cannot redirect the lookup.
export const refCandidates = (rest: string, max = 5, hint?: string): { ref: string; path: string }[] => {
    if (hint && rest.startsWith(hint + "/") && rest.length > hint.length + 1) {
        return [{ ref: hint, path: rest.slice(hint.length + 1) }];
    }
    const segments = rest.split("/");
    const out: { ref: string; path: string }[] = [];
    for (let i = 1; i < segments.length && out.length < max; i++) {
        out.push({ ref: segments.slice(0, i).join("/"), path: segments.slice(i).join("/") });
    }
    return out;
}
