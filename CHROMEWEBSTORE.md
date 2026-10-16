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
No hosted preview site, no proxy, no account, no analytics. Files go from GitHub straight to your browser and nowhere else. Private repositories work through the GitHub sign-in already in your browser, read-only, with no token to store and no GitHub API. If something cannot be read, a "Report a problem" button opens a prefilled GitHub issue form that you review and submit yourself.
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
| `contextMenus` | permissions | Adds a "Preview HTML file" right-click entry on GitHub pages and on links to .html files. |
| `https://github.com/*` | host_permissions | A content script adds the Preview buttons to GitHub file and pull request pages. The extension also reads (read-only) the file the user asked to preview from github.com/<owner>/<repo>/raw/..., using the user's existing GitHub sign-in so private repositories they can access also work, and reads the pull request's own file status from github.com's .diff view. Nothing is uploaded. |
| `https://raw.githubusercontent.com/*` | host_permissions | github.com raw-file requests redirect here (with a short-lived token for private repositories). Access is needed for the redirected download to complete. |
| Sandbox page (`sandbox` manifest key) | n/a | Used only for the optional, off-by-default "Run scripts (untrusted)" mode of single-file previews. The previewed file's own scripts run in an opaque-origin sandbox page under Chrome's default sandbox policy, with no access to extension APIs, GitHub pages or cookies. Remote script sources are blocked. The extension never loads or runs any code of its own from a remote location. |

No `storage`, `tabs`, `scripting`, `identity`, `cookies`, `webRequest` or `<all_urls>` permission is requested, and the GitHub API (`api.github.com`) is never used.

**Remote code:** answer "No, I am not using remote code."

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No. There is no token, account, analytics or storage of GitHub content. Requests are read-only and go only to github.com and raw.githubusercontent.com, for the files the user asked to preview.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | n/a | No |
| Health info | No | No | n/a | No |
| Financial info | No | No | n/a | No |
| Authentication info | No (the browser's own GitHub sign-in is used by the browser; the extension cannot read it and stores nothing) | No | n/a | No |
| Personal communications | No | No | n/a | No |
| Location | No | No | n/a | No |
| Web history | No | No | n/a | No |
| User activity | No | No | n/a | No |
| Website content | No (file contents are processed locally and shown to the user) | Read-only requests go only to GitHub for the files the user asked to preview | Core feature | No |

Check **no** data-type boxes in the dashboard form.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/kaovilai/github-html-diff-preview/blob/main/PRIVACY.md

(Live: returns 200. Visit it once more right before submitting.)

## Distribution

**Visibility**: Public (publishes automatically once review passes)
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
| 0.2.0 | 2026-10-16 | Removes the GitHub API fallback and the token option (read-only raw fetching through the browser's sign-in only), drops the `storage` and `api.github.com` permissions, and adds "Report a problem" (prefilled GitHub issue form the user submits). | Draft, not submitted |
| 0.1.0 | 2026-10-16 | Initial release: Preview button, context menu and shortcut for HTML files; rendered before/after diff in pull requests; private repositories through the browser's GitHub sign-in; opt-in script mode (Chrome). | Submitted 2026-10-16, pending review (item ID `ppkcpjippikphpgkmkdnjielaalmcmol`); set to publish automatically after review |

## Review Notes

### Notes for reviewers (paste into the "Test instructions" tab; the field holds at most 500 characters)
```
No sign-in needed. 1) Open https://github.com/redhat-et/pricetag-metering/blob/main/internal/dashboard/welcome.html and click Preview next to Raw: a new tab shows the rendered page. 2) Open https://github.com/redhat-et/pricetag-metering/pull/91/changes and click Preview on the .html file: inline and side-by-side diff. 3) The toolbar icon opens options. The optional Run scripts checkbox (off by default) uses a sandbox page under Chrome's default policy: no extension APIs, no remote scripts.
```

### Known Issues / Limitations
- Only `<body>` is diffed; changes confined to `<head>` show "No visible changes".
- GitHub's page markup can change. The extension then says what it could not read and offers "Report a problem"; the right-click entry and the shortcut do not depend on page markup. A fix can be tried from source (documented in the repository) as a temporary workaround until the store update is approved.
- Private repository access: verified 2026-10-16 (version 0.1.0 code path, unchanged in 0.2.0) in a real signed-in Chromium browser against a private repository's HTML file: the file was read through the browser's GitHub sign-in with no token and rendered. A private-repository *pull request diff* has not been tried on a real private repository (it uses the same sign-in for the file contents and the `.diff` status, and the page for the commits).

### Rejection History
None yet.
