import { expect, fakeGithub, test } from "./fixtures";

const BEFORE = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body>
<h1>Title</h1><p class="n">kept</p><p id="old">removed paragraph</p><ul><li>one</li><li>two</li></ul></body></html>`;
const AFTER = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body>
<h1>Title</h1><p class="n">kept</p><p id="new">added paragraph</p><ul><li>one</li><li>two</li><li>three</li></ul></body></html>`;

const BASE = "a".repeat(40), HEAD = "b".repeat(40), MERGE_BASE = "c".repeat(40);

const repo = {
    files: { [`${MERGE_BASE}/docs/a.html`]: BEFORE, [`${HEAD}/docs/a.html`]: AFTER },
    pulls: { 5: { base: BASE, head: HEAD, mergeBase: MERGE_BASE, pageDiffs: { before: MERGE_BASE, after: HEAD }, files: [{ filename: "docs/a.html", status: "modified" }, { filename: "notes.md", status: "modified" }] } }
};

test("PR diff preview highlights additions, removals and changes", async ({ context }) => {
    const gh = await fakeGithub(context, { ...repo, pulls: { 5: { ...repo.pulls[5], files: [{ filename: "docs/a.html", status: "modified" }] } } });
    const page = await context.newPage();
    await page.goto("https://github.com/o/r/pull/5/files");

    await page.getByRole("button", { name: "Preview" }).click();
    const panel = page.frameLocator('iframe[title^="HTML diff preview"]');

    await expect(panel.locator("#stats")).toContainText("added");
    await expect(panel.locator("#stats")).toContainText("removed");

    // inline view: after document plus a red bubble where the paragraph used to be
    const inline = panel.frameLocator("iframe").first();
    await expect(inline.locator("#new")).toHaveAttribute("data-hp-added", "");
    await expect(inline.locator("hp-del")).toHaveCount(1);
    await inline.locator("hp-del summary").first().click();
    await expect(inline.locator("hp-del .render")).toContainText("removed paragraph");

    // side by side: removed on the left (before), added on the right (after)
    await panel.locator("#mode-split").click();
    await expect(panel.locator(".pane").nth(1).locator("iframe").contentFrame().locator("#old")).toHaveAttribute("data-hp-removed", "");
    await expect(panel.locator(".pane").nth(2).locator("iframe").contentFrame().locator("#new")).toHaveAttribute("data-hp-added", "");

    // the file list came from the PR API, the contents from the merge base and the head commit
    expect(gh.requests).toContain(`/o/r/raw/${MERGE_BASE}/docs/a.html`);
    expect(gh.requests).toContain(`/o/r/raw/${HEAD}/docs/a.html`);
    expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);
});

test("only HTML files get a Preview button", async ({ context }) => {
    await fakeGithub(context, repo);
    const page = await context.newPage();
    await page.goto("https://github.com/o/r/pull/5/files");
    await expect(page.getByRole("button", { name: "Preview" })).toHaveCount(1);
});

test("the diff is rendered with scripts disabled", async ({ context }) => {
    await fakeGithub(context, {
        files: { [`${MERGE_BASE}/docs/a.html`]: "<body><p>x</p></body>", [`${HEAD}/docs/a.html`]: '<body><p id="p" onclick="this.remove()">x</p><script>document.title="ran"</script><b>y</b></body>' },
        pulls: { 5: { ...repo.pulls[5], files: [{ filename: "docs/a.html", status: "modified" }] } }
    });
    const page = await context.newPage();
    await page.goto("https://github.com/o/r/pull/5/files");
    await page.getByRole("button", { name: "Preview" }).click();
    const inline = page.frameLocator('iframe[title^="HTML diff preview"]').frameLocator("iframe").first();
    await expect(inline.locator("b")).toHaveAttribute("data-hp-added", "");
    await expect(inline.locator("script")).toHaveCount(0);
    await expect(inline.locator("#p")).not.toHaveAttribute("onclick", /.*/);
});

test.describe("commits taken from GitHub's own page", () => {
    const pull = (extra: object = {}) => ({
        base: BASE, head: HEAD, mergeBase: MERGE_BASE,
        files: [{ filename: "docs/new.html", status: "renamed", previous_filename: "docs/old.html" }],
        pageDiffs: { before: MERGE_BASE, after: HEAD },
        ...extra
    });
    const files = { [`${MERGE_BASE}/docs/old.html`]: BEFORE, [`${HEAD}/docs/new.html`]: AFTER };

    test("needs no REST API call: commits come from the page, file status from the session diff", async ({ context }) => {
        const gh = await fakeGithub(context, { files, pulls: { 5: pull() } });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/pull/5/files");
        await page.getByRole("button", { name: "Preview" }).click();
        const panel = page.frameLocator('iframe[title^="HTML diff preview"]');

        await expect(panel.locator("#stats")).toContainText("added");
        // the rename was found in the .diff, so the old path was used for the "before" side
        await expect(panel.locator("#notice")).toContainText("Renamed from docs/old.html");
        expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);
        expect(gh.requests).toContain(`/o/r/raw/${MERGE_BASE}/docs/old.html`);
    });

    test("a deleted file is recognised from the diff", async ({ context }) => {
        const gh = await fakeGithub(context, { files: { [`${MERGE_BASE}/docs/gone.html`]: BEFORE }, pulls: { 5: pull({ files: [{ filename: "docs/gone.html", status: "removed" }] }) } });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/pull/5/files");
        await page.getByRole("button", { name: "Preview" }).click();
        await expect(page.frameLocator('iframe[title^="HTML diff preview"]').locator("#notice")).toContainText("File deleted");
        expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);
    });

    test("an explicit commit range in the address must agree with the page, otherwise the user can report it", async ({ context }) => {
        const gh = await fakeGithub(context, { files: { [`${MERGE_BASE}/docs/a.html`]: BEFORE, [`${HEAD}/docs/a.html`]: AFTER }, pulls: { 5: { ...pull({ files: [{ filename: "docs/a.html", status: "modified" }] }), pageDiffs: { before: "1".repeat(40), after: "2".repeat(40) } } } });
        const page = await context.newPage();
        // the URL asks for a..b but the page reports unrelated commits: not trusted
        await page.goto(`https://github.com/o/r/pull/5/changes/${MERGE_BASE}..${HEAD}`);
        await page.getByRole("button", { name: "Preview" }).click();
        const panel = page.frameLocator('iframe[title^="HTML diff preview"]');
        await expect(panel.locator("#status.error")).toContainText("did not say which commits");
        expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);

        // the report carries what this page offered, so the failure can be understood without seeing the page
        await panel.locator("#report-from-error").click();
        const details = await panel.locator("#report-diagnostics").inputValue();
        expect(details).toContain("commit discovery: not found");
        expect(details).toContain("address: commit range");
        expect(details).toMatch(/diff requests seen: 1 \(of \d+ resources\)/);
        expect(details).toContain("embedded data: absent");
        expect(details).toContain("commits given by the page: no");
        // names and counts only
        expect(details).not.toMatch(/docs\/a\.html|[0-9a-f]{40}|https?:/);
    });
});

test.describe("reporting a problem", () => {
    test("the dialog is prefilled, editable, and opens a GitHub issue form the user submits themselves", async ({ context, extensionId }) => {
        await fakeGithub(context, { files: {} });
        const viewer = await context.newPage();
        await viewer.goto(`chrome-extension://${extensionId}/viewer/viewer.html#kind=blob&owner=o&repo=r&rest=main%2Fnope.html`);
        await expect(viewer.locator("#status.error")).toContainText("File not found");

        await viewer.locator("#report-from-error").click();
        const dialog = viewer.locator("#report-dialog");
        await expect(dialog).toBeVisible();
        // a failed load is classified as an access problem, and the address is the GitHub page that failed
        await expect(viewer.locator("#report-kind")).toHaveValue("access");
        await expect(viewer.locator("#report-urls")).toHaveValue("https://github.com/o/r/blob/main/nope.html");
        // capture what the extension would open instead of leaving the test machine: the form is only opened, never submitted
        await viewer.evaluate(() => {
            const w = window as unknown as { __opened: string[] };
            w.__opened = [];
            chrome.tabs.create = (async (options: chrome.tabs.CreateProperties) => { w.__opened.push(String(options.url)); return {} as chrome.tabs.Tab; }) as typeof chrome.tabs.create;
        });
        expect(await viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);

        // the user edits what is shared; the confirmed text is what goes into the form
        await viewer.locator("#report-urls").fill("https://github.com/o/PRIVATE/blob/main/nope.html");
        await viewer.locator("#report-open").click();
        await expect.poll(() => viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);
        const url = new URL(await viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]));
        expect(url.origin + url.pathname).toBe("https://github.com/kaovilai/github-html-diff-preview/issues/new");
        expect(url.searchParams.get("template")).toBe("access_problem.yml");
        expect(url.searchParams.get("urls")).toBe("https://github.com/o/PRIVATE/blob/main/nope.html");
        expect(url.searchParams.get("actual")).toContain("File not found");
        expect(url.searchParams.get("probe")).toContain("FAIL session");
        expect(url.searchParams.get("version")).toMatch(/^\d+\.\d+\.\d+$/);
        expect(url.searchParams.get("browser")).toMatch(/Chrome/);
        // no token or other secret is ever included
        expect(url.search).not.toMatch(/token|secret|authorization/i);
    });

    test("\"Include the page's HTML\" is off by default and adds the file's HTML to the form only when ticked", async ({ context }) => {
        await fakeGithub(context, { files: { "main/a.html": "<body><p>secret-ish & <b>ok</b></p></body>", "main/big.html": `<body>${"<p>line</p>\n".repeat(2000)}</body>` } });
        const open = async (name: string) => {
            const page = await context.newPage();
            await page.goto(`https://github.com/o/r/blob/main/${name}`);
            const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
            await expect(viewer.locator("#stage > iframe")).toBeVisible();
            await viewer.evaluate(() => {
                const w = window as unknown as { __opened: string[]; __clip: string[] };
                w.__opened = []; w.__clip = [];
                chrome.tabs.create = (async (options: chrome.tabs.CreateProperties) => { w.__opened.push(String(options.url)); return {} as chrome.tabs.Tab; }) as typeof chrome.tabs.create;
                // the clipboard needs a focused, visible page; record what would be copied instead
                Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { w.__clip.push(text); } }, configurable: true });
            });
            return viewer;
        };
        const opened = (viewer: Awaited<ReturnType<typeof open>>) => viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
        const copied = (viewer: Awaited<ReturnType<typeof open>>) => viewer.evaluate(() => (window as unknown as { __clip: string[] }).__clip);

        const small = await open("a.html");
        await small.locator("#report").click();
        const include = small.locator("#report-include-html");
        await expect(include).toBeEnabled();
        await expect(include).not.toBeChecked();
        await small.locator("#report-open").click();
        await expect.poll(async () => (await opened(small)).length).toBe(1);
        expect(new URL((await opened(small))[0]).searchParams.has("after_html")).toBe(false);

        // ticked: the file travels in the address, nothing needs the clipboard
        await small.locator("#report").click();
        await include.check();
        await small.locator("#report-open").click();
        await expect.poll(async () => (await opened(small)).length).toBe(2);
        expect(new URL((await opened(small))[1]).searchParams.get("after_html")).toBe("<body><p>secret-ish & <b>ok</b></p></body>");
        expect(await copied(small)).toEqual([]);

        // the choice does not carry over to the next time the dialog opens
        await small.locator("#report").click();
        await expect(include).not.toBeChecked();
        await small.locator("#report-cancel").click();

        // too long for the address: the start goes into the form (marked as clipped), all of it onto the clipboard
        const big = await open("big.html");
        await big.locator("#report").click();
        await big.locator("#report-include-html").check();
        await big.locator("#report-open").click();
        await expect.poll(async () => (await opened(big)).length).toBe(1);
        const url = new URL((await opened(big))[0]);
        expect(url.href.length).toBeLessThan(8000);
        expect(url.searchParams.get("after_html")).toContain("clipped: the full HTML is on your clipboard");
        expect((await copied(big))[0]).toContain("<p>line</p>\n".repeat(2000));
    });

    test("there is nothing to include before any HTML has loaded", async ({ context, extensionId }) => {
        await fakeGithub(context, { files: {} });
        const viewer = await context.newPage();
        await viewer.goto(`chrome-extension://${extensionId}/viewer/viewer.html#kind=blob&owner=o&repo=r&rest=main%2Fnope.html`);
        await expect(viewer.locator("#status.error")).toContainText("File not found");
        await viewer.locator("#report-from-error").click();
        await expect(viewer.locator("#report-include-html")).toBeDisabled();
    });

    test("the dialog carries what the page offered and how loading went, editable, into the form", async ({ context, extensionId }) => {
        await fakeGithub(context, { files: { "main/a.html": "<body><p>ok</p></body>" } });
        const viewer = await context.newPage();
        const diag = encodeURIComponent("commit discovery: not found\nembedded data: absent");
        await viewer.goto(`chrome-extension://${extensionId}/viewer/viewer.html#kind=blob&owner=o&repo=r&rest=main%2Fa.html&diag=${diag}`);
        await expect(viewer.frameLocator("iframe").locator("p")).toHaveText("ok");
        await viewer.evaluate(() => {
            const w = window as unknown as { __opened: string[] };
            w.__opened = [];
            chrome.tabs.create = (async (options: chrome.tabs.CreateProperties) => { w.__opened.push(String(options.url)); return {} as chrome.tabs.Tab; }) as typeof chrome.tabs.create;
        });
        await viewer.locator("#report").click();
        const box = viewer.locator("#report-diagnostics");
        // from the page, then what the preview learned itself
        await expect(box).toHaveValue(/commit discovery: not found\nembedded data: absent\npreview: blob\nbranch name given by the page: no\nfile size: \d+ characters/);
        // no file content or file name leaks into it
        expect(await box.inputValue()).not.toContain("a.html");

        await box.fill("embedded data: absent\n(removed the rest)");
        await viewer.locator("#report-open").click();
        await expect.poll(() => viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);
        const url = new URL(await viewer.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]));
        expect(url.searchParams.get("diagnostics")).toBe("embedded data: absent\n(removed the rest)");
    });

    test("cancel sends nothing, and the always-visible button works without an error", async ({ context }) => {
        const gh = await fakeGithub(context, { files: { "main/a.html": "<body><p>ok</p></body>" } });
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/blob/main/a.html");
        const [viewer] = await Promise.all([context.waitForEvent("page"), page.locator("[data-hp-blob-button]").click()]);
        await expect(viewer.frameLocator("iframe").locator("p")).toHaveText("ok");
        await viewer.locator("#report").click();
        await expect(viewer.locator("#report-kind")).toHaveValue("render");
        await viewer.locator("#report-cancel").click();
        await expect(viewer.locator("#report-dialog")).toBeHidden();
        expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);
    });
});
