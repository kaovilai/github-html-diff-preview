# Privacy policy

*GitHub HTML Diff Preview* ("the extension") runs entirely in your browser. There is no server operated by the extension's author.

## What the extension does with data

- **GitHub content.** When you click Preview (or use the context menu or keyboard shortcut), the extension requests, read-only, the HTML file you chose, plus the stylesheets, images and fonts it references and, for pull request diffs, the status of the file in the diff. The two commits a pull request diff compares are read from the GitHub page you are already viewing. These requests go only to `github.com` and `raw.githubusercontent.com`. The content is processed in your browser and shown to you; it is not stored and not sent anywhere else.
- **Your GitHub login.** For private repositories the extension makes requests to `github.com` that carry your browser's existing GitHub session cookies, exactly as if you had opened the file's *Raw* link. The extension cannot read those cookies and does not store or transmit them.
- **No token, no account.** The extension has no sign-in of its own and stores no secret. It never calls the GitHub API.
- **Settings.** Your inline / side-by-side choice is remembered in the preview page's own storage on your device.
- **Reporting a problem.** If you use **Report a problem**, the extension opens a new issue form on github.com in your browser, prefilled with the GitHub page address you confirmed in the dialog, the error shown, your browser and extension version. If you tick **Include the page's HTML** (off by default each time), the HTML of the file you are viewing is added to the form too, and when it is too long for the address it is also copied to your clipboard so you can paste it in. You review the form and submit it yourself; the extension sends nothing.

## What the extension does not do

- No analytics, telemetry, crash reporting, advertising or tracking.
- No accounts and no data collection by the author or any third party.
- No sale or transfer of user data.
- No remote configuration or remotely hosted code.

## Previewed pages

Previews render untrusted repository HTML in a sandboxed frame with scripts disabled. If you turn on **Run scripts (untrusted)** for a single-file preview, the page's own scripts run in an isolated sandbox and can make network requests like any web page; that traffic is theirs, not the extension's. Turning the switch on asks for confirmation and lists the scripts first. If you choose **Always allow** for a repository, its name (`owner/repo`) is kept in the extension's own local storage on your device until you remove it on the options page; it is never sent anywhere.

## Contact

Questions or concerns: open an issue at https://github.com/kaovilai/github-html-diff-preview/issues or write to github-html-diff-preview@tig.pw.

*Last updated: 2026-10-16.*
