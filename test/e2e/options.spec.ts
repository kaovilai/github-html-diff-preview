import { expect, fakeGithub, test } from "./fixtures";

test("the options page has nothing to configure and its access test reports whether the browser's sign-in reaches a file", async ({ context, extensionId }) => {
    const gh = await fakeGithub(context, { files: { "main/a.html": "<p>x</p>" } });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);

    // no token field, no mode picker
    await expect(page.locator("input[type=password], #token, #authMode")).toHaveCount(0);

    await page.locator("#probe-url").fill("https://github.com/o/r/blob/main/a.html");
    await page.locator("#probe").click();
    await expect(page.locator("#probe-result")).toContainText("OK   session");

    await page.locator("#probe-url").fill("https://github.com/o/r/blob/main/missing.html");
    await page.locator("#probe").click();
    await expect(page.locator("#probe-result")).toContainText("FAIL session");
    expect(gh.requests.filter(request => request.startsWith("api:"))).toEqual([]);
});

test("the viewer explains itself when opened without a file", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/viewer/viewer.html`);
    await expect(page.locator("#status.error")).toContainText("Open a .html file on github.com");
});
