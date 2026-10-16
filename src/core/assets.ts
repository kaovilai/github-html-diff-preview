// Repo-relative images/fonts are fetched by the background worker and embedded as data: URLs, so they render
// from private repositories and without any cross-origin request from the preview frame.

export const ASSET_MIME: { [extension: string]: string } = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
    bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf"
};

export interface AssetBudget {
    maxAssets: number;
    maxBytesEach: number;
    maxBytesTotal: number;
    concurrency: number;
}

export const DEFAULT_BUDGET: AssetBudget = {
    maxAssets: 40,
    maxBytesEach: 2 * 1024 * 1024,
    maxBytesTotal: 12 * 1024 * 1024,
    concurrency: 6
};

export const assetMime = (path: string): string | undefined => {
    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase();
    return extension ? ASSET_MIME[extension] : undefined;
}

export const toDataUrl = (mime: string, bytes: Uint8Array): string => {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

// Approximate decoded size of a base64 data: URL.
const dataUrlBytes = (url: string): number => Math.floor((url.length - url.indexOf(",") - 1) * 3 / 4);

// `fetchAsset` resolves to a data: URL, or undefined when the asset is missing or too large.
export const loadAssets = async (
    paths: string[],
    fetchAsset: (path: string) => Promise<string | undefined>,
    budget: AssetBudget = DEFAULT_BUDGET
): Promise<Map<string, string>> => {
    const queue = paths.filter(path => assetMime(path) !== undefined).slice(0, budget.maxAssets);
    const assets = new Map<string, string>();
    let total = 0;

    const worker = async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
            if (total >= budget.maxBytesTotal) return;
            let url: string | undefined;
            try {
                url = await fetchAsset(path);
            } catch {
                continue;
            }
            if (url === undefined) continue;
            const size = dataUrlBytes(url);
            if (total + size > budget.maxBytesTotal) continue;
            total += size;
            assets.set(path, url);
        }
    }
    await Promise.all(Array.from({ length: Math.min(budget.concurrency, queue.length) }, worker));
    return assets;
}
