import { chromium, expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { expect };

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/chrome");

// 1x1 transparent PNG
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export interface FakePull {
    base: string;
    head: string;
    mergeBase: string;
    files: { filename: string; status: string; previous_filename?: string }[];
    // what GitHub's own diff view requests when the page loads (`/diffs/<before>..<after>`); omitted = the page tells us nothing
    pageDiffs?: { before: string; after: string };
}

export interface FakeRepo {
    // "<ref>/<path>" -> body; Buffers are served as binary
    files: { [key: string]: string | Buffer };
    // branch names GitHub would show on the page (needed to disambiguate refs containing slashes)
    refNames?: string[];
    pulls?: { [number: number]: FakePull };
}

type Launch = (options?: Parameters<typeof chromium.launchPersistentContext>[1]) => Promise<BrowserContext>;

// A Chromium with the unpacked extension loaded; contexts are closed (and their profile directories removed) after the test.
export const test = base.extend<{ context: BrowserContext; extensionId: string; launch: Launch; mobileContext: BrowserContext }>({
    // eslint-disable-next-line no-empty-pattern
    launch: async ({}, use) => {
        const dirs: string[] = [];
        const contexts: BrowserContext[] = [];
        await use(async options => {
            const dir = await mkdtemp(path.join(os.tmpdir(), "ghp-e2e-"));
            dirs.push(dir);
            const context = await chromium.launchPersistentContext(dir, {
                channel: "chromium",
                headless: true,
                ...options,
                args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...(options?.args ?? [])]
            });
            contexts.push(context);
            return context;
        });
        for (const context of contexts) await context.close();
        for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    },
    context: async ({ launch }, use) => {
        await use(await launch());
    },
    // a phone-sized viewport with touch input: coarse pointer, no hover
    mobileContext: async ({ launch }, use) => {
        await use(await launch({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    },
    extensionId: async ({ context }, use) => {
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent("serviceworker");
        await use(new URL(worker.url()).host);
    }
});

export const extensionIdOf = async (context: BrowserContext): Promise<string> => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    return new URL(worker.url()).host;
}

const NEW_LAYOUT_PR = (owner: string, repo: string, files: string[], diffs?: { before: string; after: string }) => `<!doctype html><html data-color-mode="light"><body>
${diffs ? `<script>fetch("/${owner}/${repo}/diffs/${diffs.before}..${diffs.after}?base_sha=${diffs.before}&whitespace_ignored=false", { method: "POST" });</script>
<a href="/${owner}/${repo}/blob/${diffs.after}/${files[0] ?? "x.html"}">View file</a>` : ""}
${files.map(file => `<section class="file-card"><h3>${file}</h3><div><button data-file-path="${file}">Expand</button></div>
<table role="grid" aria-label="Diff for: ${file}"><tbody><tr><td>diff</td></tr></tbody></table></section>`).join("\n")}
</body></html>`;

const BLOB_PAGE = (owner: string, repo: string, rest: string, refName?: string) => `<!doctype html><html><body>
${refName ? `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { refInfo: { name: refName } } })}</script>` : ""}
<div class="toolbar"><a data-testid="raw-button" class="btn" href="/${owner}/${repo}/raw/${rest}">Raw</a></div></body></html>`;

// Serves just enough of github.com, raw files and api.github.com for the extension to work, without a network.
export const fakeGithub = async (context: BrowserContext, repo: FakeRepo, owner = "o", name = "r") => {
    const requests: string[] = [];

    await context.route(`https://github.com/${owner}/${name}/**`, route => {
        const url = new URL(route.request().url());
        requests.push(url.pathname);
        const raw = new RegExp(`^/${owner}/${name}/raw/(.+)$`).exec(url.pathname);
        if (raw) {
            const rest = decodeURIComponent(raw[1]);
            const key = Object.keys(repo.files).find(candidate => candidate === rest);
            if (!key) return route.fulfill({ status: 404, body: "Not Found" });
            const body = repo.files[key];
            const type = Buffer.isBuffer(body) ? "image/png" : "text/plain; charset=utf-8";
            return route.fulfill({ status: 200, contentType: type, body });
        }
        if (url.pathname.startsWith(`/${owner}/${name}/diffs/`)) return route.fulfill({ status: 200, contentType: "text/html", body: "" });
        const unified = new RegExp(`^/${owner}/${name}/compare/[0-9a-f]+\\.\\.[0-9a-f]+\\.diff$`).exec(url.pathname);
        if (unified) {
            const files = Object.values(repo.pulls ?? {})[0]?.files ?? [];
            const text = files.map(file => [
                `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}`,
                ...(file.status === "added" ? ["new file mode 100644"] : file.status === "removed" ? ["deleted file mode 100644"] : file.status === "renamed" ? ["similarity index 90%", `rename from ${file.previous_filename}`, `rename to ${file.filename}`] : []),
                "--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b"
            ].join("\n")).join("\n");
            return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: text + "\n" });
        }
        const blob = new RegExp(`^/${owner}/${name}/blob/(.+)$`).exec(url.pathname);
        if (blob) return route.fulfill({ status: 200, contentType: "text/html", body: BLOB_PAGE(owner, name, decodeURIComponent(blob[1]), repo.refNames?.find(ref => decodeURIComponent(blob[1]).startsWith(ref + "/"))) });
        const pull = new RegExp(`^/${owner}/${name}/pull/(\\d+)/(files|changes|commits)`).exec(url.pathname);
        if (pull) {
            const info = repo.pulls?.[Number(pull[1])];
            return route.fulfill({ status: 200, contentType: "text/html", body: NEW_LAYOUT_PR(owner, name, (info?.files ?? []).map(file => file.filename), info?.pageDiffs) });
        }
        return route.fulfill({ status: 404, body: "" });
    });

    // the extension never calls the REST API: any request to it fails loudly
    await context.route("https://api.github.com/**", route => {
        requests.push(`api:${new URL(route.request().url()).pathname}`);
        return route.fulfill({ status: 500, body: "the extension must not use the REST API" });
    });

    return { requests };
}

export const openViewerFrame = (page: Page) => page.frameLocator("iframe").first();

// Turns on "Run scripts" in a single-file preview and answers the confirmation with "Run this time".
export const enableScripts = async (viewer: Page) => {
    await viewer.locator("#run-scripts").check();
    await viewer.locator("#scripts-once").click();
}
