# Troubleshooting

Start with the options page (toolbar icon, or `chrome://extensions` then *Details* then *Extension options*). Its **Test access** tool tries every way the extension can fetch a file and shows which ones work.

## The Preview button is missing

- It appears on `.html` / `.htm` file pages (`github.com/<owner>/<repo>/blob/...`) and on `.html` files in a pull request's **Files changed** tab. Other file types and other tabs do not get one.
- GitHub is a single-page app and changes its markup without notice. Reload the page once. If it is still missing, the right-click menu entry **Preview HTML file** and the shortcut (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) do not depend on GitHub's markup; if those work, the button selector needs updating and a bug report is welcome.
- GitHub Enterprise Server hosts are not supported.
- If another HTML-preview extension is installed, two buttons can appear; disable one.

## "File not found" or a blank preview for a private repository

1. Make sure you are signed in to github.com in the same browser profile and can open the file normally.
2. Open the options page and run **Test access** with the file's URL. Read the lines:
   - `OK session`: the browser login works; the preview should work.
   - `FAIL session ... Not signed in`: sign in to github.com in this profile (SSO/organization authorization applies).
   - `OK token` / `FAIL token`: whether the optional personal access token can read the file.
3. A fine-grained token needs read-only **Contents** (and **Pull requests** for the pull request fallback) on that repository.

## A pull request diff does not load

- The commits being compared are read from GitHub's own page. Reload the **Files changed** tab and click Preview again after the page has finished loading.
- If the page does not expose them, the extension falls back to the GitHub API: public repositories work anonymously (60 requests per hour), private repositories need a token (see above).
- "Rate limit" in the message means GitHub told the extension to back off; wait the stated time or add a token.
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
