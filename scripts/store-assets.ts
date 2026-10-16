// Generates store listing images from the real extension UI (viewer + options pages) with Playwright:
//   store/generated/screenshot-*.png   1280x800
//   store/generated/promo-small.png    440x280
// Run `npm run build` first. The previewed pages are a made-up sample served by a faked github.com.
import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGithub } from "../test/e2e/fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist/chrome");
const out = path.join(root, "store/generated");

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

const MERGE_BASE = "c".repeat(40), HEAD = "b".repeat(40), BASE = "a".repeat(40);
const repo = {
    files: { [`${MERGE_BASE}/pricing.html`]: BEFORE, [`${HEAD}/pricing.html`]: AFTER, "main/pricing.html": AFTER },
    pulls: { 12: { base: BASE, head: HEAD, mergeBase: MERGE_BASE, pageDiffs: { before: MERGE_BASE, after: HEAD }, files: [{ filename: "pricing.html", status: "modified" }] } }
};

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

    await page.goto(viewer("kind=blob&owner=acme&repo=site&rest=main%2Fpricing.html"));
    // only the hash differs from the diff page, so force a real load
    await page.reload();
    await page.locator("iframe").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "screenshot-3-file-preview.png") });

    await page.goto(`chrome-extension://${id}/options/options.html`);
    await page.locator("#probe-url").fill("https://github.com/acme/site/blob/main/pricing.html");
    await page.locator("#probe").click();
    await page.locator("#probe-result").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "screenshot-4-options.png") });

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
