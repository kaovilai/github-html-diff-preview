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
