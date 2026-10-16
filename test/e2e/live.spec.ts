// Runs against the real github.com. Opt in with LIVE=1; unauthenticated, so it only needs public repositories
// (and is subject to GitHub's anonymous rate limits for the PR diff, which uses api.github.com).
import { expect, test } from "./fixtures";

test.skip(!process.env.LIVE, "set LIVE=1 to run against github.com");

test("live: Preview button on a public blob page", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("https://github.com/redhat-et/pricetag-metering/blob/main/internal/dashboard/welcome.html");
    const button = page.locator("[data-hp-blob-button]");
    await expect(button).toBeVisible({ timeout: 30_000 });
    const [viewer] = await Promise.all([context.waitForEvent("page"), button.click()]);
    await expect(viewer.locator("#status.error")).toHaveCount(0);
    await expect(viewer.locator("iframe")).toHaveCount(1, { timeout: 30_000 });
});

test("live: PR diff preview without the REST API (commits come from the page)", async ({ context }) => {
    const apiRequests: string[] = [];
    await context.route("https://api.github.com/**", route => {
        apiRequests.push(new URL(route.request().url()).pathname);
        return route.abort();
    });
    const page = await context.newPage();
    await page.goto("https://github.com/redhat-et/pricetag-metering/pull/91/changes");
    const preview = page.getByRole("button", { name: "Preview" }).first();
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await preview.click();
    const panel = page.frameLocator('iframe[title^="HTML diff preview"]').first();
    await expect(panel.locator("#stats")).toContainText(/added|removed|changed|No visible/, { timeout: 60_000 });
    // github.com's own page beacons to api.github.com/_private; the extension must not touch the REST API
    expect(apiRequests.filter(path => path.startsWith("/repos/"))).toEqual([]);
});
