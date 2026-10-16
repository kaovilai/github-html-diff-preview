# Publishing checklist

Nothing has been submitted. Every step that needs an account, a payment, identity verification or a click on "Submit" is the repository owner's to do.

Items marked *(unverified)* are from general knowledge and were not confirmed against the store's own documentation while preparing this; check the dashboard when you get there.

## Before any store

- [ ] Verify private-repository access in a real browser: load `dist/chrome`, open the options page, paste a private file URL into **Test access**, and confirm the `session` line says `OK`. Open that file and click Preview. (The automated tests prove the logic against a fake GitHub; they cannot prove the browser attaches the github.com session cookie to the service worker's request. If `session` fails, set an access token and use token mode, and reword the listing's private-repository claim. Also open a private PR's *Files changed*, click Preview on an `.html` file and confirm the diff renders without a token.)
- [ ] Decide the store display name (see `LISTING.md`) and make sure the manifest `name`/`description` match it.
- [ ] Pick the version in `package.json`, update `CHANGELOG.md`, run `npm run check && npm run test:e2e && npm run zip && npm run store-assets`.
- [ ] Review `PRIVACY.md` is reachable at its public URL (it is, on the `main` branch of the public repository).

## Chrome Web Store

Console: https://chrome.google.com/webstore/devconsole

| Item | Detail |
| --- | --- |
| Registration | One-time fee, paid at first visit to the developer dashboard (historically US$5 *(unverified; the official page does not state the amount)*). Google account; use a dedicated email, it cannot be changed later. |
| 2-Step Verification | Required on the Google account that publishes *(unverified)*. |
| Contact email | Must be verified from the Account page. |
| Trader status | EU consumer-law declaration. A free, open-source extension from an individual is normally declared **non-trader**; the other listings found during research did the same. |
| New-publisher limit | New publishers can have at most two published extensions until they request an increase. |
| Upload | `dist/github-html-preview-chrome-<version>.zip` (Add new item, Choose file). |
| Listing / Privacy | Paste from `store/LISTING.md`; upload `store/generated/*.png` (screenshots 1280x800, small promo 440x280). |
| Review time | Usually a few days, up to a few weeks; new developers, new extensions and host permissions get a closer look. After approval you have 30 days to publish if you choose deferred publishing. |
| Cost | Registration fee only. |

Review risks to expect, and the fallback for each:

1. **Sandbox CSP** (`script-src ... 'unsafe-eval' https:` for `sandbox/frame.html`). If a reviewer objects, remove the `content_security_policy.sandbox` entry from `src/manifest.json` (scripts mode then runs inline scripts only, no CDN scripts) or drop the scripts mode entirely; the rest of the extension does not depend on it.
2. **Name containing "GitHub"**. Fallback name in `LISTING.md`.
3. **Host permissions** are limited to three GitHub origins, each justified in `LISTING.md`.

## Microsoft Edge Add-ons

Console: Partner Center, https://partner.microsoft.com/dashboard/microsoftedge/overview

- Microsoft account and a Partner Center "Microsoft Edge program" enrollment; no registration fee *(unverified)*.
- Upload the **same Chrome zip** (Edge accepts Chrome MV3 packages). Listing, privacy, permissions justification and remote-code declaration have the same fields as Chrome; reuse `LISTING.md`.
- Certification typically takes up to about a week *(unverified)*. The "Notes for certification" box: paste the reviewer notes from `LISTING.md`.

## Firefox (addons.mozilla.org)

Console: https://addons.mozilla.org/developers/

- Free Mozilla account; no fee. Choose "On this site" for a listed add-on (or "On your own" for a signed self-hosted `.xpi`).
- Upload `dist/github-html-preview-firefox-<version>.zip`.
- **Source code upload is required** because the extension is bundled with esbuild: attach `npm run source-zip` output and these build instructions: *Node.js 22+, `npm ci`, `npm run build:firefox`; the output is `dist/firefox`.*
- The Firefox manifest already carries an add-on ID (`github-html-preview@kaovilai.github.io`) and the required data-collection declaration (`none`); `web-ext lint` reports zero warnings.
- Not yet covered by automated browser tests; do a manual pass (`about:debugging`, Load Temporary Add-on) on a public file and a public PR before submitting. The scripts toggle is absent in Firefox by design.
- Review is partly automated and usually quick for listed add-ons, but can take longer when manual review is triggered.

## What only the owner can do

- Create the developer accounts, complete 2-step verification, and pay any fee.
- Declare trader/non-trader status and choose the publisher name.
- Click **Submit for review** / **Publish** on each store. Until you say go, none of this is done.
