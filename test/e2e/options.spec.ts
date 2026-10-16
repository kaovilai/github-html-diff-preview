import { expect, fakeGithub, test } from "./fixtures";

test("options store the token locally and the access test reports each method", async ({ context, extensionId }) => {
    await fakeGithub(context, { files: { "main/a.html": "<p>x</p>" } });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);

    await page.locator("#token").fill("github_pat_example");
    await page.locator("#save").click();
    await expect(page.locator("#saved")).toHaveText("Saved");
    await page.reload();
    await expect(page.locator("#token")).toHaveValue("github_pat_example");

    await page.locator("#probe-url").fill("https://github.com/o/r/blob/main/a.html");
    await page.locator("#probe").click();
    const result = page.locator("#probe-result");
    await expect(result).toContainText("OK   session");
    await expect(result).toContainText("token");
    await expect(result).toContainText("anonymous");

    await page.locator("#clear").click();
    await page.reload();
    await expect(page.locator("#token")).toHaveValue("");
});

test("the viewer explains itself when opened without a file", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/viewer/viewer.html`);
    await expect(page.locator("#status.error")).toContainText("Open a .html file on github.com");
});
