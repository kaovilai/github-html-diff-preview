import { chromium, expect, test as base, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { expect };

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/chrome");

// 1x1 transparent PNG
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export interface FakeRepo {
    // "<ref>/<path>" -> body; Buffers are served as binary
    files: { [key: string]: string | Buffer };
    // branch names GitHub would show on the page (needed to disambiguate refs containing slashes)
    refNames?: string[];
    pulls?: { [number: number]: { base: string; head: string; mergeBase: string; files: { filename: string; status: string; previous_filename?: string }[] } };
}

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "ghp-e2e-"));
        const context = await chromium.launchPersistentContext(dir, {
            channel: "chromium",
            headless: true,
            args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
        });
        await use(context);
        await context.close();
        await rm(dir, { recursive: true, force: true });
    },
    extensionId: async ({ context }, use) => {
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent("serviceworker");
        await use(new URL(worker.url()).host);
    }
});

const NEW_LAYOUT_PR = (files: string[]) => `<!doctype html><html data-color-mode="light"><body>
${files.map(file => `<section class="file-card"><h3>${file}</h3><div><button data-file-path="${file}">Expand</button></div>
<table role="grid" aria-label="Diff for: ${file}"><tbody><tr><td>diff</td></tr></tbody></table></section>`).join("\n")}
</body></html>`;

const BLOB_PAGE = (owner: string, repo: string, rest: string, refName?: string) => `<!doctype html><html><body>
${refName ? `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { refInfo: { name: refName } } })}</script>` : ""}
<div class="toolbar"><a data-testid="raw-button" class="btn" href="/${owner}/${repo}/raw/${rest}">Raw</a></div></body></html>`;

// Serves just enough of github.com, raw files and api.github.com for the extension to work, without a network.
export const fakeGithub = async (context: BrowserContext, repo: FakeRepo, owner = "o", name = "r") => {
    const requests: string[] = [];
    const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

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
        const blob = new RegExp(`^/${owner}/${name}/blob/(.+)$`).exec(url.pathname);
        if (blob) return route.fulfill({ status: 200, contentType: "text/html", body: BLOB_PAGE(owner, name, decodeURIComponent(blob[1]), repo.refNames?.find(ref => decodeURIComponent(blob[1]).startsWith(ref + "/"))) });
        const pull = new RegExp(`^/${owner}/${name}/pull/(\\d+)/(files|changes)`).exec(url.pathname);
        if (pull) {
            const info = repo.pulls?.[Number(pull[1])];
            return route.fulfill({ status: 200, contentType: "text/html", body: NEW_LAYOUT_PR((info?.files ?? []).map(file => file.filename)) });
        }
        return route.fulfill({ status: 404, body: "" });
    });

    await context.route(`https://api.github.com/repos/${owner}/${name}/**`, route => {
        const url = new URL(route.request().url());
        requests.push(`api:${url.pathname}`);
        const prefix = `/repos/${owner}/${name}`;
        for (const [number, pr] of Object.entries(repo.pulls ?? {})) {
            if (url.pathname === `${prefix}/pulls/${number}/files`) return json(route, pr.files);
            if (url.pathname === `${prefix}/pulls/${number}`) return json(route, { base: { sha: pr.base }, head: { sha: pr.head } });
            if (url.pathname.startsWith(`${prefix}/compare/`)) return json(route, { merge_base_commit: { sha: pr.mergeBase }, files: pr.files });
        }
        const contents = new RegExp(`^${prefix}/contents/(.+)$`).exec(url.pathname);
        if (contents) {
            const key = `${url.searchParams.get("ref")}/${decodeURIComponent(contents[1])}`;
            const body = repo.files[key];
            return body === undefined ? json(route, { message: "Not Found" }, 404) : route.fulfill({ status: 200, contentType: "text/plain", body });
        }
        return json(route, { message: "Not Found" }, 404);
    });

    return { requests };
}

export const openViewerFrame = (page: Page) => page.frameLocator("iframe").first();
