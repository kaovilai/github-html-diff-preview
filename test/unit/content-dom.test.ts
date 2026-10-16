// The content scripts act on GitHub's markup, which changes without notice. These tests run them against copies of
// that markup, so a report from a user ("the button is missing") becomes a fixture plus an assertion.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanBlobPage } from "../../src/content/blob";
import { scanPrPage } from "../../src/content/pr-diff";
import { mountGithubPage } from "../helpers";

const fixture = (name: string) => readFileSync(path.resolve(__dirname, "../fixtures/github-dom", name), "utf8");

afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
});

describe("single file page (current GitHub layout, captured from github.com)", () => {
    it("puts a Preview button before the Raw button group", () => {
        mountGithubPage("https://github.com/o/r/blob/main/docs/index.html", fixture("blob-react.html"));
        scanBlobPage();
        const button = document.querySelector<HTMLElement>("[data-hp-blob-button]");
        expect(button?.textContent).toBe("Preview");
        expect(button?.getAttribute("data-hp-blob-button")).toBe("main/docs/index.html");
        // next to the toolbar, not floating over the page
        expect(button?.hasAttribute("data-hp-floating")).toBe(false);
        const raw = document.querySelector('[data-testid="raw-button"]')!;
        const group = raw.closest('[data-component="ButtonGroup"], .BtnGroup') ?? raw;
        expect(group.previousElementSibling).toBe(button);
    });

    it("falls back to a floating button when the Raw button cannot be found", () => {
        mountGithubPage("https://github.com/o/r/blob/main/a.html", "<main><p>no toolbar here</p></main>");
        scanBlobPage();
        expect(document.querySelector("[data-hp-floating]")).not.toBeNull();
    });

    it("moves the button when the single-page app navigates, and removes it from other pages", () => {
        mountGithubPage("https://github.com/o/r/blob/main/a.html", fixture("blob-react.html"));
        scanBlobPage();
        window.history.replaceState({}, "", "/o/r/blob/main/b.html");
        scanBlobPage();
        const buttons = document.querySelectorAll("[data-hp-blob-button]");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].getAttribute("data-hp-blob-button")).toBe("main/b.html");
        window.history.replaceState({}, "", "/o/r/blob/main/readme.md");
        scanBlobPage();
        expect(document.querySelector("[data-hp-blob-button]")).toBeNull();
    });

    it("ignores files that are not HTML", () => {
        mountGithubPage("https://github.com/o/r/blob/main/a.txt", fixture("blob-react.html"));
        scanBlobPage();
        expect(document.querySelector("[data-hp-blob-button]")).toBeNull();
    });
});

describe("pull request Files changed", () => {
    it("classic layout (captured from github.com): one button in the file actions", () => {
        mountGithubPage("https://github.com/o/r/pull/5/files", fixture("pr-files-classic.html"));
        scanPrPage();
        const buttons = document.querySelectorAll("[data-hp-preview-button]");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].closest(".file-actions")).not.toBeNull();
    });

    it("current layout: a button next to the file's Expand button, only for HTML files", () => {
        mountGithubPage("https://github.com/o/r/pull/5/files", fixture("pr-files-react.html"));
        scanPrPage();
        const buttons = document.querySelectorAll("[data-hp-preview-button]");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].nextElementSibling?.getAttribute("data-file-path")).toBe("docs/index.html");
    });

    it("is idempotent and does nothing outside pull request file tabs", () => {
        mountGithubPage("https://github.com/o/r/pull/5/files", fixture("pr-files-react.html"));
        scanPrPage();
        scanPrPage();
        expect(document.querySelectorAll("[data-hp-preview-button]")).toHaveLength(1);

        document.body.innerHTML = fixture("pr-files-react.html");
        window.history.replaceState({}, "", "/o/r/pull/5");
        scanPrPage();
        expect(document.querySelectorAll("[data-hp-preview-button]")).toHaveLength(0);
    });
});
