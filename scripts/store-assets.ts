// Generates store listing images from the real extension UI (viewer, dialogs, options page) with Playwright:
//   store/generated/screenshot-*.png   1280x800 (the store takes at most five)
//   store/generated/promo-small.png    440x280
// Run `npm run build` first. The previewed pages are a made-up sample served by a faked github.com.
// Screenshot 3 shows the Preview button the extension adds to a real GitHub file page. That crop comes from
// store/assets/github-file-header.png; `LIVE_GITHUB=1` recaptures it from this repository's own public page (needs network).
import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGithub } from "../test/e2e/fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist/chrome");
const out = path.join(root, "store/generated");
const assets = path.join(root, "store/assets");

const css = `body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1b1f2a;background:#f4f6fb}
header{background:#1f2a44;color:#fff;padding:28px 40px}header h1{margin:0;font-size:28px}header p{margin:6px 0 0;color:#b8c2dc}
main{padding:32px 40px}.grid{display:flex;gap:20px}.card{flex:1;background:#fff;border-radius:12px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.card h2{margin:0 0 8px;font-size:20px}.price{font-size:32px;font-weight:700;margin:8px 0}.card ul{padding-left:18px;color:#46506a}
.btn{display:inline-block;margin-top:12px;padding:8px 16px;border-radius:8px;background:#2f6fed;color:#fff;text-decoration:none}.btn.alt{background:#1a7f37}
footer{padding:20px 40px;color:#6a7490}`;

const BEFORE = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<header><h1>Acme Cloud</h1><p>Simple pricing for every team</p></header>
<main><div class="grid">
<div class="card"><h2>Starter</h2><div class="price">$9</div><ul><li>1 project</li><li>Community support</li></ul><a class="btn">Choose Starter</a></div>
<div class="card"><h2>Team</h2><div class="price">$29</div><ul><li>10 projects</li><li>Email support</li><li>Audit log</li></ul><a class="btn">Choose Team</a></div>
<div class="card" id="legacy"><h2>Legacy</h2><div class="price">$49</div><ul><li>Unlimited projects</li><li>Phone support</li></ul><a class="btn">Choose Legacy</a></div>
</div></main><footer>Prices in USD. Billed monthly.</footer></body></html>`;

const AFTER = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<header><h1>Acme Cloud</h1><p>Simple, transparent pricing for every team</p></header>
<main><div class="grid">
<div class="card"><h2>Starter</h2><div class="price">$9</div><ul><li>1 project</li><li>Community support</li></ul><a class="btn">Choose Starter</a></div>
<div class="card"><h2>Team</h2><div class="price">$29</div><ul><li>10 projects</li><li>Email support</li><li>Audit log</li><li>SSO</li></ul><a class="btn alt">Choose Team</a></div>
<div class="card"><h2>Enterprise</h2><div class="price">Custom</div><ul><li>Unlimited projects</li><li>24/7 support</li></ul><a class="btn">Contact sales</a></div>
</div></main><footer>Prices in USD. Billed monthly or yearly.</footer></body></html>`;

// the same page with the scripts a real site would have, for the "Run scripts" confirmation
const LIVE_PAGE = AFTER.replace("</body>", '<script src="js/pricing.js"></script><script src="https://cdn.example.com/analytics.js"></script><script>document.title += " (live)";</script></body>');

const MERGE_BASE = "c".repeat(40), HEAD = "b".repeat(40), BASE = "a".repeat(40);
const repo = {
    files: { [`${MERGE_BASE}/pricing.html`]: BEFORE, [`${HEAD}/pricing.html`]: AFTER, "main/pricing.html": LIVE_PAGE, "main/js/pricing.js": "document.querySelector(\".btn.alt\").textContent = \"Choose Team (yearly)\";" },
    pulls: { 12: { base: BASE, head: HEAD, mergeBase: MERGE_BASE, pageDiffs: { before: MERGE_BASE, after: HEAD }, files: [{ filename: "pricing.html", status: "modified" }] } }
};

const png = async (buffer: Buffer | string): Promise<string> =>
    `data:image/png;base64,${(typeof buffer === "string" ? await readFile(buffer) : buffer).toString("base64")}`;

const frame = `body{margin:0;width:1280px;height:800px;box-sizing:border-box;padding:28px 40px;background:linear-gradient(160deg,#eef2fb,#dfe7f7);font:16px/1.4 system-ui,sans-serif;color:#1b1f2a;display:flex;flex-direction:column}
h1{margin:0 0 4px;font-size:30px}p.sub{margin:0 0 18px;color:#46506a;font-size:17px}
.col{display:flex;flex-direction:column;align-items:center;gap:14px}.row{display:flex;gap:28px;align-items:flex-start;flex:1;min-height:0}figure{margin:0}figcaption{margin-top:8px;font-size:15px;color:#46506a}
img{display:block;border-radius:8px;box-shadow:0 4px 18px rgba(31,42,68,.28);background:#fff}`;

const dir = await mkdtemp(path.join(os.tmpdir(), "ghp-store-"));
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]
});
try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    await fakeGithub(context, repo, "acme", "site");
    // the fake serves one owner/repo pair; route the sample under that name
    const viewer = (hash: string) => `chrome-extension://${id}/viewer/viewer.html#${hash}`;
    const diffHash = `kind=pr&owner=acme&repo=site&pr=12&path=pricing.html&before=${MERGE_BASE}&after=${HEAD}`;

    const page = await context.newPage();
    await page.goto(viewer(diffHash));
    await page.locator("#stats").filter({ hasText: "added" }).waitFor();
    await page.frameLocator("iframe").first().locator("hp-del summary").first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "screenshot-1-inline-diff.png") });

    await page.locator("#mode-split").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "screenshot-2-side-by-side.png") });

    // report dialog over a pull request preview, with the technical details the page offered
    const diag = encodeURIComponent("commit discovery: found\npage layout: signed-in (grid)\naddress: whole pull request\nembedded data: ok");
    await page.goto(viewer(`${diffHash}&diag=${diag}`));
    await page.reload();
    await page.locator("#stats").filter({ hasText: "added" }).waitFor();
    await page.locator("#report").click();
    await page.locator("#report-dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    // inset by a pixel so the dimmed backdrop does not show at the rounded corners
    const box = (await page.locator("#report-dialog").boundingBox())!;
    const reportDialog = await page.screenshot({ clip: { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 } });

    // single-file preview, then the confirmation that comes before any script runs
    await page.goto(viewer("kind=blob&owner=acme&repo=site&rest=main%2Fpricing.html"));
    // only the hash differs from the diff page, so force a real load
    await page.reload();
    await page.locator("iframe").waitFor();
    await page.waitForTimeout(500);
    const filePreview = await page.screenshot();
    await page.locator("#run-scripts").check();
    await page.locator("#scripts-dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, "screenshot-4-run-scripts.png") });
    await page.locator("#scripts-cancel").click();

    // options page: access test and the repositories always allowed to run scripts
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(`chrome-extension://${id}/options/options.html`);
    await page.evaluate(() => localStorage.setItem("trustedScriptRepos", JSON.stringify(["acme/docs", "acme/site"])));
    await page.reload();
    await page.locator("#probe-url").fill("https://github.com/acme/site/blob/main/pricing.html");
    await page.locator("#probe").click();
    await page.locator("#probe-result").filter({ hasText: "OK" }).waitFor();
    await page.waitForTimeout(300);
    const options = await page.locator("main").screenshot();
    await page.setViewportSize({ width: 1280, height: 800 });

    // the Preview button on a real GitHub file page: the crop starts below GitHub's top bar
    const headerFile = path.join(assets, "github-file-header.png");
    if (process.env.LIVE_GITHUB === "1") {
        await mkdir(assets, { recursive: true });
        const live = await context.newPage();
        await live.goto("https://github.com/kaovilai/github-html-diff-preview/blob/main/static/options/options.html", { waitUntil: "domcontentloaded" });
        await live.locator("[data-hp-blob-button]").first().waitFor({ timeout: 20000 });
        await live.screenshot({ path: headerFile, clip: { x: 321, y: 180, width: 943, height: 175 } });
        await live.close();
    }

    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 1280, height: 800 });
    await sheet.setContent(`<style>${frame}</style><body>
        <h1>A Preview button next to Raw</h1><p class="sub">On any .html file on GitHub, one click shows the page rendered, in a new tab.</p>
        <div class="col"><figure><img src="${await png(headerFile)}" width="943"><figcaption>The extension adds <b>Preview</b> to the file header. Right-click or Alt+Shift+P work too.</figcaption></figure>
        <figure><img src="${await png(filePreview)}" width="640"><figcaption>One click later: the page, rendered.</figcaption></figure></div></body>`);
    await sheet.screenshot({ path: path.join(out, "screenshot-3-preview-button.png") });

    await sheet.setContent(`<style>${frame}</style><body>
        <h1>You stay in control</h1><p class="sub">Problems are reported through a form you review and submit yourself. Scripts stay off unless you allow them.</p>
        <div class="row">
        <figure><img src="${await png(reportDialog)}" style="max-height:640px"><figcaption>Report a problem: edit the address and technical details, optionally include the HTML.</figcaption></figure>
        <figure><img src="${await png(options)}" style="max-height:640px"><figcaption>Options: test access to a file, and manage repositories allowed to run scripts.</figcaption></figure>
        </div></body>`);
    await sheet.screenshot({ path: path.join(out, "screenshot-5-report-and-options.png") });
    await sheet.close();

    const tile = await context.newPage();
    await tile.setViewportSize({ width: 440, height: 280 });
    await tile.setContent(`<body style="margin:0;width:440px;height:280px;background:linear-gradient(135deg,#1f2a44,#2f6fed);font:600 26px/1.2 system-ui,sans-serif;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 28px;box-sizing:border-box">
        <div>Rendered HTML diff<br>for GitHub</div>
        <div style="margin-top:14px;display:flex;gap:8px"><span style="background:#b7efc5;color:#1a7f37;padding:4px 10px;border-radius:6px;font-size:16px">+ added</span><span style="background:#ffd8d3;color:#cf222e;padding:4px 10px;border-radius:6px;font-size:16px">− removed</span></div>
        <div style="margin-top:14px;font-size:15px;font-weight:400;color:#c9d4f0">100% local. No server.</div></body>`);
    await tile.screenshot({ path: path.join(out, "promo-small.png") });
    console.log("wrote", out);
} finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
}
