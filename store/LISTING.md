# Store listing material

Everything below is ready to paste. Nothing here has been submitted anywhere.

## Name

**Rendered HTML Diff for GitHub**  (store display name; repository: `github-html-preview`)

Why this name: three Chrome Web Store listings already use "GitHub HTML Preview"-style names (dohyeon5626's "Github Html Preview", bauerautomate's "GitHub HTML Preview", thejjw's "GitHub Local HTML Preview"). This name leads with what is unique here, the rendered diff, and "for GitHub" is a descriptive reference (nominative use), not a claim of affiliation. The listing says so explicitly (see disclaimer below). Alternative if the store objects to "GitHub" in the title: **Rendered HTML Diff & Preview** (mention GitHub only in the summary and description).

## Summary (max 132 characters)

> Preview HTML files on GitHub and see rendered before/after diffs in pull requests. 100% local: no server, no tracking.

(118 characters.)

## Category

Developer Tools. Language: English.

## Description

> Rendered HTML Diff for GitHub shows you what an HTML file actually looks like, right from GitHub, and what a pull request changed in the rendered page, not just in the source.
>
> **Preview any HTML file**
> • A Preview button next to "Raw" on .html and .htm files, plus a right-click menu entry and a keyboard shortcut (Alt+Shift+P).
> • Stylesheets, images and fonts that live in the repository are loaded for you, including from private repositories you can already open.
>
> **See what a pull request changed**
> • A Preview button on every HTML file in "Files changed".
> • Inline view: the new page with additions outlined in green, changed elements outlined in amber, and a red bubble wherever something was removed. Click a bubble to see what used to be there.
> • Side-by-side view with synchronized scrolling, previous/next change buttons and full screen.
> • Formatting-only changes are ignored; text is compared the way it renders.
>
> **Local and private by design**
> • No hosted preview site, no proxy, no account, no analytics. Files go from GitHub straight to your browser and nowhere else.
> • Private repositories work through the GitHub login already in your browser; nothing needs to be stored. An optional fine-grained token, kept only on your device, is a fallback if GitHub's page ever stops exposing what the diff needs.
> • Previewed pages are untrusted, so they render in a sandboxed frame with scripts off. An explicit "Run scripts (untrusted)" switch for single files is available if you want it.
>
> Open source (MIT): https://github.com/kaovilai/github-html-preview
>
> Not affiliated with, endorsed by, or sponsored by GitHub, Inc. "GitHub" is a trademark of GitHub, Inc., used here only to describe what the extension works with.

## Single purpose statement (Privacy tab)

> Preview HTML files hosted on GitHub, and show a rendered before/after comparison of HTML files changed in a pull request.

## Permission justifications (Privacy tab)

| Permission | Justification to paste |
| --- | --- |
| `storage` | Saves the user's preferences (inline vs side-by-side view, access mode) and an optional GitHub token the user chooses to enter. Stored locally with chrome.storage.local; never synced or transmitted except the token to api.github.com. |
| `contextMenus` | Adds a "Preview HTML file" right-click entry on GitHub pages and links to .html files. |
| Host `https://github.com/*` | Content script adds Preview buttons to GitHub file and pull request pages. The background worker fetches the file the user asked to preview from github.com/<owner>/<repo>/raw/..., using the user's existing GitHub session so private repositories they can access also work. |
| Host `https://api.github.com/*` | Fallback only: reads pull request metadata (changed files, merge base and head commit) and file contents through the REST API when the GitHub page does not expose them, or when the user has configured a token. |
| Host `https://raw.githubusercontent.com/*` | github.com raw-file requests redirect here (with a short-lived token for private repositories). Access is required for the redirected download to complete. |
| Sandbox page + CSP (`sandbox` key) | Used only for the optional, off-by-default "Run scripts (untrusted)" mode of single-file previews. Repository scripts run in an opaque-origin sandbox page with no access to extension APIs, GitHub pages or cookies. The extension never loads or runs any code of its own from a remote location. |

**Remote code:** Select "No, I am not using remote code." The extension's own code is all in the package. (The opt-in preview sandbox can run scripts from the *previewed repository's* page, including scripts that page loads from third-party CDNs, exactly as a browser would when opening that file. That is user content, not extension code; the reviewer notes below explain it.)

## Data usage disclosures (Privacy tab)

Check only: **Authentication information** (the optional personal access token the user enters; stored locally, sent only to api.github.com). Everything else unchecked. (The page-derived commit hashes, repository names and file paths are processed locally and sent only to GitHub as part of the requests for the files the user asked to preview.)
Certify: not sold or transferred to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness/lending.

Privacy policy URL: `https://github.com/kaovilai/github-html-preview/blob/main/PRIVACY.md`

## Notes for reviewers / test instructions

> No sign-in or credentials are needed.
> 1. Open https://github.com/redhat-et/pricetag-metering/blob/main/internal/dashboard/welcome.html . A "Preview" button appears next to "Raw". Click it: a new tab shows the rendered page.
> 2. Open https://github.com/redhat-et/pricetag-metering/pull/91/changes . Click "Preview" on the .html file; a panel shows the rendered diff (inline and side by side).
> 3. Options page (toolbar icon): the optional token and an access-test tool.
>
> The optional "Run scripts (untrusted)" checkbox (single-file preview only) loads the file in a manifest sandbox page (`sandbox/frame.html`). Its CSP allows inline scripts, eval and https script sources because it runs the previewed repository file's own scripts, which commonly pull libraries from CDNs. It has an opaque origin and no extension APIs. It is off by default and never used for diffs.
> If the public PR above has changed or been closed, any public pull request that touches an .html file works.

## Images (generated by `npm run store-assets`, in `store/generated/`)

| File | Size | Use |
| --- | --- | --- |
| `static/icons/128.png` | 128x128 (96px artwork + 16px transparent padding) | Extension icon (inside the zip) |
| `store/generated/screenshot-1-inline-diff.png` | 1280x800 | Screenshot 1 |
| `store/generated/screenshot-2-side-by-side.png` | 1280x800 | Screenshot 2 |
| `store/generated/screenshot-3-file-preview.png` | 1280x800 | Screenshot 3 |
| `store/generated/screenshot-4-options.png` | 1280x800 | Screenshot 4 |
| `store/generated/promo-small.png` | 440x280 | Small promo tile (required) |

The screenshots show a made-up "Acme Cloud" page, not third-party content, rendered by the real extension UI. The marquee image (1400x560) is optional and not generated.

## Packages

`npm run zip` writes reproducible `dist/github-html-preview-chrome-<version>.zip` and `dist/github-html-preview-firefox-<version>.zip`. `npm run source-zip` writes the source archive that AMO asks for.
