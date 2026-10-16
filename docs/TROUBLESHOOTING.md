# Troubleshooting

Start with the options page (toolbar icon, or `chrome://extensions` then *Details* then *Extension options*). Its **Test access** tool tries every way the extension can fetch a file and shows which ones work.

## The Preview button is missing

- It appears on `.html` / `.htm` file pages (`github.com/<owner>/<repo>/blob/...`) and on `.html` files in a pull request's **Files changed** tab. Other file types and other tabs do not get one.
- GitHub is a single-page app and changes its markup without notice. Reload the page once. If it is still missing, the right-click menu entry **Preview HTML file** and the shortcut (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) do not depend on GitHub's markup; if those work, the button selector needs updating and a bug report is welcome.
- GitHub Enterprise Server hosts are not supported.
- If another HTML-preview extension is installed, two buttons can appear; disable one.

## "File not found" or a blank preview for a private repository

1. Make sure you are signed in to github.com in the same browser profile and can open the file normally. The extension reads with that sign-in; it has no token of its own.
2. Open the options page and run **Test access** with the file's URL:
   - `OK session`: the sign-in reaches the file; the preview should work.
   - `FAIL session ... sign in` or `File not found`: sign in to github.com in this profile (SSO and organization authorization apply), or the address is wrong.
3. Still failing? Use **Report a problem** in the preview; it prefills an issue form for you to review and submit.

## A pull request diff does not load

- The commits being compared are read from GitHub's own page. Reload the **Files changed** tab, wait for the diff to appear, and click Preview again.
- If the page still does not tell the extension which commits it compares (GitHub may have changed its page), the preview says so; use **Report a problem**. A fix may be available from source before the store update ships; see [Workaround: use a fix from source](../README.md#workaround-use-a-fix-from-source). The right-click entry on an `.html` file page is unaffected.
- A message about GitHub asking for a pause means GitHub rate-limited the request; wait the stated time.
- Only `<body>` is compared. A change that only touches `<head>` (title, meta tags) shows "No visible changes".

## Styles, images or fonts are missing

- Only relative paths inside the same repository are fetched (`css/site.css`, `../img/logo.png`). External `https://` assets load from their own servers when the page allows it.
- At most 40 assets per page, 2 MiB each and 12 MiB in total are embedded. Larger or later ones are skipped.
- Root-relative paths (`/img/a.png`) resolve against the repository root, not a web server root.
- Pages that build their content with JavaScript render as static HTML. In Chrome, single-file previews have an opt-in **Run scripts (untrusted)** switch.

## Scripts do not run

Scripts are off on purpose. The switch exists for single-file previews in Chrome only (Firefox has no manifest sandbox pages). Diffs never run scripts.

## What to include in a bug report

Browser and version, extension version, whether the repository is public or private, the kind of page (file or pull request) and, if you can share it, the file URL and the output of **Test access**. Never paste a token.
