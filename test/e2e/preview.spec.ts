import type { BrowserContext } from "@playwright/test";
import { enableScripts, expect, fakeGithub, PNG, test } from "./fixtures";

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

    test("the preview fills the window (not a default-sized box), with and without scripts", async ({ context }) => {
        await fakeGithub(context, { files });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/dir/page.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("Hello");

        const fill = async () => viewer.evaluate(() => {
            const frame = document.querySelector("#stage > iframe")!.getBoundingClientRect();
            const stage = document.getElementById("stage")!.getBoundingClientRect();
            return { widthRatio: frame.width / stage.width, heightRatio: frame.height / stage.height };
        });
        const plain = await fill();
        expect(plain.widthRatio).toBeGreaterThan(0.98);
        expect(plain.heightRatio).toBeGreaterThan(0.98);

        await enableScripts(viewer);
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("script ran");
        const scripted = await fill();
        expect(scripted.widthRatio).toBeGreaterThan(0.98);
        expect(scripted.heightRatio).toBeGreaterThan(0.98);
    });

    test("scripts only run after the explicit opt-in, inside the sandbox page", async ({ context }) => {
        await fakeGithub(context, { files });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/dir/page.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);

        await expect(viewer.locator("#script-warning")).toBeHidden();
        await expect(viewer.frameLocator("iframe").locator("h1")).toHaveText("Hello");

        await enableScripts(viewer);
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
        await enableScripts(viewer);
        await expect(viewer.locator("#script-warning")).toBeVisible();
        await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("static");
        expect(cdnRequests).toBe(0);
    });

    test.describe("confirming scripts", () => {
        const scripted = {
            "main/s.html": '<body><p id="p">static</p><script src="js/a.js"></script><script src="https://cdn.example.test/lib.js"></script><script>window.__inline = 1</script></body>',
            "main/js/a.js": 'document.getElementById("p").textContent = "local ran";'
        };
        const open = async (context: BrowserContext) => {
            const page = await context.newPage();
            await page.goto("https://github.com/o/r/blob/main/s.html");
            const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
            await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("static");
            return viewer;
        };

        test("ticking the box asks first and lists the scripts that would run; cancel runs nothing", async ({ context }) => {
            const gh = await fakeGithub(context, { files: scripted });
            const viewer = await open(context);
            await viewer.locator("#run-scripts").check();
            const dialog = viewer.locator("#scripts-dialog");
            await expect(dialog).toBeVisible();
            await expect(dialog).toContainText("o/r");
            await expect(viewer.locator("#scripts-list")).toContainText("https://github.com/o/r/raw/main/js/a.js");
            await expect(viewer.locator("#scripts-list")).toContainText("1 inline script will run");
            await expect(viewer.locator("#scripts-list")).toContainText("https://cdn.example.test/lib.js");
            // nothing is fetched or run until the user agrees
            expect(gh.requests).not.toContain("/o/r/raw/main/js/a.js");

            await viewer.locator("#scripts-cancel").click();
            await expect(dialog).toBeHidden();
            await expect(viewer.locator("#run-scripts")).not.toBeChecked();
            await expect(viewer.locator("#script-warning")).toBeHidden();
            await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("static");
            expect(gh.requests).not.toContain("/o/r/raw/main/js/a.js");

            // Escape also declines
            await viewer.locator("#run-scripts").check();
            await expect(dialog).toBeVisible();
            await viewer.keyboard.press("Escape");
            await expect(viewer.locator("#run-scripts")).not.toBeChecked();
        });

        test("\"Run this time\" runs the scripts but asks again next time", async ({ context }) => {
            await fakeGithub(context, { files: scripted });
            const viewer = await open(context);
            await enableScripts(viewer);
            await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("local ran");
            await expect(viewer.locator("#script-warning-always")).toBeHidden();

            await viewer.locator("#run-scripts").uncheck();
            await viewer.locator("#run-scripts").check();
            await expect(viewer.locator("#scripts-dialog")).toBeVisible();
        });

        test("\"Always allow\" skips the question for that repository only, and the options page undoes it", async ({ context, extensionId }) => {
            await fakeGithub(context, { files: { ...scripted, "main/t.html": "<body><p id='p'>other</p></body>" } });
            const viewer = await open(context);
            await viewer.locator("#run-scripts").check();
            await viewer.locator("#scripts-always").click();
            await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("local ran");
            await expect(viewer.locator("#script-warning-always")).toBeVisible();

            // a new preview of the same repository does not ask
            const again = await open(context);
            await again.locator("#run-scripts").check();
            await expect(again.frameLocator("iframe").locator("#p")).toHaveText("local ran");
            await expect(again.locator("#scripts-dialog")).toBeHidden();

            // the options page lists it; removing it brings the question back
            const options = await context.newPage();
            await options.goto(`chrome-extension://${extensionId}/options/options.html`);
            await expect(options.locator("#trusted-list li")).toHaveCount(1);
            await expect(options.locator("#trusted-list li")).toContainText("o/r");
            await expect(options.locator("#trusted-empty")).toBeHidden();
            await options.getByRole("button", { name: "Remove o/r from the list" }).click();
            await expect(options.locator("#trusted-list li")).toHaveCount(0);
            await expect(options.locator("#trusted-empty")).toBeVisible();

            const third = await open(context);
            await third.locator("#run-scripts").check();
            await expect(third.locator("#scripts-dialog")).toBeVisible();
        });

        test("allowing one repository does not allow another", async ({ context }) => {
            await fakeGithub(context, { files: scripted }, "o", "r");
            await fakeGithub(context, { files: scripted }, "o", "other");
            const viewer = await open(context);
            await viewer.locator("#run-scripts").check();
            await viewer.locator("#scripts-always").click();
            await expect(viewer.frameLocator("iframe").locator("#p")).toHaveText("local ran");

            const page = await context.newPage();
            await page.goto("https://github.com/o/other/blob/main/s.html");
            const [other] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
            await expect(other.frameLocator("iframe").locator("#p")).toHaveText("static");
            await other.locator("#run-scripts").check();
            await expect(other.locator("#scripts-dialog")).toBeVisible();
        });
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
