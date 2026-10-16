# Changelog

## 0.2.0

- Removed the GitHub REST API fallback and the personal access token option. The extension now only reads, through the browser's own GitHub sign-in (`/raw/...`, plus the page's own data and `.diff`), so nothing is stored and `api.github.com` is never contacted.
- Dropped the `storage` and `https://api.github.com/*` permissions; the chosen diff layout is remembered in the preview page's own storage.
- Added **Report a problem**: opens a prefilled GitHub issue form (address you confirm and edit, the error shown, browser and extension version) that you review and submit yourself.
- The options page keeps only the access test.

## 0.1.0 (unreleased)

Initial release.

- Preview button, context menu entry and keyboard shortcut for `.html` / `.htm` files on GitHub, rendered locally in a sandboxed frame.
- Rendered before/after diff of HTML files in pull requests, commit ranges and single commits (inline and side by side).
- Private repositories through the browser's own GitHub login, including pull request diffs: the compared commits are read from GitHub's page and the file status from its `.diff` view, so no token or REST API call is needed. An optional fine-grained token is a fallback.
- Repo-relative stylesheets, images and fonts inlined with a bounded request budget.
- Opt-in "Run scripts (untrusted)" mode for single-file previews (Chrome only), isolated in a manifest sandbox page.
- Options page with an access-test tool.
