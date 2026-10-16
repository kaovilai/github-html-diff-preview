"use strict";
(() => {
  // src/core/github-urls.ts
  var HTML_FILE = /\.html?$/i;
  var parseBlobPath = (pathname) => {
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(pathname);
    if (!match) return null;
    let rest;
    try {
      rest = decodeURIComponent(match[3]);
    } catch {
      return null;
    }
    if (!HTML_FILE.test(rest) || !rest.includes("/")) return null;
    return { owner: match[1], repo: match[2], rest };
  };
  var PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:(?:files|changes)(?:\/([^/]+))?|commits\/([0-9a-f]{7,40}))\/?$/;
  var parsePrPath = (pathname) => {
    const match = PR_PATH.exec(pathname);
    if (!match) return null;
    return { owner: match[1], repo: match[2], pr: match[3], range: match[4] || match[5] };
  };

  // src/shared/messages.ts
  var send = async (request) => {
    const response = await chrome.runtime.sendMessage(request);
    if (!response) throw new Error("No response from the extension background worker.");
    if (!response.ok) throw Object.assign(new Error(response.error), { status: response.status });
    return response.data;
  };

  // src/content/dom.ts
  var styled = (tag, css, text) => {
    const el = document.createElement(tag);
    el.style.cssText = css;
    if (text !== void 0) el.textContent = text;
    return el;
  };
  var isDarkTheme = () => {
    const mode = document.documentElement.getAttribute("data-color-mode");
    return mode === "dark" || mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  var BUTTON_CSS = [
    "height:28px",
    "padding:0 10px",
    "margin-right:4px",
    "font-size:12px",
    "font-weight:500",
    "cursor:pointer",
    "border:1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d1d9e0))",
    "border-radius:6px",
    "background:var(--button-default-bgColor-rest, var(--bgColor-muted, #f6f8fa))",
    "color:var(--fgColor-default, #1f2328)"
  ].join(";");
  var BUTTON_CLASS = "hp-btn";
  var ensureStyles = () => {
    if (document.getElementById("hp-content-style")) return;
    const style = document.createElement("style");
    style.id = "hp-content-style";
    style.textContent = `@media (pointer: coarse) { .${BUTTON_CLASS} { min-height: 44px !important; height: auto !important; min-width: 44px !important; padding-left: 16px !important; padding-right: 16px !important; font-size: 14px !important; } }`;
    (document.head || document.documentElement).appendChild(style);
  };

  // src/content/ref.ts
  var embeddedRefName = () => {
    const script = document.querySelector('script[data-target="react-app.embeddedData"]');
    if (!script?.textContent) return void 0;
    try {
      const data = JSON.parse(script.textContent);
      const name = data.payload?.refInfo?.name;
      return typeof name === "string" ? name : void 0;
    } catch {
      return void 0;
    }
  };
  var pickerText = () => {
    const selectors = ['[data-testid="anchor-button"] .ref-selector-button-text-container', "#branch-select-menu .css-truncate-target", "summary[data-hotkey='w'] .css-truncate-target", "[data-hotkey='w'] .css-truncate-target", "[data-hotkey='w'] span[class*='Text']"];
    const out = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        const text = el.textContent?.trim();
        if (text) out.push(text);
      });
    }
    return out;
  };
  var findRef = (rest) => {
    const candidates = [embeddedRefName(), ...pickerText()].filter((value) => !!value);
    return candidates.filter((name) => rest.startsWith(name + "/")).sort((a, b) => b.length - a.length)[0];
  };

  // src/content/blob.ts
  var BUTTON_ATTR = "data-hp-blob-button";
  var FLOATING_ATTR = "data-hp-floating";
  var RAW_SELECTORS = ['[data-testid="raw-button"]', "#raw-url", 'a[href*="/raw/"].btn'];
  var findRawButton = () => {
    for (const selector of RAW_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };
  var makeButton = (blob, anchor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Preview";
    button.title = "Preview this HTML file locally";
    button.setAttribute(BUTTON_ATTR, blob.rest);
    button.className = BUTTON_CLASS;
    if (anchor?.className) {
      button.className = `${BUTTON_CLASS} ${anchor.className}`;
    } else if (anchor) {
      button.style.cssText = BUTTON_CSS;
    } else {
      button.setAttribute(FLOATING_ATTR, "");
      button.style.cssText = BUTTON_CSS + ";position:fixed;right:16px;bottom:16px;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      send({ type: "open-preview", owner: blob.owner, repo: blob.repo, rest: blob.rest, ref: findRef(blob.rest) }).catch(() => {
        const note = styled("span", "margin-left:8px;color:#cf222e", "Could not open the preview.");
        button.after(note);
        setTimeout(() => note.remove(), 4e3);
      });
    });
    return button;
  };
  var scanBlobPage = () => {
    const blob = parseBlobPath(location.pathname);
    const existing = document.querySelector(`[${BUTTON_ATTR}]`);
    if (!blob) {
      existing?.remove();
      return;
    }
    const anchor = findRawButton();
    const floating = existing?.hasAttribute(FLOATING_ATTR);
    if (existing && existing.getAttribute(BUTTON_ATTR) === blob.rest && existing.isConnected && !(floating && anchor)) return;
    existing?.remove();
    const button = makeButton(blob, anchor);
    if (anchor) {
      const group = anchor.closest('[data-component="ButtonGroup"], .BtnGroup') ?? anchor;
      group.insertAdjacentElement("beforebegin", button);
      button.style.marginRight = "6px";
    } else {
      document.body.appendChild(button);
    }
  };

  // src/shared/viewer-url.ts
  var viewerHash = (params) => {
    const entries = Object.entries(params).filter((entry) => typeof entry[1] === "string");
    return new URLSearchParams(entries).toString();
  };
  var viewerUrl = (params) => `${chrome.runtime.getURL("viewer/viewer.html")}#${viewerHash(params)}`;

  // src/content/pr-shas.ts
  var entryPattern = (owner, repo) => new RegExp(`^https://github\\.com/${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/diffs/([0-9a-f]{40})\\.\\.([0-9a-f]{40})(?:[?#]|$)`, "i");
  var HEX = /^[0-9a-f]{7,40}$/i;
  var agreesWithRange = (range, shas) => {
    if (!range) return null;
    if (/\.{2,3}/.test(range)) {
      const [from, to] = range.split(/\.{2,3}/);
      if (!HEX.test(from) || !HEX.test(to)) return false;
      return shas.before.startsWith(from.toLowerCase()) && shas.after.startsWith(to.toLowerCase());
    }
    return HEX.test(range) && shas.after.startsWith(range.toLowerCase());
  };
  var agreesWithPage = (ctx, shas, doc) => {
    const range = agreesWithRange(ctx.range, shas);
    if (range !== null) return range;
    return !!doc.querySelector(`a[href*="/blob/${shas.after}/"], a[href*="/commit/${shas.after}"]`);
  };
  var FULL_SHA = /^[0-9a-f]{40}$/i;
  var sha = (value) => typeof value === "string" && FULL_SHA.test(value) ? value.toLowerCase() : null;
  var dig = (value, ...keys) => keys.reduce((node, key) => node !== null && typeof node === "object" ? node[key] : void 0, value);
  var inspectEmbeddedData = (ctx, doc) => {
    const lower = (value) => typeof value === "string" ? value.toLowerCase() : null;
    const scripts = Array.from(doc.querySelectorAll('script[data-target="react-app.embeddedData"]'));
    if (!scripts.length) return { shas: null, why: "absent", routeKeys: [] };
    let why = "present, but no usable pull request data";
    let routeKeys = [];
    for (const script of scripts) {
      let payload;
      try {
        payload = dig(JSON.parse(script.textContent ?? ""), "payload");
      } catch {
        why = "present, not valid JSON";
        continue;
      }
      const route = dig(payload, "pullRequestsChangesRoute");
      if (route === null || typeof route !== "object") {
        why = `present, no pullRequestsChangesRoute (payload keys: ${listKeys(payload)})`;
        continue;
      }
      routeKeys = Object.keys(route);
      if (String(dig(route, "pullRequest", "number")) !== ctx.pr) {
        why = "present, for another pull request";
        continue;
      }
      if (lower(dig(route, "repository", "ownerLogin")) !== ctx.owner.toLowerCase() || lower(dig(route, "repository", "name")) !== ctx.repo.toLowerCase()) {
        why = "present, for another repository";
        continue;
      }
      const diffs = dig(route, "diffContents");
      const entry = Array.isArray(diffs) ? diffs.find((item) => sha(dig(item, "oldCommitOid")) && sha(dig(item, "newCommitOid"))) : void 0;
      const before = sha(dig(entry, "oldCommitOid")) ?? sha(dig(route, "comparison", "fullDiff", "baseOid"));
      const after = sha(dig(entry, "newCommitOid")) ?? sha(dig(route, "comparison", "fullDiff", "headOid"));
      if (!before || !after) {
        why = `present, no commit pair (diffContents: ${Array.isArray(diffs) ? diffs.length : "missing"}, fullDiff: ${dig(route, "comparison", "fullDiff") ? "yes" : "no"})`;
        continue;
      }
      const shas = { before, after };
      const range = agreesWithRange(ctx.range, shas);
      if (range === false) {
        why = "present, commits disagree with the address";
        continue;
      }
      if (range === null) {
        const head = sha(dig(payload, "pullRequestsLayoutRoute", "pullRequest", "headSha"));
        if (head && head !== after) {
          why = "present, diff does not end at the pull request's head";
          continue;
        }
      }
      return { shas, why: "ok", routeKeys };
    }
    return { shas: null, why, routeKeys };
  };
  var listKeys = (value) => value !== null && typeof value === "object" ? Object.keys(value).slice(0, 20).join(",") || "none" : "none";
  var fromEmbeddedData = (ctx, doc) => inspectEmbeddedData(ctx, doc).shas;
  var findDiffShas = (ctx, doc = document, entries = performance.getEntriesByType("resource")) => {
    const pattern = entryPattern(ctx.owner, ctx.repo);
    const urls = [
      ...Array.from(entries, (entry) => entry.name).reverse(),
      ...Array.from(doc.querySelectorAll("deferred-diff-lines[data-url]"), (element) => element.getAttribute("data-url"))
    ];
    for (const url of urls) {
      let normalized;
      try {
        normalized = new URL(url, "https://github.com").href;
      } catch {
        continue;
      }
      const match = pattern.exec(normalized);
      if (!match) continue;
      const shas = { before: match[1].toLowerCase(), after: match[2].toLowerCase() };
      if (agreesWithPage(ctx, shas, doc)) return shas;
    }
    return fromEmbeddedData(ctx, doc);
  };
  var waitForDiffShas = (ctx, timeoutMs = 4e3) => {
    const now = findDiffShas(ctx);
    if (now || typeof PerformanceObserver === "undefined") return Promise.resolve(now);
    return new Promise((resolve) => {
      const finish = (shas) => {
        observer.disconnect();
        clearTimeout(timer);
        resolve(shas);
      };
      const observer = new PerformanceObserver(() => {
        const found = findDiffShas(ctx);
        if (found) finish(found);
      });
      const timer = setTimeout(() => finish(findDiffShas(ctx)), timeoutMs);
      observer.observe({ type: "resource" });
    });
  };
  var diagnoseDiffShas = (ctx, doc = document, entries = performance.getEntriesByType("resource")) => {
    const pattern = entryPattern(ctx.owner, ctx.repo);
    const requests = Array.from(entries, (entry) => entry.name).filter((name) => pattern.test(name));
    const deferred = doc.querySelectorAll("deferred-diff-lines[data-url]").length;
    const embedded = inspectEmbeddedData(ctx, doc);
    const layout = doc.querySelector('[role="grid"][aria-label^="Diff for: "]') ? "signed-in (grid)" : doc.querySelector(".file[data-tagsearch-path]") ? "classic" : "unrecognised";
    const found = findDiffShas(ctx, doc, entries);
    return [
      `commit discovery: ${found ? "found" : "not found"}`,
      `page layout: ${layout}`,
      `address: ${ctx.range ? /\.{2,3}/.test(ctx.range) ? "commit range" : "single commit" : "whole pull request"}`,
      `diff requests seen: ${requests.length} (of ${entries.length} resources)`,
      `deferred-diff-lines elements: ${deferred}`,
      `embedded data: ${embedded.why}`,
      ...embedded.routeKeys.length ? [`embedded route keys: ${embedded.routeKeys.slice(0, 30).join(",")}`] : []
    ];
  };

  // src/content/pr-diff.ts
  var NEW_DIFF_LABEL = "Diff for: ";
  var BUTTON_ATTR2 = "data-hp-preview-button";
  var PANEL_ATTR = "data-hp-preview-panel";
  var getPrContext = () => parsePrPath(location.pathname);
  var findNewLayoutFiles = () => {
    const files = [];
    document.querySelectorAll(`[role="grid"][aria-label^="${NEW_DIFF_LABEL}"]`).forEach((grid) => {
      const path = grid.getAttribute("aria-label").slice(NEW_DIFF_LABEL.length);
      let container = grid.parentElement;
      while (container && container !== document.body && !container.querySelector("h3")) container = container.parentElement;
      if (!container || container === document.body) return;
      const expand = container.querySelector(`button[data-file-path="${CSS.escape(path)}"]`);
      const viewed = container.querySelector('button[aria-pressed][aria-label$="Viewed"]');
      const anchor = expand || viewed;
      files.push({
        path,
        diff: grid,
        buttonClass: "",
        insertButton: (button) => {
          if (anchor) {
            anchor.insertAdjacentElement("beforebegin", button);
          } else {
            const bar = styled("div", "display:flex;justify-content:flex-end;padding:4px 8px");
            bar.appendChild(button);
            grid.insertAdjacentElement("beforebegin", bar);
          }
        },
        insertPanel: (panel) => grid.insertAdjacentElement("beforebegin", panel)
      });
    });
    return files;
  };
  var findClassicLayoutFiles = () => {
    const files = [];
    document.querySelectorAll(".file[data-tagsearch-path]").forEach((file) => {
      const actions = file.querySelector(".file-header .file-actions");
      const header = file.querySelector(".file-header");
      if (!actions || !header) return;
      files.push({
        path: file.getAttribute("data-tagsearch-path"),
        diff: file,
        buttonClass: "btn btn-sm",
        insertButton: (button) => actions.insertAdjacentElement("afterbegin", button),
        insertPanel: (panel) => header.insertAdjacentElement("afterend", panel)
      });
    });
    return files;
  };
  var openPaths = /* @__PURE__ */ new Set();
  var stateKey = (ctx, path) => `${ctx.owner}/${ctx.repo}#${ctx.pr}@${ctx.range ?? ""}:${path}`;
  var findPanel = (key) => {
    return Array.from(document.querySelectorAll(`[${PANEL_ATTR}]`)).find((panel) => panel.getAttribute(PANEL_ATTR) === key);
  };
  var pageDiagnostics = (ctx) => {
    try {
      return diagnoseDiffShas(ctx).join("\n").slice(0, 900);
    } catch {
      return "diagnostics unavailable";
    }
  };
  var createPanel = (ctx, path, key, onClose) => {
    const border = "1px solid var(--borderColor-default, #d1d9e0)";
    const panel = styled("div", `display:flex;flex-direction:column;height:70vh;min-height:240px;margin:8px;border:${border};border-radius:6px;overflow:hidden;resize:vertical;background:var(--bgColor-default, #fff)`);
    panel.setAttribute(PANEL_ATTR, key);
    const bar = styled("div", `display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;border-bottom:${border};background:var(--bgColor-muted, #f6f8fa);color:var(--fgColor-default, #1f2328)`);
    const title = styled("strong", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", `HTML diff preview \xB7 ${path}`);
    const fullscreen = styled("button", BUTTON_CSS, "Full screen");
    const close = styled("button", BUTTON_CSS, "Close");
    fullscreen.type = close.type = "button";
    fullscreen.className = close.className = BUTTON_CLASS;
    bar.append(title, fullscreen, close);
    const frame = styled("iframe", "flex:1;width:100%;border:0");
    frame.title = `HTML diff preview of ${path}`;
    void waitForDiffShas(ctx).then((shas) => {
      if (!panel.isConnected) return;
      frame.src = viewerUrl({ kind: "pr", owner: ctx.owner, repo: ctx.repo, pr: ctx.pr, path, range: ctx.range, before: shas?.before, after: shas?.after, theme: isDarkTheme() ? "dark" : "light", diag: pageDiagnostics(ctx) });
    });
    const normalCss = panel.style.cssText;
    const setFullscreen = (on) => {
      panel.style.cssText = on ? `${normalCss};position:fixed;inset:0;z-index:2147483000;height:auto;margin:0;border-radius:0;resize:none` : normalCss;
      fullscreen.textContent = on ? "Exit full screen" : "Full screen";
    };
    let isFullscreen = false;
    fullscreen.onclick = () => {
      isFullscreen = !isFullscreen;
      setFullscreen(isFullscreen);
    };
    const onKey = (event) => {
      if (!panel.isConnected) {
        document.removeEventListener("keydown", onKey);
      } else if (event.key === "Escape" && isFullscreen) {
        isFullscreen = false;
        setFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    close.onclick = () => {
      document.removeEventListener("keydown", onKey);
      panel.remove();
      onClose();
    };
    panel.append(bar, frame);
    return panel;
  };
  var attributeValues = (attribute) => {
    return new Set(Array.from(document.querySelectorAll(`[${attribute}]`)).map((el) => el.getAttribute(attribute)));
  };
  var scanPrPage = () => {
    const ctx = getPrContext();
    if (!ctx) return;
    const buttons = attributeValues(BUTTON_ATTR2);
    const panels = attributeValues(PANEL_ATTR);
    for (const file of [...findNewLayoutFiles(), ...findClassicLayoutFiles()]) {
      if (!HTML_FILE.test(file.path)) continue;
      const key = stateKey(ctx, file.path);
      const open = () => {
        openPaths.add(key);
        if (!findPanel(key)) file.insertPanel(createPanel(ctx, file.path, key, () => openPaths.delete(key)));
      };
      if (!buttons.has(key)) {
        const button = styled("button", BUTTON_CSS, "Preview");
        button.type = "button";
        button.className = `${BUTTON_CLASS} ${file.buttonClass}`.trim();
        button.setAttribute(BUTTON_ATTR2, key);
        button.title = "Preview this HTML file with added and removed parts highlighted";
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const panel = findPanel(key);
          if (panel) {
            panel.remove();
            openPaths.delete(key);
          } else {
            open();
          }
        };
        file.insertButton(button);
      }
      if (openPaths.has(key) && !panels.has(key)) open();
    }
  };

  // src/content/index.ts
  var scheduled = false;
  var scan = () => {
    scheduled = false;
    try {
      ensureStyles();
    } catch {
    }
    try {
      scanBlobPage();
    } catch {
    }
    try {
      scanPrPage();
    } catch {
    }
  };
  var schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  };
  schedule();
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "get-ref" || typeof message.rest !== "string") return false;
    sendResponse({ ref: findRef(message.rest) });
    return false;
  });
})();
