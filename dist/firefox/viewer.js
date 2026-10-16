"use strict";
(() => {
  // src/shared/messages.ts
  var send = async (request) => {
    const response = await chrome.runtime.sendMessage(request);
    if (!response) throw new Error("No response from the extension background worker.");
    if (!response.ok) throw Object.assign(new Error(response.error), { status: response.status });
    return response.data;
  };

  // src/core/github-urls.ts
  var SHA = /^[0-9a-f]{7,40}$/i;
  var isSha = (value) => SHA.test(value);
  var encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

  // src/core/html-prepare.ts
  var REPO_SCHEME = "hp-repo:";
  var ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
  var IMPORT_RULE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*([^;]*);/gi;
  var CSS_URL = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
  var MAX_STYLESHEETS = 8;
  var MAX_STYLESHEET_FETCHES = 16;
  var MAX_IMPORT_DEPTH = 3;
  var MAX_SCRIPTS = 8;
  var URL_ATTRIBUTES = ["src", "poster", "data"];
  var dirOf = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  var suffixOf = (href) => /[?#].*$/.exec(href.trim())?.[0] ?? "";
  var resolveRepoPath = (fromFile, href) => {
    const clean = href.trim().split("#")[0].split("?")[0];
    if (!clean || ABSOLUTE_URL.test(clean)) return null;
    const dir = dirOf(fromFile);
    try {
      const resolved = new URL(clean, `https://repo.invalid/${dir}${dir ? "/" : ""}`);
      return decodeURIComponent(resolved.pathname.replace(/^\//, ""));
    } catch {
      return null;
    }
  };
  var rawUrl = (ctx, repoPath, suffix) => {
    return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${encodePath(ctx.ref)}/${encodePath(repoPath)}${suffix}`;
  };
  var blobUrl = (ctx, href) => {
    const path = resolveRepoPath(ctx.path, href);
    if (path === null) return href;
    return `https://github.com/${ctx.owner}/${ctx.repo}/blob/${encodePath(ctx.ref)}/${encodePath(path)}${suffixOf(href)}`;
  };
  var assetUrl = (ctx, fromFile, href) => {
    const path = resolveRepoPath(fromFile, href);
    if (path === null) return href;
    return ctx.assetUrl?.(path) ?? rawUrl(ctx, path, suffixOf(href));
  };
  var rewriteCssUrls = (css, ctx, fromFile) => {
    return css.replace(CSS_URL, (match, quote, url) => {
      const trimmed = url.trim();
      if (trimmed.startsWith(REPO_SCHEME)) {
        const path = decodeURIComponent(trimmed.slice(REPO_SCHEME.length).replace(/^\//, "").split(/[?#]/)[0]);
        const resolved = ctx.assetUrl?.(path) ?? rawUrl(ctx, path, suffixOf(trimmed));
        return `url(${quote}${resolved}${quote})`;
      }
      if (ABSOLUTE_URL.test(trimmed)) return match;
      return `url(${quote}${assetUrl(ctx, fromFile, url)}${quote})`;
    });
  };
  var anchorCssUrls = (css, sheetPath) => {
    return css.replace(CSS_URL, (match, quote, url) => {
      if (ABSOLUTE_URL.test(url.trim())) return match;
      const path = resolveRepoPath(sheetPath, url);
      if (path === null) return match;
      return `url(${quote}${REPO_SCHEME}/${encodePath(path)}${suffixOf(url)}${quote})`;
    });
  };
  var rewriteSrcset = (srcset, rewrite) => {
    const candidates = [];
    let i = 0;
    while (i < srcset.length) {
      while (i < srcset.length && (/\s/.test(srcset[i]) || srcset[i] === ",")) i++;
      const start = i;
      while (i < srcset.length && !/\s/.test(srcset[i])) i++;
      const url = srcset.slice(start, i);
      if (!url) break;
      const trailingCommas = /,+$/.exec(url);
      if (trailingCommas) {
        candidates.push(rewrite(url.slice(0, -trailingCommas[0].length)));
        continue;
      }
      const descriptorStart = i;
      let depth = 0;
      while (i < srcset.length && !(srcset[i] === "," && depth === 0)) {
        if (srcset[i] === "(") depth++;
        else if (srcset[i] === ")") depth--;
        i++;
      }
      candidates.push(rewrite(url) + srcset.slice(descriptorStart, i).replace(/\s+$/, ""));
    }
    return candidates.join(", ");
  };
  var linkedStylesheets = (doc) => {
    return Array.from(doc.querySelectorAll("link[rel~='stylesheet'][href]")).filter((link) => !ABSOLUTE_URL.test(link.getAttribute("href").trim()));
  };
  var relativeScripts = (doc) => {
    return Array.from(doc.querySelectorAll("script[src]")).filter((script) => !ABSOLUTE_URL.test(script.getAttribute("src").trim()));
  };
  var pathsOf = (elements, attribute, filePath, max) => {
    const paths = [];
    for (const el of elements) {
      const path = resolveRepoPath(filePath, el.getAttribute(attribute));
      if (path !== null && paths.indexOf(path) < 0) paths.push(path);
    }
    return paths.slice(0, max);
  };
  var getStylesheetPaths = (doc, filePath) => {
    return pathsOf(linkedStylesheets(doc), "href", filePath, MAX_STYLESHEETS);
  };
  var getScriptPaths = (doc, filePath) => {
    return pathsOf(relativeScripts(doc), "src", filePath, MAX_SCRIPTS);
  };
  var EXECUTABLE_SCRIPT_TYPE = /^(|module|(text|application)\/(x-)?(java|ecma)script)$/i;
  var describeScripts = (doc, filePath) => {
    const scripts = Array.from(doc.querySelectorAll("script")).filter((script) => EXECUTABLE_SCRIPT_TYPE.test((script.getAttribute("type") ?? "").trim()));
    const remote = [];
    let inline = 0;
    for (const script of scripts) {
      const src = script.getAttribute("src");
      if (src === null) {
        if (script.textContent?.trim()) inline++;
      } else if (ABSOLUTE_URL.test(src.trim())) {
        if (remote.indexOf(src.trim()) < 0) remote.push(src.trim());
      }
    }
    return { local: pathsOf(scripts.filter((script) => script.hasAttribute("src") && !ABSOLUTE_URL.test(script.getAttribute("src").trim())), "src", filePath, MAX_SCRIPTS), remote, inline };
  };
  var loadStylesheets = async (paths, fetchText2) => {
    const sheets = /* @__PURE__ */ new Map();
    let fetches = 0;
    const load = async (path, depth, ancestors) => {
      if (fetches >= MAX_STYLESHEET_FETCHES) return void 0;
      fetches++;
      let css;
      try {
        css = await fetchText2(path);
      } catch {
        return void 0;
      }
      const chain = [...ancestors, path];
      let out = "";
      let last = 0;
      for (const match of Array.from(css.matchAll(IMPORT_RULE))) {
        out += css.slice(last, match.index);
        last = match.index + match[0].length;
        const [rule, , url, media] = match;
        const importPath = ABSOLUTE_URL.test(url) ? null : resolveRepoPath(path, url);
        const inlined = importPath !== null && depth < MAX_IMPORT_DEPTH && chain.indexOf(importPath) < 0 ? await load(importPath, depth + 1, chain) : void 0;
        if (inlined === void 0) out += rule;
        else out += media.trim() ? `@media ${media.trim()}{${inlined}}` : inlined;
      }
      out += css.slice(last);
      return anchorCssUrls(out, path);
    };
    await Promise.all(paths.map(async (path) => {
      const css = await load(path, 0, []);
      if (css !== void 0) sheets.set(path, css);
    }));
    return sheets;
  };
  var loadScripts = async (paths, fetchText2) => {
    const scripts = /* @__PURE__ */ new Map();
    await Promise.all(paths.map(async (path) => {
      try {
        scripts.set(path, await fetchText2(path));
      } catch {
      }
    }));
    return scripts;
  };
  var isScriptUrl = (value) => /^javascript:/i.test(Array.from(value).filter((char) => char.charCodeAt(0) > 32).join(""));
  var sanitizeDocument = (doc, filePath, sheets, options = {}) => {
    const { allowScripts = false, scripts = /* @__PURE__ */ new Map() } = options;
    doc.querySelectorAll("base, meta[http-equiv], object, embed, iframe[srcdoc]").forEach((el) => el.remove());
    if (!allowScripts) doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
    for (const link of linkedStylesheets(doc)) {
      const path = resolveRepoPath(filePath, link.getAttribute("href"));
      const css = path === null ? void 0 : sheets.get(path);
      if (css === void 0) continue;
      const style = doc.createElement("style");
      style.setAttribute("data-hp-sheet", path);
      const media = link.getAttribute("media");
      if (media) style.setAttribute("media", media);
      style.textContent = css;
      link.replaceWith(style);
    }
    if (allowScripts) {
      for (const script of relativeScripts(doc)) {
        const path = resolveRepoPath(filePath, script.getAttribute("src"));
        const code = path === null ? void 0 : scripts.get(path);
        if (code === void 0) continue;
        script.removeAttribute("src");
        script.textContent = code.replace(/<\/script/gi, "<\\/script");
      }
      return;
    }
    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc") {
          el.removeAttribute(attr.name);
        } else if (isScriptUrl(attr.value) && (name === "href" || name === "src" || name === "action" || name === "formaction" || name === "xlink:href")) {
          el.removeAttribute(attr.name);
        }
      }
    });
  };
  var rewriteElement = (el, ctx) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "style") el.textContent = rewriteCssUrls(el.textContent || "", ctx, ctx.path);
    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", rewriteCssUrls(style, ctx, ctx.path));
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value && !ABSOLUTE_URL.test(value.trim())) el.setAttribute(name, assetUrl(ctx, ctx.path, value));
    }
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      el.setAttribute("srcset", rewriteSrcset(srcset, (url) => ABSOLUTE_URL.test(url) ? url : assetUrl(ctx, ctx.path, url)));
    }
    if (tag === "link") {
      const href = el.getAttribute("href");
      if (href && !ABSOLUTE_URL.test(href.trim())) el.setAttribute("href", assetUrl(ctx, ctx.path, href));
    } else if (tag === "a" || tag === "area") {
      const href = el.getAttribute("href");
      if (href && !href.trim().startsWith("#")) {
        el.setAttribute("href", ABSOLUTE_URL.test(href.trim()) ? href : blobUrl(ctx, href));
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  var rewriteUrls = (root, ctx) => {
    if (root.nodeType === 1) rewriteElement(root, ctx);
    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
      root.querySelectorAll("*").forEach((el) => rewriteElement(el, ctx));
    }
  };
  var collectAssetPaths = (doc, ctx) => {
    const seen = /* @__PURE__ */ new Set();
    const copy = doc.cloneNode(true);
    rewriteUrls(copy, { ...ctx, assetUrl: (path) => {
      seen.add(path);
      return void 0;
    } });
    return Array.from(seen);
  };
  var serializeDocument = (doc) => "<!DOCTYPE html>" + doc.documentElement.outerHTML;

  // src/core/assets.ts
  var ASSET_MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf"
  };
  var DEFAULT_BUDGET = {
    maxAssets: 40,
    maxBytesEach: 2 * 1024 * 1024,
    maxBytesTotal: 12 * 1024 * 1024,
    concurrency: 6
  };
  var assetMime = (path) => {
    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase();
    return extension ? ASSET_MIME[extension] : void 0;
  };
  var dataUrlBytes = (url) => Math.floor((url.length - url.indexOf(",") - 1) * 3 / 4);
  var loadAssets = async (paths, fetchAsset2, budget = DEFAULT_BUDGET) => {
    const queue = paths.filter((path) => assetMime(path) !== void 0).slice(0, budget.maxAssets);
    const assets = /* @__PURE__ */ new Map();
    let total = 0;
    const worker = async () => {
      for (let path = queue.shift(); path !== void 0; path = queue.shift()) {
        if (total >= budget.maxBytesTotal) return;
        let url;
        try {
          url = await fetchAsset2(path);
        } catch {
          continue;
        }
        if (url === void 0) continue;
        const size = dataUrlBytes(url);
        if (total + size > budget.maxBytesTotal) continue;
        total += size;
        assets.set(path, url);
      }
    };
    await Promise.all(Array.from({ length: Math.min(budget.concurrency, queue.length) }, worker));
    return assets;
  };

  // src/viewer/common.ts
  var STATIC_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
  var byId = (id) => document.getElementById(id);
  var fetchText = (file) => send({ type: "file-text", ...file });
  var fetchAsset = (file) => send({ type: "asset", ...file });
  var parse = (html) => new DOMParser().parseFromString(html, "text/html");
  var prepareSide = async (side, options = {}) => {
    const file = (path) => ({ owner: side.owner, repo: side.repo, ref: side.ref, path });
    const sheetPaths = getStylesheetPaths(parse(side.html), side.path);
    const sheets = await loadStylesheets(sheetPaths, (path) => fetchText(file(path)));
    const makeDocument = () => {
      const doc = parse(side.html);
      sanitizeDocument(doc, side.path, sheets, options);
      return doc;
    };
    const base = { owner: side.owner, repo: side.repo, ref: side.ref, path: side.path };
    const assets = await loadAssets(collectAssetPaths(makeDocument(), base), (path) => fetchAsset(file(path)));
    return { ctx: { ...base, assetUrl: (path) => assets.get(path) }, makeDocument };
  };
  var showNotice = (text) => {
    const notice = byId("notice");
    notice.textContent = text;
    notice.hidden = false;
  };

  // src/shared/report.ts
  var REPO = "kaovilai/github-html-diff-preview";
  var TEMPLATES = {
    access: { file: "access_problem.yml", prefix: "[access]", criteria: "- The page previews without an error" },
    render: { file: "rendering_bug.yml", prefix: "[render]", criteria: "- The preview matches how the page looks in a normal browser tab" },
    other: { file: "bug_report.yml", prefix: "[bug]", criteria: "- It works as expected" }
  };
  var LIMITS = { urls: 1800, actual: 900, probe: 500, title: 240, html: 2e3, diagnostics: 900 };
  var CLIPBOARD_LIMIT = 6e4;
  var CLIPPED_MARKER = "\n<!-- clipped: the full HTML is on your clipboard; replace this text by pasting it -->";
  var sides = (html) => ["before", "after"].flatMap((side) => html?.[side] ? [[side, html[side]]] : []);
  var clip = (value, maxEncoded) => {
    if (encodeURIComponent(value).length <= maxEncoded) return value;
    const characters = Array.from(value).slice(0, maxEncoded);
    const fits = (count) => encodeURIComponent(characters.slice(0, count).join("") + "\u2026").length <= maxEncoded;
    let low = 0, high = characters.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid)) low = mid;
      else high = mid - 1;
    }
    return characters.slice(0, low).join("") + "\u2026";
  };
  var htmlBudget = (html) => Math.floor(LIMITS.html / Math.max(1, sides(html).length));
  var htmlFitsInAddress = (html) => sides(html).every(([, value]) => encodeURIComponent(value).length <= htmlBudget(html));
  var clipboardHtml = (html) => {
    const parts = sides(html);
    const text = parts.length === 1 ? parts[0][1] : parts.map(([side, value]) => `<!-- ${side} -->
${value}`).join("\n");
    return text.length > CLIPBOARD_LIMIT ? text.slice(0, CLIPBOARD_LIMIT) + "\n<!-- clipped at 60000 characters -->" : text;
  };
  var issueUrl = (input) => {
    const template = TEMPLATES[input.kind];
    const error = (input.error ?? "").replace(/\s+/g, " ").trim();
    const params2 = new URLSearchParams();
    params2.set("template", template.file);
    params2.set("title", clip(`${template.prefix} ${error || "Problem with the preview"}`, LIMITS.title));
    params2.set("urls", clip(input.urls.trim(), LIMITS.urls));
    params2.set("actual", clip(error || "(describe what happened)", LIMITS.actual));
    params2.set("criteria", template.criteria);
    if (input.kind === "access" && input.probe) params2.set("probe", clip(input.probe, LIMITS.probe));
    if (input.diagnostics?.trim()) params2.set("diagnostics", clip(input.diagnostics.trim(), LIMITS.diagnostics));
    const budget = htmlBudget(input.html);
    for (const [side, value] of sides(input.html)) {
      const fits = encodeURIComponent(value).length <= budget;
      params2.set(`${side}_html`, fits ? value : clip(value, budget - encodeURIComponent(CLIPPED_MARKER).length) + CLIPPED_MARKER);
    }
    params2.set("browser", input.browser);
    params2.set("version", input.version);
    return `https://github.com/${REPO}/issues/new?${params2.toString()}`;
  };
  var defaultKind = (status, hasError) => {
    if (status === 401 || status === 403 || status === 404 || status === 429) return "access";
    return hasError ? "other" : "render";
  };
  var describeBrowser = (userAgent) => {
    const edge = /Edg\/([\d.]+)/.exec(userAgent);
    if (edge) return `Edge ${edge[1]}`;
    const firefox = /Firefox\/([\d.]+)/.exec(userAgent);
    if (firefox) return `Firefox ${firefox[1]}`;
    const chrome2 = /Chrome\/([\d.]+)/.exec(userAgent);
    if (chrome2) return `Chrome ${chrome2[1]}`;
    return userAgent.slice(0, 60);
  };

  // src/viewer/report.ts
  var state;
  var setReportState = (patch) => {
    state = { ...state ?? { pageUrl: "" }, ...patch };
  };
  var probeText = async () => {
    if (!state?.probeUrl) return void 0;
    try {
      const result = await send({ type: "probe", url: state.probeUrl });
      return result.outcomes.map((outcome) => `${outcome.ok ? "OK  " : "FAIL"} ${outcome.strategy}: ${outcome.detail}`).join("\n");
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  var addReportFact = (fact) => {
    setReportState({ facts: [...state?.facts ?? [], fact] });
  };
  var diagnosticsText = () => [...state?.diagnostics ? state.diagnostics.split("\n") : [], ...state?.facts ?? [], ...state?.status ? [`error status: ${state.status}`] : []].join("\n");
  var showError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = typeof error?.status === "number" ? error.status : void 0;
    setReportState({ error: message, status });
    const box = byId("status");
    box.className = "error";
    box.textContent = message;
    box.hidden = false;
    const actions = document.createElement("div");
    actions.className = "error-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.id = "report-from-error";
    button.className = "seg";
    button.textContent = "Report this problem";
    actions.append(button);
    box.append(actions);
  };
  var openReportDialog = () => {
    const current = state ?? { pageUrl: "" };
    byId("report-kind").value = defaultKind(current.status, !!current.error);
    byId("report-urls").value = current.pageUrl;
    const include = byId("report-include-html");
    const has = !!(current.html?.before || current.html?.after);
    include.checked = false;
    include.disabled = !has;
    byId("report-html-hint").textContent = has ? "Publishes the file's HTML in the issue. Tick it when the repository is private and a link would not help, and only if the HTML holds nothing sensitive." : "No HTML has been loaded, so there is nothing to include.";
    byId("report-diagnostics").value = diagnosticsText();
    byId("report-error").textContent = current.error ? `Error shown: ${current.error}` : "No error was shown; describe the problem on the GitHub form.";
    byId("report-dialog").showModal();
  };
  var initReport = (initial) => {
    state = initial;
    const dialog = byId("report-dialog");
    document.addEventListener("click", (event) => {
      if (event.target?.closest("#report, #report-from-error")) openReportDialog();
    });
    byId("report-cancel").addEventListener("click", () => dialog.close());
    byId("report-open").addEventListener("click", async () => {
      const open = byId("report-open");
      open.disabled = true;
      try {
        const kind = byId("report-kind").value;
        const urls = byId("report-urls").value;
        const html = byId("report-include-html").checked ? state?.html : void 0;
        if (html && !htmlFitsInAddress(html)) {
          await navigator.clipboard.writeText(clipboardHtml(html));
        }
        const url = issueUrl({
          kind,
          urls,
          error: state?.error,
          probe: kind === "access" ? await probeText() : void 0,
          html,
          diagnostics: byId("report-diagnostics").value,
          browser: describeBrowser(navigator.userAgent),
          version: chrome.runtime.getManifest().version
        });
        await chrome.tabs.create({ url });
        dialog.close();
      } catch (error) {
        byId("report-error").textContent = `Could not open the issue form: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        open.disabled = false;
      }
    });
  };

  // src/viewer/script-consent.ts
  var SHOWN = 20;
  var addList = (container, heading, items) => {
    if (!items.length) return;
    const title = document.createElement("h3");
    title.textContent = heading;
    const list = document.createElement("ul");
    for (const item of items.slice(0, SHOWN)) {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = item;
      li.append(code);
      list.append(li);
    }
    if (items.length > SHOWN) {
      const li = document.createElement("li");
      li.textContent = `\u2026and ${items.length - SHOWN} more`;
      list.append(li);
    }
    container.append(title, list);
  };
  var rawUrl2 = (target, path) => `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/raw/${target.ref.split("/").map(encodeURIComponent).join("/")}/${encodePath(path)}`;
  var confirmScripts = (target) => {
    const dialog = byId("scripts-dialog");
    const { summary } = target;
    const name = `${target.owner}/${target.repo}`;
    byId("scripts-repo").textContent = name;
    byId("scripts-always").textContent = `Always allow ${name}`;
    const list = byId("scripts-list");
    list.replaceChildren();
    addList(list, "Scripts from this repository that will be fetched and run", summary.local.map((path) => rawUrl2(target, path)));
    if (summary.inline) {
      const p = document.createElement("p");
      p.textContent = `${summary.inline} inline script${summary.inline === 1 ? "" : "s"} will run.`;
      list.append(p);
    }
    addList(list, "Scripts hosted elsewhere (blocked: the sandbox does not load them)", summary.remote);
    if (!summary.local.length && !summary.inline) {
      const p = document.createElement("p");
      p.textContent = "No script files or inline scripts were found in this file.";
      list.append(p);
    }
    return new Promise((resolve2) => {
      let choice = "cancel";
      const pick = (value) => () => {
        choice = value;
        dialog.close();
      };
      const once = byId("scripts-once"), always = byId("scripts-always"), cancel = byId("scripts-cancel");
      const onOnce = pick("once"), onAlways = pick("always"), onCancel = pick("cancel");
      once.addEventListener("click", onOnce);
      always.addEventListener("click", onAlways);
      cancel.addEventListener("click", onCancel);
      dialog.addEventListener("close", () => {
        once.removeEventListener("click", onOnce);
        always.removeEventListener("click", onAlways);
        cancel.removeEventListener("click", onCancel);
        resolve2(choice);
      }, { once: true });
      dialog.showModal();
    });
  };

  // src/shared/script-trust.ts
  var KEY = "trustedScriptRepos";
  var VALID = /^[^/\s]+\/[^/\s]+$/;
  var repoKey = (owner, repo) => `${owner}/${repo}`.toLowerCase();
  var save = (repos) => {
    try {
      if (repos.length) localStorage.setItem(KEY, JSON.stringify(repos));
      else localStorage.removeItem(KEY);
      return true;
    } catch {
      return false;
    }
  };
  var listTrusted = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return Array.from(new Set(parsed.filter((item) => typeof item === "string" && VALID.test(item)))).sort();
    } catch {
      return [];
    }
  };
  var isTrusted = (owner, repo) => listTrusted().includes(repoKey(owner, repo));
  var trustRepo = (owner, repo) => save(Array.from(/* @__PURE__ */ new Set([...listTrusted(), repoKey(owner, repo)])).sort());

  // src/viewer/blob.ts
  var SCRIPT_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals";
  var scriptsSupported = () => !!chrome.runtime.getManifest().sandbox;
  var renderStatic = (html) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", STATIC_SANDBOX);
    frame.srcdoc = html;
    return frame;
  };
  var renderScripted = (html) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", SCRIPT_SANDBOX);
    frame.src = chrome.runtime.getURL("sandbox/frame.html");
    frame.addEventListener("load", () => frame.contentWindow?.postMessage({ type: "hp-render", html }, "*"), { once: true });
    return frame;
  };
  var runBlob = async ({ owner, repo, rest, ref: hint }) => {
    byId("blob-controls").hidden = false;
    addReportFact(`branch name given by the page: ${hint ? "yes" : "no"}`);
    const blob = await send({ type: "resolve-blob", owner, repo, rest, ref: hint });
    const { ref, path, text } = blob;
    setReportState({ html: { after: text } });
    addReportFact(`file size: ${text.length} characters`);
    document.title = `${path.split("/").pop()} \xB7 HTML preview`;
    byId("title").textContent = `${owner}/${repo}@${ref} \xB7 ${path}`;
    const github = byId("github-link");
    github.href = `https://github.com/${owner}/${repo}/blob/${ref.split("/").map(encodeURIComponent).join("/")}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const toggle = byId("run-scripts");
    const scriptWarning = byId("script-warning");
    byId("scripts-label").hidden = !scriptsSupported();
    let generation = 0;
    const render = async () => {
      const mine = ++generation;
      const allowScripts = toggle.checked;
      scriptWarning.hidden = !allowScripts;
      byId("script-warning-always").hidden = !(allowScripts && isTrusted(owner, repo));
      byId("status").hidden = false;
      byId("status").textContent = "Loading\u2026";
      byId("status").className = "";
      let scripts;
      if (allowScripts) {
        const doc2 = new DOMParser().parseFromString(text, "text/html");
        scripts = await loadScripts(getScriptPaths(doc2, path), (scriptPath) => fetchText({ owner, repo, ref, path: scriptPath }));
      }
      const prepared = await prepareSide({ owner, repo, ref, path, html: text }, { allowScripts, scripts });
      const doc = prepared.makeDocument();
      rewriteUrls(doc, prepared.ctx);
      const html = serializeDocument(doc);
      if (mine !== generation) return;
      const frame = allowScripts ? renderScripted(html) : renderStatic(html);
      byId("stage").querySelectorAll("iframe").forEach((old) => old.remove());
      byId("stage").append(frame);
      byId("status").hidden = true;
    };
    toggle.addEventListener("change", async () => {
      if (toggle.checked && !isTrusted(owner, repo)) {
        const choice = await confirmScripts({ owner, repo, ref, summary: describeScripts(new DOMParser().parseFromString(text, "text/html"), path) });
        if (choice === "cancel") {
          toggle.checked = false;
          return;
        }
        if (choice === "always" && !trustRepo(owner, repo)) showNotice("This browser would not save the choice, so scripts will ask again next time.");
      }
      render().catch(showError);
    });
    await render();
  };

  // src/viewer/view-mode.ts
  var KEY2 = "viewMode";
  var loadViewMode = () => {
    try {
      return localStorage.getItem(KEY2) === "split" ? "split" : "inline";
    } catch {
      return "inline";
    }
  };
  var saveViewMode = (mode) => {
    try {
      localStorage.setItem(KEY2, mode);
    } catch {
    }
  };

  // src/core/html-diff.ts
  var MAX_DP_CELLS = 4e6;
  var MAX_BUBBLE_CSS_BYTES = 6e4;
  var LEAF_TAGS = /* @__PURE__ */ new Set(["STYLE", "TEXTAREA", "SCRIPT", "TITLE", "OPTION"]);
  var PRESERVE_WHITESPACE = "pre, textarea, listing, plaintext";
  var INLINE_TAGS = /* @__PURE__ */ new Set(["A", "ABBR", "B", "BDI", "BDO", "BIG", "BR", "BUTTON", "CITE", "CODE", "DATA", "DEL", "DFN", "EM", "FONT", "I", "IMG", "INPUT", "INS", "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SELECT", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "SVG", "TEXTAREA", "TIME", "TT", "U", "VAR", "WBR"]);
  var TABLE_SECTIONS = /* @__PURE__ */ new Set(["TABLE", "THEAD", "TBODY", "TFOOT"]);
  var NO_CUSTOM_CHILDREN = /* @__PURE__ */ new Set(["SELECT", "OPTGROUP", "DATALIST", "COLGROUP"]);
  var MARK_CSS = `
[data-hp-added]{outline:2px solid #1a7f37!important;outline-offset:-2px;background-image:linear-gradient(rgba(46,160,67,.22),rgba(46,160,67,.22))!important}
[data-hp-removed]{outline:2px solid #cf222e!important;outline-offset:-2px;background-image:linear-gradient(rgba(248,81,73,.22),rgba(248,81,73,.22))!important}
[data-hp-modified]{outline:2px dashed #bf8700!important;outline-offset:-2px}
[data-hp-text][data-hp-added]{outline:none!important;background-image:none!important;background-color:rgba(46,160,67,.30)!important}
[data-hp-text][data-hp-removed]{outline:none!important;background-image:none!important;background-color:rgba(248,81,73,.30)!important;text-decoration:line-through}
[data-hp-focus]{animation:hp-pulse 1.2s ease-out}
@keyframes hp-pulse{0%{box-shadow:0 0 0 0 rgba(9,105,218,.8)}100%{box-shadow:0 0 0 14px rgba(9,105,218,0)}}
hp-del{display:inline-block;vertical-align:middle;margin:0 2px}
`;
  var BUBBLE_CSS = `
:host{display:inline-block;vertical-align:middle;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328}
summary{list-style:none;cursor:pointer;display:inline-block;width:18px;height:18px;border-radius:50%;background:#cf222e;color:#fff;text-align:center;line-height:18px;font-weight:700;user-select:none;box-shadow:0 0 0 2px #fff}
summary::-webkit-details-marker{display:none}
details[open]>summary{background:#82071e}
/* host stays static so left/right resolve against the page (not the bubble) and the popover never overflows the right edge; top:auto keeps it under the bubble */
.pop{position:absolute;z-index:2147483647;left:12px;right:12px;max-width:640px;max-height:60vh;margin-top:6px;overflow:auto;background:#fff;border:1px solid #cf222e;border-radius:8px;box-shadow:0 8px 24px rgba(140,149,159,.4)}
.head{padding:6px 10px;background:#ffebe9;color:#82071e;font-weight:600;border-bottom:1px solid #ffcecb}
.render{padding:8px 10px;background:#fff5f5;color:initial;overflow:auto}
.src{border-top:1px solid #ffcecb}
.src>summary{all:unset;display:block;cursor:pointer;padding:6px 10px;color:#57606a}
pre{margin:0;padding:8px 10px;overflow:auto;background:#f6f8fa;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
/* touch or a phone-sized screen: a 44px hit area around the same 18px bubble (padding offset by a negative margin, so layout does not move) */
@media (pointer:coarse),(max-width:720px){
summary{box-sizing:content-box;padding:13px;margin:-13px;background-clip:content-box;box-shadow:none}
.src>summary{display:flex;align-items:center;min-height:44px;box-sizing:border-box}
}
`;
  var sigCache = /* @__PURE__ */ new WeakMap();
  var isPreserved = (node) => !!node.parentElement?.closest(PRESERVE_WHITESPACE);
  var isInlineNode = (node) => {
    return !!node && (node.nodeType === 3 || node.nodeType === 1 && INLINE_TAGS.has(node.tagName.toUpperCase()));
  };
  var isMeaningful = (node) => {
    if (node.nodeType === 1) return true;
    if (node.nodeType !== 3) return false;
    if ((node.textContent || "").trim() !== "") return true;
    return isPreserved(node) || isInlineNode(node.previousSibling) && isInlineNode(node.nextSibling);
  };
  var textSignature = (node) => {
    const text = node.textContent || "";
    if (isPreserved(node)) return "#" + text;
    let collapsed = text.replace(/\s+/g, " ");
    const parent = node.parentElement;
    if (parent && !INLINE_TAGS.has(parent.tagName.toUpperCase())) {
      if (!node.previousSibling) collapsed = collapsed.replace(/^ /, "");
      if (!node.nextSibling) collapsed = collapsed.replace(/ $/, "");
    }
    return "#" + collapsed;
  };
  var meaningfulChildren = (parent) => Array.from(parent.childNodes).filter(isMeaningful);
  var sig = (node) => {
    let value = sigCache.get(node);
    if (value === void 0) {
      value = node.nodeType === 1 ? node.outerHTML : textSignature(node);
      sigCache.set(node, value);
    }
    return value;
  };
  var looseKey = (node) => {
    if (node.nodeType !== 1) return "#text";
    const el = node;
    return el.tagName + (el.id ? "#" + el.id : "");
  };
  var attributeSignature = (el) => {
    return Array.from(el.attributes).filter((attr) => attr.name.indexOf("data-hp-") !== 0).map((attr) => `${attr.name}=${attr.value}`).sort().join("\n");
  };
  var align = (a, b) => {
    const ops = [];
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
      ops.push({ t: "m", i: start, j: start });
      start++;
    }
    let endA = a.length, endB = b.length;
    const tail = [];
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
      tail.push({ t: "m", i: endA, j: endB });
    }
    tail.reverse();
    const n = endA - start, m = endB - start;
    if (n === 0 || m === 0 || n * m > MAX_DP_CELLS) {
      for (let i = start; i < endA; i++) ops.push({ t: "d", i, j: -1 });
      for (let j = start; j < endB; j++) ops.push({ t: "a", i: -1, j });
    } else {
      const width = m + 1;
      const lcs = new Uint32Array((n + 1) * width);
      for (let i2 = 1; i2 <= n; i2++) {
        for (let j2 = 1; j2 <= m; j2++) {
          lcs[i2 * width + j2] = a[start + i2 - 1] === b[start + j2 - 1] ? lcs[(i2 - 1) * width + j2 - 1] + 1 : Math.max(lcs[(i2 - 1) * width + j2], lcs[i2 * width + j2 - 1]);
        }
      }
      const reversed = [];
      let i = n, j = m;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[start + i - 1] === b[start + j - 1]) {
          reversed.push({ t: "m", i: start + i - 1, j: start + j - 1 });
          i--;
          j--;
        } else if (j > 0 && (i === 0 || lcs[i * width + j - 1] >= lcs[(i - 1) * width + j])) {
          reversed.push({ t: "a", i: -1, j: start + j - 1 });
          j--;
        } else {
          reversed.push({ t: "d", i: start + i - 1, j: -1 });
          i--;
        }
      }
      reversed.reverse();
      ops.push(...reversed);
    }
    ops.push(...tail);
    return ops;
  };
  var buildOps = (olds, news) => {
    const out = [];
    let dels = [];
    let adds = [];
    const flush = () => {
      if (!dels.length && !adds.length) return;
      const loose = align(dels.map((i) => looseKey(olds[i])), adds.map((j) => looseKey(news[j])));
      for (const op of loose) {
        const a = op.i >= 0 ? olds[dels[op.i]] : void 0;
        const b = op.j >= 0 ? news[adds[op.j]] : void 0;
        if (op.t === "m" && a.nodeType === 1) {
          out.push({ t: "pair", a, b });
        } else if (op.t === "m") {
          out.push({ t: "del", a });
          out.push({ t: "add", b });
        } else if (op.t === "d") {
          out.push({ t: "del", a });
        } else {
          out.push({ t: "add", b });
        }
      }
      dels = [];
      adds = [];
    };
    for (const op of align(olds.map(sig), news.map(sig))) {
      if (op.t === "m") {
        flush();
        out.push({ t: "same", a: olds[op.i], b: news[op.j] });
      } else if (op.t === "d") {
        dels.push(op.i);
      } else {
        adds.push(op.j);
      }
    }
    flush();
    return out;
  };
  var mark = (node, attribute) => {
    if (node.nodeType === 1) {
      node.setAttribute(attribute, "");
      return node;
    }
    const wrapper = node.ownerDocument.createElement("span");
    wrapper.setAttribute(attribute, "");
    wrapper.setAttribute("data-hp-text", "");
    node.parentNode.replaceChild(wrapper, node);
    wrapper.appendChild(node);
    return wrapper;
  };
  var serialize = (node) => {
    return node.nodeType === 1 ? node.outerHTML : (node.textContent || "").trim();
  };
  var createBubble = (doc, removed, opts) => {
    const host = doc.createElement("hp-del");
    const template = doc.createElement("template");
    template.setAttribute("shadowrootmode", "open");
    const root = template.content;
    const style = doc.createElement("style");
    style.textContent = BUBBLE_CSS;
    root.appendChild(style);
    const details = doc.createElement("details");
    const summary = doc.createElement("summary");
    summary.textContent = "\u2212";
    summary.setAttribute("title", "Removed content - click to view");
    details.appendChild(summary);
    const pop = doc.createElement("div");
    pop.className = "pop";
    const head = doc.createElement("div");
    head.className = "head";
    head.textContent = removed.length === 1 ? "Removed" : `Removed (${removed.length} nodes)`;
    pop.appendChild(head);
    const render = doc.createElement("div");
    render.className = "render";
    const renderRoot = doc.createElement("template");
    renderRoot.setAttribute("shadowrootmode", "open");
    if (opts.pageCss) {
      const pageStyle = doc.createElement("style");
      pageStyle.textContent = opts.pageCss;
      opts.rewriteOld(pageStyle);
      renderRoot.content.appendChild(pageStyle);
    }
    removed.forEach((node) => {
      const copy = node.cloneNode(true);
      opts.rewriteOld(copy);
      renderRoot.content.appendChild(copy);
    });
    render.appendChild(renderRoot);
    pop.appendChild(render);
    const source = doc.createElement("details");
    source.className = "src";
    const sourceSummary = doc.createElement("summary");
    sourceSummary.textContent = "HTML source";
    const pre = doc.createElement("pre");
    pre.textContent = removed.map(serialize).join("\n");
    source.appendChild(sourceSummary);
    source.appendChild(pre);
    pop.appendChild(source);
    details.appendChild(pop);
    root.appendChild(details);
    host.appendChild(template);
    return host;
  };
  var placeBubble = (parent, before, bubble) => {
    const doc = parent.ownerDocument;
    const tag = parent.tagName.toUpperCase();
    const wrapInCell = () => {
      const cell = doc.createElement("td");
      cell.setAttribute("style", "padding:0;border:0");
      cell.appendChild(bubble);
      return cell;
    };
    if (TABLE_SECTIONS.has(tag)) {
      const row = doc.createElement("tr");
      const cell = wrapInCell();
      cell.setAttribute("colspan", "1000");
      row.appendChild(cell);
      parent.insertBefore(row, before);
    } else if (tag === "TR") {
      parent.insertBefore(wrapInCell(), before);
    } else if (NO_CUSTOM_CHILDREN.has(tag)) {
      let target = tag === "COLGROUP" ? parent.closest("table") || parent : parent;
      while (target.parentElement && NO_CUSTOM_CHILDREN.has(target.parentElement.tagName.toUpperCase())) target = target.parentElement;
      target.parentNode.insertBefore(bubble, target);
    } else {
      parent.insertBefore(bubble, before);
    }
  };
  var diffChildren = (oldParent, newParent, opts, stats) => {
    const ops = buildOps(meaningfulChildren(oldParent), meaningfulChildren(newParent));
    for (const op of ops) {
      if (op.t === "pair") {
        const oldEl = op.a, newEl = op.b;
        const leaf = LEAF_TAGS.has(newEl.tagName);
        if (leaf || attributeSignature(oldEl) !== attributeSignature(newEl)) {
          newEl.setAttribute("data-hp-modified", "");
          if (opts.markOld) oldEl.setAttribute("data-hp-modified", "");
          stats.modified++;
        }
        if (!leaf) diffChildren(oldEl, newEl, opts, stats);
      } else if (op.t === "add") {
        op.b = mark(op.b, "data-hp-added");
        stats.added++;
      } else if (op.t === "del") {
        if (opts.markOld) op.a = mark(op.a, "data-hp-removed");
        stats.removed++;
      }
    }
    if (!opts.bubbles) return;
    let run2 = [];
    const flushRun = (before) => {
      if (!run2.length) return;
      placeBubble(newParent, before, createBubble(newParent.ownerDocument, run2, opts));
      run2 = [];
    };
    for (const op of ops) {
      if (op.t === "del") {
        run2.push(op.a);
      } else {
        flushRun(op.b);
      }
    }
    flushRun(null);
  };
  var diffBodies = (oldBody, newBody, opts, stats) => {
    if (attributeSignature(oldBody) !== attributeSignature(newBody)) {
      newBody.setAttribute("data-hp-modified", "");
      if (opts.markOld) oldBody.setAttribute("data-hp-modified", "");
      stats.modified++;
    }
    diffChildren(oldBody, newBody, opts, stats);
  };
  var collectPageCss = (doc) => {
    const css = Array.from(doc.querySelectorAll("style")).map((style) => style.textContent || "").join("\n");
    return css.length > MAX_BUBBLE_CSS_BYTES ? "" : css;
  };
  var finalize = (doc, side, rewrite) => {
    rewrite(doc, side);
    const style = doc.createElement("style");
    style.setAttribute("data-hp-style", "");
    style.textContent = MARK_CSS;
    (doc.head || doc.documentElement).appendChild(style);
    return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
  };
  var buildViews = (make, rewrite) => {
    const stats = { added: 0, removed: 0, modified: 0 };
    const oldDoc = make("before"), newDoc = make("after");
    diffBodies(oldDoc.body, newDoc.body, { markOld: true, bubbles: false, pageCss: "", rewriteOld: () => {
    } }, stats);
    const inlineOld = make("before"), inlineNew = make("after");
    const pageCss = collectPageCss(inlineOld);
    diffBodies(inlineOld.body, inlineNew.body, { markOld: false, bubbles: true, pageCss, rewriteOld: (node) => rewrite(node, "before") }, { added: 0, removed: 0, modified: 0 });
    return {
      before: finalize(oldDoc, "before", rewrite),
      after: finalize(newDoc, "after", rewrite),
      inline: finalize(inlineNew, "after", rewrite),
      stats
    };
  };

  // src/viewer/diff.ts
  var CHANGE_SELECTOR = "[data-hp-added], [data-hp-removed], [data-hp-modified], hp-del";
  var makeFrame = (html) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", STATIC_SANDBOX);
    frame.srcdoc = html;
    return frame;
  };
  var makePane = (title, content) => {
    const pane = document.createElement("section");
    pane.className = "pane";
    const heading = document.createElement("div");
    heading.className = "pane-title";
    heading.textContent = title;
    pane.append(heading, content);
    return pane;
  };
  var placeholder = (text) => {
    const el = document.createElement("div");
    el.className = "placeholder";
    el.textContent = text;
    return el;
  };
  var shortSha = (sha) => sha ? sha.slice(0, 7) : "none";
  var scrollRatioSync = (from, to, ignoreUntil, key, otherKey) => {
    const source = from.contentWindow, target = to.contentWindow;
    source.addEventListener("scroll", () => {
      if (Date.now() < ignoreUntil[key]) return;
      const sourceMax = source.document.documentElement.scrollHeight - source.innerHeight;
      const targetMax = target.document.documentElement.scrollHeight - target.innerHeight;
      if (sourceMax <= 0 || targetMax <= 0) return;
      ignoreUntil[otherKey] = Date.now() + 120;
      target.scrollTo(0, source.scrollY / sourceMax * targetMax);
    });
  };
  var resolve = async ({ owner, repo, path, before, after }) => {
    if (!before || !after || !isSha(before) || !isSha(after)) {
      throw new Error("This page did not say which commits the pull request compares, so there is nothing to preview. Reload the Files changed tab and try again; if it keeps happening GitHub may have changed its page.");
    }
    const change = await send({ type: "pr-file-entry", owner, repo, before, after, path });
    return { before, after, change: change ?? void 0 };
  };
  var runDiff = async (params2) => {
    const { owner, repo, path } = params2;
    byId("diff-controls").hidden = false;
    addReportFact(`commits given by the page: ${params2.before && params2.after ? "yes" : "no"}`);
    const info = await resolve(params2);
    addReportFact(`file status from GitHub's diff: ${info.change ? info.change.status : "not found"}`);
    const beforePath = info.change?.previous || path;
    const wanted = {
      before: info.change?.status !== "added" && !!info.before,
      after: info.change?.status !== "removed"
    };
    const settle = async (want, ref, filePath) => {
      if (!want || !ref) return { html: "" };
      try {
        return { html: await fetchText({ owner, repo, ref, path: filePath }) };
      } catch (error) {
        if (info.change || error.status !== 404) throw error;
        return { html: "", error };
      }
    };
    const [beforeResult, afterResult] = await Promise.all([settle(wanted.before, info.before, beforePath), settle(wanted.after, info.after, path)]);
    if (beforeResult.error && afterResult.error) throw beforeResult.error;
    const hasBefore = wanted.before && !beforeResult.error;
    const hasAfter = wanted.after && !afterResult.error;
    const status = info.change?.status ?? (!hasBefore ? "added" : !hasAfter ? "removed" : "modified");
    const change = info.change ?? { status };
    const [beforeHtml, afterHtml] = [beforeResult.html, afterResult.html];
    setReportState({ html: { before: hasBefore ? beforeHtml : void 0, after: hasAfter ? afterHtml : void 0 } });
    addReportFact(`file sizes: before ${hasBefore ? beforeHtml.length : "none"}, after ${hasAfter ? afterHtml.length : "none"} characters`);
    const [before, after] = await Promise.all([
      prepareSide({ owner, repo, ref: info.before || "", path: beforePath, html: beforeHtml }),
      prepareSide({ owner, repo, ref: info.after, path, html: afterHtml })
    ]);
    const sides2 = { before, after };
    const views = buildViews((side) => sides2[side].makeDocument(), (root, side) => rewriteUrls(root, sides2[side].ctx));
    if (status === "added") showNotice("New file: everything is shown as added.");
    else if (status === "removed") showNotice("File deleted: its previous content is in the red bubble (inline) or left pane (side by side).");
    else if (change.previous) showNotice(`Renamed from ${change.previous}`);
    const { added, removed, modified } = views.stats;
    byId("stats").textContent = added + removed + modified === 0 ? "No visible changes in <body>" : `+${added} added \xB7 \u2212${removed} removed \xB7 ${modified} changed`;
    const inlineFrame = makeFrame(views.inline);
    const beforeFrame = hasBefore ? makeFrame(views.before) : null;
    const afterFrame = hasAfter ? makeFrame(views.after) : null;
    const inlinePane = makePane(`Inline \xB7 ${shortSha(info.after)}`, inlineFrame);
    const beforePane = makePane(`Before \xB7 ${shortSha(info.before)}`, beforeFrame || placeholder("File did not exist"));
    const afterPane = makePane(`After \xB7 ${shortSha(info.after)}`, afterFrame || placeholder("File was deleted"));
    inlinePane.style.flex = "1";
    byId("stage").append(inlinePane, beforePane, afterPane);
    if (beforeFrame && afterFrame) {
      const ignoreUntil = { before: 0, after: 0 };
      beforeFrame.addEventListener("load", () => scrollRatioSync(beforeFrame, afterFrame, ignoreUntil, "before", "after"));
      afterFrame.addEventListener("load", () => scrollRatioSync(afterFrame, beforeFrame, ignoreUntil, "after", "before"));
    }
    let mode = "inline";
    let cursor = -1;
    const applyMode = (next) => {
      mode = next;
      cursor = -1;
      inlinePane.hidden = mode !== "inline";
      beforePane.hidden = afterPane.hidden = mode !== "split";
      byId("mode-inline").classList.toggle("active", mode === "inline");
      byId("mode-split").classList.toggle("active", mode === "split");
      saveViewMode(mode);
    };
    byId("mode-inline").onclick = () => applyMode("inline");
    byId("mode-split").onclick = () => applyMode("split");
    const step = (direction) => {
      const frames = mode === "inline" ? [inlineFrame] : [afterFrame, beforeFrame];
      const targets = [];
      for (const frame of frames) {
        const doc = frame?.contentDocument;
        if (doc) targets.push(...Array.from(doc.querySelectorAll(CHANGE_SELECTOR)));
      }
      if (!targets.length) return;
      cursor = (cursor + direction + targets.length) % targets.length;
      const target = targets[cursor];
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.removeAttribute("data-hp-focus");
      void target.offsetWidth;
      target.setAttribute("data-hp-focus", "");
    };
    byId("prev").onclick = () => step(-1);
    byId("next").onclick = () => step(1);
    applyMode(loadViewMode());
    byId("status").hidden = true;
  };

  // src/viewer/index.ts
  var params = new URLSearchParams(location.hash.replace(/^#/, ""));
  var theme = params.get("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.body.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  var required = (name) => {
    const value = params.get(name);
    if (!value) throw new Error(`Missing "${name}" in the preview address.`);
    return value;
  };
  var sourcePage = () => {
    const owner = params.get("owner"), repo = params.get("repo");
    if (!owner || !repo) return { pageUrl: "" };
    if (params.get("kind") === "blob") {
      const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodePath(params.get("rest") ?? "")}`;
      return { pageUrl: url, probeUrl: url };
    }
    const range = params.get("range");
    const page = `https://github.com/${owner}/${repo}/pull/${params.get("pr") ?? ""}/changes${range ? `/${range}` : ""}`;
    const after = params.get("after"), path = params.get("path");
    return {
      pageUrl: `${page}
(file: ${path ?? ""})`,
      probeUrl: after && path ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(after)}/${encodePath(path)}` : void 0
    };
  };
  var run = async () => {
    if (params.get("kind") === "pr") {
      await runDiff({ owner: required("owner"), repo: required("repo"), pr: Number(required("pr")), path: required("path"), range: params.get("range") || void 0, before: params.get("before") || void 0, after: params.get("after") || void 0 });
    } else if (params.get("kind") === "blob") {
      await runBlob({ owner: required("owner"), repo: required("repo"), rest: required("rest"), ref: params.get("ref") || void 0 });
    } else {
      throw new Error("This page previews HTML files from GitHub. Open a .html file on github.com and click Preview.");
    }
  };
  initReport({ ...sourcePage(), diagnostics: (params.get("diag") ?? "").slice(0, 900), facts: [`preview: ${params.get("kind") ?? "none"}`] });
  byId("status").textContent = "Loading\u2026";
  run().catch(showError);
})();
