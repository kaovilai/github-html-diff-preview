# GitHub HTML Diff Preview

A browser extension that previews HTML files on GitHub and shows **rendered before/after diffs of HTML files in pull requests**, entirely locally.

- No hosted preview site, no proxy or API server, no domain, no analytics.
- The extension fetches files straight from GitHub, sanitizes them in your browser and renders them in a locked-down frame.
- Works for private repositories by reusing the GitHub session already in your browser (no token to store), with an optional personal access token for the parts GitHub only exposes through its API.

![Preview button in the pull request file list](docs/screenshots/1-preview-button.png)

## Features

**Preview a single HTML file**

- A **Preview** button next to GitHub's **Raw** button on `.html` / `.htm` pages, a right-click menu entry (on the page or on a link to a file), and the keyboard shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (change it at `chrome://extensions/shortcuts`).
- Relative stylesheets (including `@import`), images, fonts and CSS `url()` assets are fetched by the extension and embedded, so they render from private repositories too. Requests are bounded (at most 40 assets, 2 MiB each, 12 MiB per page, 6 at a time) and the extension stops when GitHub signals a rate limit.
- Links to other repository files open the matching GitHub page.

**Preview what a pull request changed**

- A **Preview** button on every `.html` file in **Files changed**, for the whole PR, a commit range, or a single commit.
- **Inline** view: the new page, additions outlined in green, changed elements dashed amber, and a red `−` bubble wherever something was removed (click it to see the removed content rendered, or its source).
- **Side by side** view with synchronized scrolling, **previous/next change** navigation, full screen, and the chosen mode remembered.

![Inline diff with additions and a removal bubble](docs/screenshots/2-inline-green-additions-red-bubble.png)
![Side by side](docs/screenshots/3-side-by-side.png)

**Scripts are off by default.** Repository HTML is untrusted, and running its JavaScript would also disturb the diff highlighting. Single-file previews have an explicit, labelled **Run scripts (untrusted)** toggle (Chrome only); scripts then run in a manifest sandbox page with an opaque origin: no access to GitHub, your cookies, or the extension's APIs. The sandbox keeps Chrome's default policy, so inline scripts run but scripts loaded from other sites (CDNs) are blocked. Diffs never run scripts.

## Install

Not yet published to any store. To try it:

```sh
git clone https://github.com/kaovilai/github-html-diff-preview.git
cd github-html-diff-preview
npm ci
npm run build
```

Then open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked*, and select `dist/chrome`. (Firefox: see [Firefox](#firefox).)

## Private repositories

Nothing needs a token in the normal case, because everything is either already on the page or available to your GitHub login:

| What | Where it comes from | Needs a token? |
| --- | --- | --- |
| The file, its stylesheets, images and fonts | `https://github.com/<owner>/<repo>/raw/<ref>/<path>` using your browser's github.com login (GitHub redirects to `raw.githubusercontent.com` with a short-lived token for private repositories) | No |
| Which two commits a pull request diff compares (merge base and head, or the chosen range/commit) | The page itself: GitHub's diff view requests `/<owner>/<repo>/diffs/<before>..<after>` when it loads, and the extension reads that address from the page's resource timing. It only trusts it when the page agrees (a file link at that commit, or the commit/range in the address). | No |
| Whether the file was added, deleted or renamed | `https://github.com/<owner>/<repo>/compare/<before>..<after>.diff`, again with your login (read only as far as the file's header) | No |
| Fallback: the same information from the REST API | Only used when the page does not expose the commits (for example, GitHub changed its page, or the diff request had not finished and the wait timed out) | Yes, for private repositories |

For that fallback, add a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with read-only *Contents* and *Pull requests* access to the repository on the options page. It is stored in `chrome.storage.local` on your machine and only ever sent to `api.github.com`. The options page also has a **Test access** tool that tries each file-fetching method for a file URL and shows which ones work.

Organization SSO, IP allow-lists and enterprise policies still apply. GitHub Enterprise Server hosts are not supported.

## Privacy

No data leaves your browser except requests to GitHub (`github.com`, `api.github.com`, `raw.githubusercontent.com`) for the files you ask to preview. No analytics, telemetry, accounts, or third-party services. Full statement: [PRIVACY.md](PRIVACY.md).

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remember your view mode, access mode and optional token, locally. |
| `contextMenus` | The "Preview HTML file" right-click entry. |
| `https://github.com/*` | Add the Preview buttons to GitHub pages; fetch files with your existing GitHub login. |
| `https://api.github.com/*` | Fallback only: pull request metadata and file contents through the REST API when the page does not expose them or a token is configured. |
| `https://raw.githubusercontent.com/*` | Where GitHub redirects `…/raw/…` downloads (required for private repositories). |

There is no `tabs`, `scripting`, `identity`, `cookies`, `webRequest` or `<all_urls>` permission. The preview page is web-accessible to `https://github.com/*` only, so the in-page diff panel can embed it.

## How it works

1. A content script adds the buttons (GitHub is a single-page app, so it watches for page changes).
2. The viewer page (an extension page) asks the background worker for file contents (and, for a pull request, the compared commits are passed along from the page). Only the extension's own pages can: the worker rejects requests from anything else, and validates owner, repo, ref and path before building any URL.
3. The HTML is parsed with `DOMParser` (never inserted into a live page), stripped of anything that can execute (`<script>`, `on*` handlers, `javascript:` URLs, `<object>`, `<embed>`, `srcdoc` frames, `<base>`, meta refresh), and its relative stylesheets and assets are inlined.
4. The document is rendered in a `sandbox` iframe without `allow-scripts`.
5. For diffs, both sides are compared as DOM trees (so formatting-only changes are ignored and text is compared as it renders), *then* URLs are rewritten, so an unchanged `<img src="logo.png">` is never reported as changed just because it resolves to a different commit.

## Limitations

- Reading the compared commits from GitHub's page depends on GitHub's page behaviour. If it changes, the extension falls back to the REST API (a token is needed for private repositories) and the single-file preview is unaffected.
- A renamed file's old name is only known from the `.diff`; if that lookup fails it is shown as a new file.
- Only `<body>` is diffed (changes confined to `<head>`, such as `<title>` or `<meta>`, are not reported). Stylesheet changes show up as the resulting visual differences, not as CSS edits.
- Changes to an image or font *file* are not detected when its path stays the same.
- Pages that depend on JavaScript to render are shown as their static HTML unless you opt into scripts (single file, Chrome).
- Large diffs fall back to coarser matching, large files (> 5 MiB) are refused, and GitHub's rate limits apply (60 API requests per hour anonymously).
- The buttons rely on GitHub's page markup, which GitHub changes without notice. If a button disappears after a GitHub redesign, please open an issue. The right-click menu and keyboard shortcut do not depend on page markup.
- Root-relative URLs (`/img/a.png`) resolve against the repository root; sites that expect a web server layout may not render fully.

## Firefox

`npm run build` also writes `dist/firefox` (Manifest V3, Firefox 128+). Differences: no scripts toggle (Firefox has no manifest sandbox pages), and a background event page instead of a service worker. The Firefox build is produced and linted in CI but, unlike Chrome, is not yet covered by automated browser tests; treat it as experimental. Load it from `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/firefox/manifest.json`.

## Development

```sh
npm ci
npm run build         # dist/chrome and dist/firefox
npm run check         # typecheck + lint + unit tests
npm run test:e2e      # builds, then drives Chromium with the extension loaded
LIVE=1 npx playwright test live   # optional: smoke test against the real github.com
npm run zip           # reproducible store zips in dist/
```

The end-to-end tests run Chromium with the unpacked extension against a fake `github.com`, `raw` and `api.github.com` served by Playwright (including the extension's own network requests), so they need no network and no GitHub account.

Source layout: `src/background` (worker), `src/content` (GitHub page integration), `src/viewer` (preview page), `src/options`, `src/sandbox` (opt-in scripts page), `src/core` (diffing, sanitizing, fetching; unit tested).

Store listing text is in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md), images and publishing steps in [`store/`](store/). Problems? See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md); to report one, see [docs/REPORTING.md](docs/REPORTING.md), or email github-html-diff-preview@tig.pw (issue forms ask for a URL and acceptance criteria that the issue helper turns into tests).

### Automation

- **Dependabot** opens one grouped pull request for all npm and GitHub Actions updates each week; `dependabot-automerge.yml` squash-merges it once CI has passed on that exact commit.
- **CI** runs type checks, lint, unit tests, end-to-end tests and an accessibility suite: WCAG 2.2 AA checks with axe on every page the extension ships, text contrast of every button in every state (rest, hover, focus, selected) in light and dark mode, and touch usability (44px targets, no sideways scrolling, tap-only operation) in a phone-sized touch viewport.
- **Issue helper** (`.github/workflows/issue-responder.md`, a [GitHub Agentic Workflow](https://github.github.com/gh-aw/)) answers new issues and follow-up comments from people without write access, using the repository's docs and code, and opens a draft pull request when a report is a confirmed small bug. It needs a `COPILOT_GITHUB_TOKEN` repository secret. After editing its frontmatter run `gh aw compile`; a scheduled check fails when the compiled lock file is stale.

## License

[MIT](LICENSE). This project was inspired by [dohyeon5626/github-html-preview-extension](https://github.com/dohyeon5626/github-html-preview-extension) (MIT), which opens previews on a hosted site. This repository contains none of its code, icons or branding and calls none of its servers.
