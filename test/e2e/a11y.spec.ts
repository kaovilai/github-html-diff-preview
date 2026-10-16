// Accessibility of the extension's own UI: WCAG 2.2 AA (axe), text contrast of every button in every state,
// keyboard focus visibility, and touch usability on a phone-sized viewport.
import { expect, extensionIdOf, fakeGithub, PNG, test } from "./fixtures";
import { expectNoViolations, measureControls } from "./a11y-helpers";
import type { BrowserContext, Page } from "@playwright/test";

const MIN_TEXT_CONTRAST = 4.5;
// WCAG 2.5.8 requires 24px; touch guidance (WCAG 2.5.5, Apple, Material) asks for 44px or more, so that is what we hold coarse pointers to
const MIN_TOUCH_TARGET = 44;

const BEFORE = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body><h1>Title</h1><p id="old">removed paragraph</p><ul><li>one</li></ul></body></html>`;
const AFTER = `<!doctype html><html><head><style>.n{color:rgb(9,9,9)}</style></head><body><h1>Title</h1><p id="new">added paragraph</p><ul><li>one</li><li>two</li></ul><img src="a.png" alt=""></body></html>`;
const MB = "c".repeat(40), HEAD = "b".repeat(40), BASE = "a".repeat(40);

const repo = {
    files: { [`${MB}/a.html`]: BEFORE, [`${HEAD}/a.html`]: AFTER, "main/a.html": AFTER, "main/a.png": PNG, [`${HEAD}/a.png`]: PNG, [`${MB}/a.png`]: PNG },
    pulls: { 5: { base: BASE, head: HEAD, mergeBase: MB, files: [{ filename: "a.html", status: "modified" }], pageDiffs: { before: MB, after: HEAD } } }
};

type Scheme = "light" | "dark";
const SCHEMES: Scheme[] = ["light", "dark"];

// every page of the extension's own UI, in the state a user would see it
const openViewerDiff = async (context: BrowserContext, scheme: Scheme, mode: "inline" | "split" = "inline"): Promise<Page> => {
    const id = await extensionIdOf(context);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${id}/viewer/viewer.html#kind=pr&owner=o&repo=r&pr=5&path=a.html&before=${MB}&after=${HEAD}&theme=${scheme}`);
    await expect(page.locator("#stats")).toContainText("added");
    if (mode === "split") await page.locator("#mode-split").click();
    return page;
};

const openViewerBlob = async (context: BrowserContext, scheme: Scheme): Promise<Page> => {
    const id = await extensionIdOf(context);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${id}/viewer/viewer.html#kind=blob&owner=o&repo=r&rest=main%2Fa.html&theme=${scheme}`);
    await expect(page.frameLocator("iframe").locator("h1")).toHaveText("Title");
    return page;
};

const openOptions = async (context: BrowserContext, scheme: Scheme): Promise<Page> => {
    const id = await extensionIdOf(context);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${id}/options/options.html`);
    await page.locator("#probe-url").fill("https://github.com/o/r/blob/main/a.html");
    await page.locator("#probe").click();
    await expect(page.locator("#probe-result")).toContainText("session");
    return page;
};

test.describe("WCAG 2.2 AA", () => {
    for (const scheme of SCHEMES) {
        test(`viewer (diff, inline and side by side) has no violations, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openViewerDiff(context, scheme);
            await expectNoViolations(page);
            await page.locator("#mode-split").click();
            await expectNoViolations(page);
        });

        test(`viewer (single file) has no violations, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openViewerBlob(context, scheme);
            await expectNoViolations(page);
            await page.locator("#run-scripts").check();
            await expect(page.locator("#scripts-dialog")).toBeVisible();
            await expectNoViolations(page);
            for (const report of await measureControls(page, "#scripts-dialog button")) {
                expect(report.ratio, report.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
            }
            await page.locator("#scripts-always").click();
            await expect(page.locator("#script-warning")).toBeVisible();
            await expect(page.locator("#script-warning-always")).toBeVisible();
            await expectNoViolations(page);
        });

        test(`viewer error state has no violations, ${scheme}`, async ({ context }) => {
            const id = await extensionIdOf(context);
            const page = await context.newPage();
            await page.emulateMedia({ colorScheme: scheme });
            await page.goto(`chrome-extension://${id}/viewer/viewer.html`);
            await expect(page.locator("#status.error")).toBeVisible();
            await expectNoViolations(page);
        });

        test(`report dialog (open) has no violations and its buttons have enough contrast, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openViewerDiff(context, scheme);
            await page.locator("#report").click();
            await expect(page.locator("#report-dialog")).toBeVisible();
            await expectNoViolations(page);
            for (const report of await measureControls(page, "#report-dialog button")) {
                expect(report.ratio, report.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
            }
        });

        test(`options page has no violations, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openOptions(context, scheme);
            await expectNoViolations(page);
            // with repositories on the "always allow scripts" list as well
            await page.evaluate(() => localStorage.setItem("trustedScriptRepos", JSON.stringify(["o/r", "acme/site"])));
            await page.reload();
            await expect(page.locator("#trusted-list li")).toHaveCount(2);
            await expectNoViolations(page);
            for (const report of await measureControls(page, "#trusted-list button, #trusted-clear")) {
                expect(report.ratio, report.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
            }
        });
    }

    test("the Preview buttons and panel the extension adds to GitHub pages have no violations", async ({ context }) => {
        await fakeGithub(context, repo);
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/pull/5/files");
        await page.getByRole("button", { name: "Preview" }).click();
        await expect(page.locator("[data-hp-preview-panel]")).toBeVisible();
        await expectNoViolations(page, "[data-hp-preview-button], [data-hp-preview-panel]");
    });
});

test.describe("every button: text contrast in every state", () => {
    for (const scheme of SCHEMES) {
        test(`viewer buttons, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openViewerDiff(context, scheme);
            // only buttons the user can see (the report dialog's are inside a closed <dialog>)
            const buttons = page.locator("button:visible");
            const count = await buttons.count();
            expect(count).toBeGreaterThanOrEqual(4);

            // rest, then selected (the active segment), then hovered and keyboard-focused one by one
            const seen: [string, number][] = [];
            const record = (reports: { selector: string; ratio: number }[], state: string) => {
                for (const report of reports) seen.push([`${report.selector} [${state}]`, report.ratio]);
            };
            record(await measureControls(page, "button"), "rest");
            await page.locator("#mode-split").click();
            record(await measureControls(page, "button"), "after click");
            for (let i = 0; i < count; i++) {
                await buttons.nth(i).hover();
                record(await measureControls(page, "button:hover"), "hover");
                await page.keyboard.press("Tab");
                record(await measureControls(page, "button:focus-visible"), "focus");
            }
            expect(seen.length).toBeGreaterThan(count * 2);
            for (const [key, ratio] of seen) expect(ratio, key).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        });

        test(`options buttons, ${scheme}`, async ({ context }) => {
            await fakeGithub(context, repo);
            const page = await openOptions(context, scheme);
            const buttons = page.locator("button:visible");
            for (let i = 0; i < await buttons.count(); i++) {
                await buttons.nth(i).hover();
                for (const report of await measureControls(page, "button:hover")) expect(report.ratio, `${report.text} hover`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
            }
            for (const report of await measureControls(page, "button")) expect(report.ratio, report.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        });
    }

    test("the removal bubble and the buttons added to GitHub pages", async ({ context }) => {
        await fakeGithub(context, repo);
        const page = await context.newPage();
        await page.goto("https://github.com/o/r/pull/5/files");
        await page.getByRole("button", { name: "Preview" }).click();
        const panel = page.locator("[data-hp-preview-panel]");
        for (const report of await measureControls(page, "[data-hp-preview-panel] button, [data-hp-preview-button]")) {
            expect(report.ratio, report.text).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
        const bubble = page.frameLocator("iframe[title^='HTML diff preview']").frameLocator("iframe").first().locator("hp-del summary").first();
        await expect(bubble).toBeVisible();
        await expect(panel).toBeVisible();
    });

    test("the controls keep a visible keyboard focus indicator", async ({ context }) => {
        await fakeGithub(context, repo);
        const page = await openViewerDiff(context, "light");
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press("Tab");
            const indicator = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement;
                const style = getComputedStyle(el);
                return { tag: el.tagName, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== "none" };
            });
            expect(indicator.outline || indicator.shadow, `${indicator.tag} #${i}`).toBe(true);
        }
    });
});

test.describe("mobile and touch", () => {
    // Chromium's touch emulation reports a coarse pointer for web pages but not for chrome-extension:// pages, so the
    // extension's own pages enlarge their controls for `(pointer: coarse), (max-width: 720px)`; real phones match both.
    test("the browser reports a coarse pointer and no hover", async ({ mobileContext }) => {
        const page = await mobileContext.newPage();
        await page.goto("about:blank");
        expect(await page.evaluate(() => [matchMedia("(pointer: coarse)").matches, matchMedia("(hover: none)").matches])).toEqual([true, true]);
    });

    for (const scheme of SCHEMES) {
        test(`touch targets are at least ${MIN_TOUCH_TARGET}px, nothing scrolls sideways, ${scheme}`, async ({ mobileContext }) => {
            await fakeGithub(mobileContext, repo);
            const pages: [string, Page][] = [
                ["options", await openOptions(mobileContext, scheme)],
                ["diff inline", await openViewerDiff(mobileContext, scheme)],
                ["diff split", await openViewerDiff(mobileContext, scheme, "split")],
                ["file", await openViewerBlob(mobileContext, scheme)]
            ];
            for (const [name, page] of pages) {
                const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth, viewportMeta: !!document.querySelector('meta[name="viewport"]') }));
                expect(metrics.scroll, `${name}: horizontal overflow`).toBeLessThanOrEqual(metrics.width);
                expect(metrics.viewportMeta, `${name}: viewport meta tag`).toBe(true);

                const small = await page.evaluate(min => {
                    const targets = Array.from(document.querySelectorAll<HTMLElement>("button, select, input:not([type=hidden]), summary"));
                    return targets.map(el => {
                        // a checkbox is operated through its label
                        const box = (el instanceof HTMLInputElement && el.type === "checkbox" ? el.closest("label") ?? el : el).getBoundingClientRect();
                        return { id: el.id || el.tagName.toLowerCase(), w: Math.round(box.width), h: Math.round(box.height), visible: box.width > 0 && box.height > 0 };
                    }).filter(t => t.visible && (t.w < min || t.h < min));
                }, MIN_TOUCH_TARGET);
                expect(small, `${name}: controls smaller than ${MIN_TOUCH_TARGET}px`).toEqual([]);
            }
        });
    }

    test("side by side stacks the panes on a narrow screen so each uses the full width", async ({ mobileContext }) => {
        await fakeGithub(mobileContext, repo);
        const page = await openViewerDiff(mobileContext, "light", "split");
        const widths = await page.locator(".pane:visible").evaluateAll(panes => panes.map(pane => Math.round(pane.getBoundingClientRect().width)));
        expect(widths).toHaveLength(2);
        for (const width of widths) expect(width).toBeGreaterThanOrEqual(360);
    });

    test("everything can be operated by touch alone", async ({ mobileContext }) => {
        await fakeGithub(mobileContext, repo);
        const page = await openViewerDiff(mobileContext, "light");

        await page.locator("#mode-split").tap();
        await expect(page.locator("#mode-split")).toHaveClass(/active/);
        await page.locator("#mode-inline").tap();
        await expect(page.locator("#mode-inline")).toHaveClass(/active/);

        // a tap on the removal bubble opens what was removed; no hover is needed
        const frame = page.frameLocator("iframe").first();
        await frame.locator("hp-del summary").first().tap();
        await expect(frame.locator("hp-del .render")).toContainText("removed paragraph");

        const nav = page.locator("#next");
        await nav.tap();
        await expect(nav).toBeVisible();
    });

    test("the report dialog is usable by touch: 44px controls, fits the screen, tap opens the form", async ({ mobileContext }) => {
        await fakeGithub(mobileContext, repo);
        const page = await openViewerDiff(mobileContext, "light");
        await page.locator("#report").tap();
        const dialog = page.locator("#report-dialog");
        await expect(dialog).toBeVisible();
        const sizes = await page.evaluate(min => {
            const box = (el: Element) => el.getBoundingClientRect();
            const dialogBox = box(document.getElementById("report-dialog")!);
            const controls = Array.from(document.querySelectorAll<HTMLElement>("#report-dialog button, #report-dialog select, #report-dialog textarea"))
                .map(el => ({ id: el.id, w: Math.round(box(el).width), h: Math.round(box(el).height) }))
                .filter(c => (c.id !== "report-urls") && (c.w < min || c.h < min));
            return { fits: dialogBox.left >= 0 && dialogBox.right <= window.innerWidth, small: controls };
        }, MIN_TOUCH_TARGET);
        expect(sizes.fits).toBe(true);
        expect(sizes.small).toEqual([]);
    });

    test("the removal bubble's touch target is large without growing on screen", async ({ mobileContext }) => {
        await fakeGithub(mobileContext, repo);
        const page = await openViewerDiff(mobileContext, "light");
        const summary = page.frameLocator("iframe").first().locator("hp-del summary").first();
        const box = (await summary.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    });

    test("the Preview panel added to a GitHub page has touch-sized controls", async ({ mobileContext }) => {
        await fakeGithub(mobileContext, repo);
        const page = await mobileContext.newPage();
        await page.goto("https://github.com/o/r/pull/5/files");
        await page.locator("[data-hp-preview-button]").tap();
        await expect(page.locator("[data-hp-preview-panel]")).toBeVisible();
        const small = await page.locator("[data-hp-preview-button], [data-hp-preview-panel] button").evaluateAll(
            (els, min) => els.map(el => ({ text: el.textContent, h: Math.round(el.getBoundingClientRect().height) })).filter(b => b.h < min), MIN_TOUCH_TARGET);
        expect(small).toEqual([]);
    });
});
