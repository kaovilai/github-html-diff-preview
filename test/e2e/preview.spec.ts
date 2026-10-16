import { expect, fakeGithub, PNG, test } from "./fixtures";

const PAGE = `<!doctype html><html><head><link rel="stylesheet" href="style.css"><title>t</title></head>
<body><h1 id="title">Hello</h1><img id="logo" src="img/logo.png"><a id="doc" href="README.md">docs</a>
<script>document.getElementById("title").textContent = "script ran";</script></body></html>`;

const files = {
    "main/dir/page.html": PAGE,
    "main/dir/style.css": "h1{color:rgb(1,2,3);background:url(img/logo.png)}",
    "main/dir/img/logo.png": PNG
};

test.describe("single file preview", () => {
    test("Preview button opens a local viewer that inlines stylesheets and images", async ({ context }) => {
        const gh = await fakeGithub(context, { files });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/dir/page.html");

        const button = page.locator("[data-hp-blob-button]");
        await expect(button).toHaveText("Preview");
        const [viewer] = await Promise.all([context.waitForEvent("page"), button.click()]);

        const frame = viewer.frameLocator("iframe");
        await expect(frame.locator("h1")).toHaveText("Hello");
        // the stylesheet was fetched by the extension and inlined
        await expect(frame.locator("h1")).toHaveCSS("color", "rgb(1, 2, 3)");
        // the image was embedded as a data: URL (no request from the frame to raw.githubusercontent.com)
        await expect(frame.locator("#logo")).toHaveAttribute("src", /^data:image\/png;base64,/);
        await expect(frame.locator("#doc")).toHaveAttribute("href", "https://github.com/o/r/blob/main/dir/README.md");
        // the inline script did not run
        await expect(frame.locator("h1")).not.toHaveText("script ran");
        expect(gh.requests).toContain("/o/r/raw/main/dir/img/logo.png");
    });

    test("scripts only run after the explicit opt-in, inside the sandbox page", async ({ context }) => {
        await fakeGithub(context, { files });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/dir/page.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);

        await expect(viewer.locator("#script-warning")).toBeHidden();
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("Hello");

        await viewer.locator("#run-scripts").check();
        await expect(viewer.locator("#script-warning")).toBeVisible();
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("script ran");

        // the script runs in an opaque origin and cannot reach the extension
        const frame = viewer.frames().find(f => f.url().endsWith("/sandbox/frame.html"))!;
        const reach = await frame.evaluate(() => {
            const attempt = (fn: () => unknown) => { try { fn(); return "allowed"; } catch { return "blocked"; } };
            const chromeApi = (globalThis as { chrome?: { runtime?: unknown } }).chrome;
            return {
                parentDocument: attempt(() => parent.document.title),
                storage: attempt(() => localStorage.length),
                extensionApi: typeof chromeApi?.runtime
            };
        });
        expect(reach).toEqual({ parentDocument: "blocked", storage: "blocked", extensionApi: "undefined" });

        await viewer.locator("#run-scripts").uncheck();
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("Hello");
    });

    test("script mode runs inline scripts but does not load remote scripts", async ({ context }) => {
        await fakeGithub(context, { files: { "main/cdn.html": '<body><p id="p">static</p><script src="https://cdn.example.test/lib.js"></script></body>' } });
        let cdnRequests = 0;
        await context.route("https://cdn.example.test/**", route => {
            cdnRequests++;
            return route.fulfill({ status: 200, contentType: "text/javascript", body: 'document.getElementById("p").textContent = "cdn ran";' });
        });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/cdn.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
        await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("static");
        expect(cdnRequests).toBe(0);

        // the sandbox page keeps Chrome's default CSP: inline scripts run, remote script sources are blocked
        await viewer.locator("#run-scripts").check();
        await expect(viewer.locator("#script-warning")).toBeVisible();
        await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("static");
        expect(cdnRequests).toBe(0);
    });

    test("resolves branch names that contain slashes", async ({ context }) => {
        await fakeGithub(context, { files: { "feature/x/page.html": "<body><p id='p'>slash branch</p></body>" }, refNames: ["feature/x"] });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/feature/x/page.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
        await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("slash branch");
        await expect(viewer.locator("#title")).toContainText("o/r@feature/x");
    });

    test("shows an error for files that do not exist", async ({ context, extensionId }) => {
        await fakeGithub(context, { files: {} });
        const viewer = await context.newPage();
        await viewer.goto(`chrome-extension://${extensionId}/viewer/viewer.html#kind=blob&owner=o&repo=r&rest=main%2Fnope.html`);
        await expect(viewer.locator("#status.error")).toContainText("File not found");
    });

    test("web pages cannot message the extension's worker", async ({ context }) => {
        await fakeGithub(context, { files });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/dir/page.html");
        // the page's own JavaScript world (not the content script's) has no route to the worker: no externally_connectable
        const reply = await page.evaluate(() => new Promise(resolve => {
            const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: (m: unknown, cb: (r: unknown) => void) => void } } }).chrome?.runtime;
            if (!runtime?.sendMessage) return resolve("no-runtime");
            runtime.sendMessage({ type: "file-text", owner: "o", repo: "r", ref: "main", path: "dir/page.html" }, resolve);
        }));
        expect(reply).toBe("no-runtime");
    });
});
