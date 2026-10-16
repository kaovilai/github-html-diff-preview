import { expect, fakeGithub, test } from "./fixtures";

const BEFORE = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body>
<h1>Title</h1><p class="n">kept</p><p id="old">removed paragraph</p><ul><li>one</li><li>two</li></ul></body></html>`;
const AFTER = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body>
<h1>Title</h1><p class="n">kept</p><p id="new">added paragraph</p><ul><li>one</li><li>two</li><li>three</li></ul></body></html>`;

const BASE = "a".repeat(40), HEAD = "b".repeat(40), MERGE_BASE = "c".repeat(40);

const repo = {
    files: { [`${MERGE_BASE}/docs/a.html`]: BEFORE, [`${HEAD}/docs/a.html`]: AFTER },
    pulls: { 5: { base: BASE, head: HEAD, mergeBase: MERGE_BASE, files: [{ filename: "docs/a.html", status: "modified" }, { filename: "notes.md", status: "modified" }] } }
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

    test("an explicit commit range in the address must agree with the page, otherwise the API is used", async ({ context }) => {
        const gh = await fakeGithub(context, { files: { [`${MERGE_BASE}/docs/a.html`]: BEFORE, [`${HEAD}/docs/a.html`]: AFTER }, pulls: { 5: { ...pull({ files: [{ filename: "docs/a.html", status: "modified" }] }), pageDiffs: { before: "1".repeat(40), after: "2".repeat(40) } } } });
        const page = await context.newPage();
        // the URL asks for a..b but the page reports unrelated commits: not trusted
        await page.goto(`https://github.com/o/r/pull/5/changes/${MERGE_BASE}..${HEAD}`);
        await page.getByRole("button", { name: "Preview" }).click();
        await expect(page.frameLocator('iframe[title^="HTML diff preview"]').locator("#stats")).toContainText("added");
        expect(gh.requests.some(request => request.startsWith("api:"))).toBe(true);
    });
});
