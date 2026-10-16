# Chrome Web Store Listing: GitHub HTML Diff Preview

> Last Updated: 2026-10-16
> Single source of truth for the store listing. Edge Add-ons reuses the same text and package; see `store/PUBLISHING.md` for the steps and costs per store. Not included in the extension ZIP (`npm run zip` packages only `dist/`).

## Store Listing

**Extension Name** [REQUIRED]
GitHub HTML Diff Preview

Must match `manifest.json` `name` (it does). Things to weigh:
- Three Chrome Web Store listings already use "GitHub HTML Preview"-style names (dohyeon5626's "Github Html Preview", bauerautomate's "GitHub HTML Preview", thejjw's "GitHub Local HTML Preview"). "Diff" is the distinguishing word; lead with the rendered diff in screenshots and copy. Icon and branding are unrelated to those listings.
- The name begins with "GitHub". The description carries a non-affiliation line. If review objects, fall back to **HTML Diff Preview for GitHub** or **Rendered HTML Diff & Preview**.

**Short Description** [REQUIRED] (118 of 132 characters)
Preview HTML files on GitHub and see rendered before/after diffs in pull requests. 100% local: no server, no tracking.

**Detailed Description** [REQUIRED]
```
GitHub HTML Diff Preview shows you what an HTML file actually looks like, right from GitHub, and what a pull request changed in the rendered page, not just in the source.

PREVIEW ANY HTML FILE
A Preview button appears next to "Raw" on .html and .htm files. You can also use the right-click menu entry or the keyboard shortcut (Alt+Shift+P). Stylesheets, images and fonts that live in the repository are loaded for you, including from private repositories you can already open.

SEE WHAT A PULL REQUEST CHANGED
A Preview button appears on every HTML file in "Files changed".
Inline view: the new page with additions outlined in green, changed elements outlined in amber, and a red bubble wherever something was removed. Click a bubble to see what used to be there.
Side-by-side view with synchronized scrolling, previous/next change buttons and full screen.
Formatting-only changes are ignored, and text is compared the way it renders.

HOW TO USE IT
1. Open an HTML file or a pull request's "Files changed" tab on github.com.
2. Click Preview.
3. In a pull request, switch between Inline and Side by side, and step through the changes with the arrow buttons.

LOCAL AND PRIVATE BY DESIGN
No hosted preview site, no proxy, no account, no analytics. Files go from GitHub straight to your browser and nowhere else. Private repositories work through the GitHub sign-in already in your browser. An optional fine-grained access token, kept only on your device, is a fallback if GitHub's page ever stops exposing what the diff needs.
Previewed pages are untrusted, so they are shown in a sandboxed frame with scripts turned off. An explicit "Run scripts (untrusted)" switch for single files is available if you want it.

SUPPORT
Questions and bug reports: https://github.com/kaovilai/github-html-diff-preview/issues (the forms ask for a URL and what you expected). Open source (MIT): https://github.com/kaovilai/github-html-diff-preview

Not affiliated with, endorsed by, or sponsored by GitHub, Inc. "GitHub" is a trademark of GitHub, Inc., used here only to describe what the extension works with.
```

**Category** [REQUIRED]
Developer Tools

**Single Purpose** [REQUIRED]
Preview HTML files hosted on GitHub, and show a rendered before/after comparison of HTML files changed in a pull request.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG (96px art + 16px transparent padding) | ✅ Ready | `static/icons/128.png` (inside the ZIP) |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store/generated/screenshot-1-inline-diff.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store/generated/screenshot-2-side-by-side.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `store/generated/screenshot-3-file-preview.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store/generated/screenshot-4-options.png` |
| Screenshot 5 | 1280×800 | ⬜ Not created | |
| Small Promo Tile [REQUIRED by the store] | 440×280 | ✅ Ready | `store/generated/promo-small.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

Regenerate with `npm run build && npm run store-assets` (renders the real UI against a fake GitHub; the page shown is a made-up "Acme Cloud" page, not third-party content).

### Screenshot Notes
1. Inline diff: green additions, amber change, red removal bubble opened.
2. Side by side: removed on the left in red, added on the right in green.
3. A single file previewed, with stylesheet and images applied.
4. Options page with the access test.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's preferences (inline vs side-by-side view, access mode) and an optional GitHub token the user chooses to enter. Stored locally with chrome.storage.local; never synced. The token is sent only to api.github.com. |
| `contextMenus` | permissions | Adds a "Preview HTML file" right-click entry on GitHub pages and on links to .html files. |
| `https://github.com/*` | host_permissions | A content script adds the Preview buttons to GitHub file and pull request pages. The extension also fetches the file the user asked to preview from github.com/<owner>/<repo>/raw/..., using the user's existing GitHub sign-in so private repositories they can access also work, and reads the pull request's own file status from github.com's .diff view. |
| `https://api.github.com/*` | host_permissions | Fallback only: reads pull request metadata (changed files, merge base and head commit) and file contents through the REST API when the GitHub page does not expose them, or when the user has configured a token. |
| `https://raw.githubusercontent.com/*` | host_permissions | github.com raw-file requests redirect here (with a short-lived token for private repositories). Access is needed for the redirected download to complete. |
| Sandbox page (`sandbox` manifest key) | n/a | Used only for the optional, off-by-default "Run scripts (untrusted)" mode of single-file previews. The previewed file's own scripts run in an opaque-origin sandbox page under Chrome's default sandbox policy, with no access to extension APIs, GitHub pages or cookies. Remote script sources are blocked. The extension never loads or runs any code of its own from a remote location. |

No `tabs`, `scripting`, `identity`, `cookies`, `webRequest` or `<all_urls>` permission is requested.

**Remote code:** answer "No, I am not using remote code."

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Only the optional authentication token, locally.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | n/a | No |
| Health info | No | No | n/a | No |
| Financial info | No | No | n/a | No |
| Authentication info | Yes, only if the user enters a personal access token | Only to api.github.com, in the Authorization header of API requests | Read pull request data and files the user asked to preview | No |
| Personal communications | No | No | n/a | No |
| Location | No | No | n/a | No |
| Web history | No | No | n/a | No |
| User activity | No | No | n/a | No |
| Website content | No (file contents are processed locally and shown to the user) | Requests go only to GitHub for the files the user asked to preview | Core feature | No |

Check only **Authentication information** in the dashboard form.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/kaovilai/github-html-diff-preview/blob/main/PRIVACY.md

(Live: returns 200. Visit it once more right before submitting.)

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]
Currently `passawit.kaovilai` (set on the dashboard Settings page; the owner may change it; shown under "Offered by").

**Contact Email** [REQUIRED]
github-html-diff-preview@tig.pw (`<repo-name>@tig.pw` convention; displayed publicly; must be verified from the link the store emails to it on the dashboard Account page, so the Mailgun route for this address must exist first).

**Support URL / Email** [RECOMMENDED]
https://github.com/kaovilai/github-html-diff-preview/issues (email: github-html-diff-preview@tig.pw)

**Homepage URL** [RECOMMENDED]
https://github.com/kaovilai/github-html-diff-preview

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-10-16 | Initial release: Preview button, context menu and shortcut for HTML files; rendered before/after diff in pull requests; private repositories through the browser's GitHub sign-in; opt-in script mode (Chrome). | Draft saved in the dashboard (item ID `ppkcpjippikphpgkmkdnjielaalmcmol`), not submitted |

## Review Notes

### Notes for reviewers (paste into the "Test instructions" tab; the field holds at most 500 characters)
```
No sign-in needed. 1) Open https://github.com/redhat-et/pricetag-metering/blob/main/internal/dashboard/welcome.html and click Preview next to Raw: a new tab shows the rendered page. 2) Open https://github.com/redhat-et/pricetag-metering/pull/91/changes and click Preview on the .html file: inline and side-by-side diff. 3) The toolbar icon opens options. The optional Run scripts checkbox (off by default) uses a sandbox page under Chrome's default policy: no extension APIs, no remote scripts.
```

### Known Issues / Limitations
- Only `<body>` is diffed; changes confined to `<head>` show "No visible changes".
- GitHub's page markup can change; the right-click entry and the shortcut do not depend on it.
- Private repository access has been verified only against a fake GitHub in automated tests and against public repositories on github.com; confirm with a real private repository before publishing (see `store/PUBLISHING.md`).

### Rejection History
None yet.
