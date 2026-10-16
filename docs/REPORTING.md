# Reporting a problem

Pick the issue form that matches. Each one asks for the same three things so a report can be checked automatically:

1. **A URL** of a public GitHub page where it happens (or the smallest HTML that shows it).
2. **Acceptance criteria**: what should be true once it is fixed, one checkable statement per line.
3. **What actually happens**, plus browser and extension version.

| Form | Use it when | Extra fields that help |
| --- | --- | --- |
| Preview or diff looks wrong | The rendered page, highlighting or diff result is wrong | Before/after HTML (minimal), file URL or pull request URL and file path |
| Preview button missing or misplaced | The button is absent, in the wrong place or dead | The page URL, which GitHub layout you see, the page's markup around the Raw button or file header |
| Cannot load a file or diff | "Not found", access denied or a rate limit | The output of **Test access**, repository visibility, SSO |
| Other bug / Feature request | Anything else | A URL and criteria |

The quickest way is **Report a problem** inside the preview: it opens one of these forms prefilled (the GitHub page address you confirm, the error shown, technical details about the page, your browser and extension version) and you press Submit yourself. Never paste a token, cookie or other secret. Private repository contents cannot be examined by the automation; the minimal HTML fields exist so you can share only what is needed.

The **technical details** are names, counts and outcomes only (page layout, which sources of commit information the page offered and why each did or did not work, file sizes, status codes). They contain no file contents or file names, they are shown in the dialog, and you can edit or clear them before opening the form. They let the helper diagnose a page change without seeing the page.

For a **private repository**, where a link would not help, tick **Include the page's HTML in the report** in the dialog (off by default each time). The file's HTML (both sides of a diff) is put into the form's HTML fields so the helper can reproduce the problem from it. Issues are public: tick it only if the HTML holds nothing sensitive, and review the field before you submit. If the HTML is too long for the address, the start is prefilled and marked as clipped, and the full text is copied to your clipboard to paste over it.

## Good acceptance criteria

Short, concrete and observable. Each line becomes one test.

```
- A Preview button appears next to Raw on https://github.com/owner/repo/blob/main/docs/index.html
- The new <h2>Pricing</h2> is outlined green in the inline diff
- css/site.css is applied in the preview (the heading is blue)
- Unchanged <img src="logo.png"> is not reported as changed
- The message tells me to sign in to github.com when I am signed out
```

## What the automation does

The [issue helper](../.github/workflows/issue-responder.md) (a GitHub Agentic Workflow) reads the form fields and then:

1. **Reconciles** the report: which form, whether the facts needed are present (it asks for what is missing), whether it matches a known cause in the [troubleshooting guide](TROUBLESHOOTING.md) or an existing issue.
2. **Reproduces** it offline with the repository's own code: `npm run repro` runs the real sanitize/diff pipeline on your URL or HTML and reports stylesheets, assets, what is removed and what the diff finds; markup you provide for a missing button is mounted in a jsdom page and the content scripts are run against it.
3. **Tests**: each acceptance criterion becomes a test in `test/unit/regressions/`. If a criterion already passes, it says so and shows the evidence rather than changing code.
4. **Fixes**: when a criterion fails and the cause is a small bug in this repository, it opens a draft pull request with the failing test turned green, for a maintainer to review, and offers the reporter [a fix from source](../README.md#workaround-use-a-fix-from-source) as a temporary workaround until the store version catches up.

Anything it cannot reproduce (private repositories, browser-specific behaviour, GitHub changing its page) is left for a maintainer with a summary of what was tried.

## For maintainers: reproducing by hand

```sh
npm run repro -- file https://github.com/owner/repo/blob/main/docs/index.html
npm run repro -- pr https://github.com/owner/repo/pull/12/files docs/index.html --out .repro/pr12
npm run repro -- diff before.html after.html --out .repro/diff   # writes before/after/inline views
```

`GITHUB_TOKEN` or `GH_TOKEN` is used for the pull request lookup when set (the extension itself never uses the GitHub API). `test/helpers.ts` has `diffHtml()` and `mountGithubPage()` for writing a regression test; `test/fixtures/github-dom/` holds copies of GitHub's markup (the current layout and the classic one, captured from github.com; the signed-in pull request layout is hand-written and should be replaced by a real capture from a `dom_snippet` report).
