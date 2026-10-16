// Renders static/icons/*.png from an inline SVG with Playwright's Chromium. The artwork is original to this project.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="26" fill="#1f2a44"/>
  <rect x="18" y="26" width="92" height="76" rx="10" fill="#f6f8fa"/>
  <rect x="18" y="26" width="92" height="16" rx="10" fill="#d0d7de"/>
  <rect x="18" y="34" width="92" height="8" fill="#d0d7de"/>
  <circle cx="28" cy="34" r="3" fill="#8c959f"/><circle cx="38" cy="34" r="3" fill="#8c959f"/>
  <rect x="28" y="52" width="40" height="12" rx="3" fill="#ffd8d3"/>
  <rect x="32" y="56" width="32" height="4" rx="2" fill="#cf222e"/>
  <rect x="28" y="70" width="64" height="12" rx="3" fill="#b7efc5"/>
  <rect x="32" y="74" width="46" height="4" rx="2" fill="#1a7f37"/>
  <rect x="28" y="88" width="30" height="6" rx="3" fill="#d0d7de"/>
</svg>`;

if (import.meta.url === `file://${process.argv[1]}`) {
    const browser = await chromium.launch();
    await mkdir(path.join(root, "static/icons"), { recursive: true });
    await writeFile(path.join(root, "store/icon.svg"), ICON_SVG);
    for (const size of [16, 32, 48, 128]) {
        const page = await browser.newPage({ viewport: { width: size, height: size } });
        await page.setContent(`<body style="margin:0;background:transparent">${ICON_SVG.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body>`);
        await page.screenshot({ path: path.join(root, `static/icons/${size}.png`), omitBackground: true });
        await page.close();
    }
    await browser.close();
    console.log("icons written");
}
