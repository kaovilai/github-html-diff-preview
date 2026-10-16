# Privacy policy

*GitHub HTML Diff Preview* ("the extension") runs entirely in your browser. There is no server operated by the extension's author.

## What the extension does with data

- **GitHub content.** When you click Preview (or use the context menu or keyboard shortcut), the extension requests the HTML file you chose, plus the stylesheets, images and fonts it references and, for pull request diffs, the status of the file in the diff. The two commits a pull request diff compares are read from the GitHub page you are already viewing; if the page does not expose them, the extension asks the GitHub API for the pull request's file list and commits. These requests go only to `github.com`, `api.github.com` and `raw.githubusercontent.com`. The content is processed in your browser and shown to you; it is not stored and not sent anywhere else.
- **Your GitHub login.** For private repositories the extension makes requests to `github.com` that carry your browser's existing GitHub session cookies, exactly as if you had opened the file's *Raw* link. The extension cannot read those cookies and does not store or transmit them.
- **Personal access token (optional).** If you add one in the options page, it is kept in `chrome.storage.local` on your device (it is not synced) and sent only to `api.github.com`, in the `Authorization` header of API requests. You can remove it at any time from the options page.
- **Settings.** Your view mode (inline / side by side) and access mode are stored locally.

## What the extension does not do

- No analytics, telemetry, crash reporting, advertising or tracking.
- No accounts and no data collection by the author or any third party.
- No sale or transfer of user data.
- No remote configuration or remotely hosted code.

## Previewed pages

Previews render untrusted repository HTML in a sandboxed frame with scripts disabled. If you turn on **Run scripts (untrusted)** for a single-file preview, the page's own scripts run in an isolated sandbox and can make network requests like any web page; that traffic is theirs, not the extension's.

## Contact

Questions or concerns: open an issue at https://github.com/kaovilai/github-html-diff-preview/issues or write to github-html-diff-preview@tig.pw.

*Last updated: 2026-10-16.*
