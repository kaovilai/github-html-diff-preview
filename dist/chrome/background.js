"use strict";
(() => {
  // src/core/diff-entry.ts
  var MAX_DIFF_BYTES = 32 * 1024 * 1024;
  var HEADER = "diff --git ";
  var findDiffEntry = async (body, path, maxBytes = MAX_DIFF_BYTES) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let total = 0;
    let entry = null;
    let confirmed = false;
    const reset = () => {
      entry = null;
      confirmed = false;
    };
    const handle2 = (line) => {
      if (line.startsWith(HEADER)) {
        if (entry && confirmed) return true;
        reset();
        if (line === `${HEADER}a/${path} b/${path}`) {
          entry = { status: "modified" };
          confirmed = true;
        } else if (line.startsWith(`${HEADER}a/`) && line.endsWith(` b/${path}`)) {
          entry = { status: "modified" };
        }
        return false;
      }
      if (!entry) return false;
      if (line.startsWith("@@") || line.startsWith("--- ") || line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
        if (confirmed) return true;
        reset();
        return false;
      }
      if (line.startsWith("new file mode")) entry.status = "added";
      else if (line.startsWith("deleted file mode")) entry.status = "removed";
      else if (line.startsWith("rename from ")) {
        entry.status = "renamed";
        entry.previous = line.slice("rename from ".length);
      } else if (line === `rename to ${path}`) {
        confirmed = true;
      }
      return false;
    };
    const result = () => confirmed ? entry : null;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (handle2(line)) return result();
        }
        if (total > maxBytes) return result();
      }
      if (pending) handle2(pending);
      return result();
    } finally {
      await reader.cancel().catch(() => void 0);
    }
  };

  // src/core/github-urls.ts
  var HTML_FILE = /\.html?$/i;
  var NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
  var SHA = /^[0-9a-f]{7,40}$/i;
  var REF = /^(?!\/)(?!.*(?:\/\/|\.\.|\/$|@\{|\\))[\w.\-/+@~^#%]+$/;
  var isValidName = (value) => NAME.test(value);
  var isSha = (value) => SHA.test(value);
  var isValidRef = (value) => value.length <= 255 && REF.test(value);
  var assertValid = (ok, what) => {
    if (!ok) throw new Error(`Invalid ${what}.`);
  };
  var assertRepo = (owner, repo) => {
    assertValid(isValidName(owner) && isValidName(repo), "repository");
  };
  var assertRef = (ref) => assertValid(isValidRef(ref), "ref");
  var assertRepoPath = (path) => {
    assertValid(path.length > 0 && path.length <= 1024 && path.split("/").every((s) => s !== "" && s !== "." && s !== ".."), "file path");
  };
  var encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
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
  var refCandidates = (rest, max = 5, hint) => {
    if (hint && rest.startsWith(hint + "/") && rest.length > hint.length + 1) {
      return [{ ref: hint, path: rest.slice(hint.length + 1) }];
    }
    const segments = rest.split("/");
    const out = [];
    for (let i = 1; i < segments.length && out.length < max; i++) {
      out.push({ ref: segments.slice(0, i).join("/"), path: segments.slice(i).join("/") });
    }
    return out;
  };

  // src/core/fetcher.ts
  var FetchError = class extends Error {
    constructor(message, status, retryable = false) {
      super(message);
      this.status = status;
      this.retryable = retryable;
    }
    status;
    retryable;
  };
  var GITHUB = "https://github.com";
  var SESSION_HOSTS = /* @__PURE__ */ new Set(["github.com", "raw.githubusercontent.com", "media.githubusercontent.com"]);
  var DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
  var DEFAULT_BACKOFF_MS = 6e4;
  var isSessionRedirect = (finalUrl) => !SESSION_HOSTS.has(finalUrl.hostname) || finalUrl.pathname === "/login" || finalUrl.pathname.startsWith("/session");
  var readLimited = async (response, maxBytes) => {
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
    if (!response.body) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchError(`File is larger than the ${Math.round(maxBytes / 1024)} KiB limit.`, 413);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  var FileFetcher = class {
    constructor(deps) {
      this.deps = deps;
    }
    deps;
    // earliest time github.com may be contacted again after it told us to back off
    blockedUntil = 0;
    checkBackoff() {
      const now = this.deps.now();
      if (now < this.blockedUntil) {
        throw new FetchError(`GitHub asked for a pause; retry in ${Math.ceil((this.blockedUntil - now) / 1e3)}s.`, 429);
      }
    }
    // Only throttling responses pause us; an unrelated error that happens to carry Retry-After must not block everything.
    noteRateLimit(response) {
      if (![403, 429, 503].includes(response.status)) return;
      const retryAfter = Number(response.headers.get("retry-after"));
      if (retryAfter > 0) this.blockedUntil = this.deps.now() + retryAfter * 1e3;
      else if (response.status === 429) this.blockedUntil = this.deps.now() + DEFAULT_BACKOFF_MS;
    }
    async request(file, maxBytes) {
      this.checkBackoff();
      const url = `${GITHUB}/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/raw/${encodePath(file.ref)}/${encodePath(file.path)}`;
      const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });
      const finalUrl = new URL(response.url || url);
      if (isSessionRedirect(finalUrl)) throw new FetchError("Not signed in to GitHub in this browser.", 401);
      if (!response.ok) {
        this.noteRateLimit(response);
        throw new FetchError(`HTTP ${response.status}`, response.status);
      }
      if ((response.headers.get("content-type") || "").startsWith("text/html") && finalUrl.hostname === "github.com") {
        throw new FetchError("GitHub returned a web page instead of the file.", 404);
      }
      return readLimited(response, maxBytes);
    }
    // Status of one file in the diff between two commits, from github.com's own `.diff` view (browser login, no API).
    // Resolves to null whenever it cannot tell; the caller then infers the status from which side has the file.
    async fetchDiffEntry(owner, repo, before, after, path) {
      assertRepo(owner, repo);
      assertValid(isSha(before) && isSha(after), "commit");
      assertRepoPath(path);
      try {
        this.checkBackoff();
        const url = `${GITHUB}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${before}..${after}.diff`;
        const response = await this.deps.fetch(url, { credentials: "include", redirect: "follow" });
        const finalUrl = new URL(response.url || url);
        if (!response.ok) {
          this.noteRateLimit(response);
          return null;
        }
        if (isSessionRedirect(finalUrl) || finalUrl.hostname !== "github.com" || !response.body) return null;
        return await findDiffEntry(response.body, path);
      } catch {
        return null;
      }
    }
    async fetchBytes(file, maxBytes = DEFAULT_MAX_BYTES) {
      assertRepo(file.owner, file.repo);
      assertRef(file.ref);
      assertRepoPath(file.path);
      try {
        return await this.request(file, maxBytes);
      } catch (error) {
        if (!(error instanceof FetchError) || error.status === 413) throw error;
        throw new FetchError(this.describe(error), error.status);
      }
    }
    async fetchText(file, maxBytes = DEFAULT_MAX_BYTES) {
      return new TextDecoder("utf-8").decode(await this.fetchBytes(file, maxBytes));
    }
    describe(error) {
      if (error.status === 401) return "Not signed in to GitHub in this browser. Sign in at github.com and try again.";
      if (error.status === 404) return "File not found. If the repository is private, sign in to github.com in this browser first.";
      if (error.status === 429 || error.status === 403) return `GitHub refused the request (rate limit or missing access). ${error.message}`;
      return `Could not fetch the file from GitHub. ${error.message}`;
    }
    // Diagnostics for the options page and issue reports: does the browser's GitHub login reach this file?
    async probe(file) {
      assertRepo(file.owner, file.repo);
      assertRef(file.ref);
      assertRepoPath(file.path);
      try {
        const bytes = await this.request(file, DEFAULT_MAX_BYTES);
        return [{ strategy: "session", ok: true, detail: `${bytes.length} bytes` }];
      } catch (error) {
        return [{ strategy: "session", ok: false, detail: error instanceof Error ? error.message : String(error) }];
      }
    }
  };

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
  var toDataUrl = (mime, bytes) => {
    let binary = "";
    const chunk = 32768;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  };

  // src/shared/viewer-url.ts
  var viewerHash = (params) => {
    const entries = Object.entries(params).filter((entry) => typeof entry[1] === "string");
    return new URLSearchParams(entries).toString();
  };
  var viewerUrl = (params) => `${chrome.runtime.getURL("viewer/viewer.html")}#${viewerHash(params)}`;

  // src/background/index.ts
  var fetcher = new FileFetcher({ fetch: (input, init) => fetch(input, init), now: Date.now });
  var MENU_PAGE = "preview-page";
  var MENU_LINK = "preview-link";
  var isOwnPage = (sender) => {
    const url = sender.url ?? "";
    return sender.id === chrome.runtime.id && (url.startsWith(chrome.runtime.getURL("viewer/viewer.html")) || url.startsWith(chrome.runtime.getURL("options/options.html")));
  };
  var resolveBlob = async (owner, repo, rest, hint) => {
    assertRepo(owner, repo);
    const candidates = refCandidates(rest, 5, hint);
    let lastError = new Error("Invalid file location.");
    for (const { ref, path } of candidates) {
      try {
        return { ref, path, text: await fetcher.fetchText({ owner, repo, ref, path }) };
      } catch (error) {
        lastError = error;
        if (!(error instanceof FetchError) || error.status !== 404 && error.status !== 401) throw error;
      }
    }
    throw lastError;
  };
  var fetchAsset = async (file) => {
    const mime = assetMime(file.path);
    if (!mime) return void 0;
    return toDataUrl(mime, await fetcher.fetchBytes(file, DEFAULT_BUDGET.maxBytesEach));
  };
  var probe = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") throw new Error("Not a github.com URL.");
    let pathname;
    try {
      pathname = decodeURIComponent(parsed.pathname);
    } catch {
      throw new Error("That address contains an invalid percent-escape.");
    }
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(pathname);
    if (!match) throw new Error("Expected a github.com/<owner>/<repo>/blob/<ref>/<path> URL.");
    const [, owner, repo, rest] = match;
    let first;
    for (const { ref, path } of refCandidates(rest)) {
      const outcomes = await fetcher.probe({ owner, repo, ref, path });
      first ??= { ref, path, outcomes };
      if (outcomes.some((outcome) => outcome.ok)) return { ref, path, outcomes };
    }
    if (!first) throw new Error("Expected a github.com/<owner>/<repo>/blob/<ref>/<path> URL.");
    return first;
  };
  var handle = async (request, sender) => {
    if (request.type === "open-preview") {
      if (!sender.tab?.url?.startsWith("https://github.com/")) throw new Error("Request not allowed from this context.");
      assertRepo(request.owner, request.repo);
      await chrome.tabs.create({ url: viewerUrl({ kind: "blob", owner: request.owner, repo: request.repo, rest: request.rest, ref: request.ref }), index: sender.tab.index + 1, openerTabId: sender.tab.id });
      return null;
    }
    if (!isOwnPage(sender)) throw new Error("Request not allowed from this context.");
    switch (request.type) {
      case "resolve-blob":
        return resolveBlob(request.owner, request.repo, request.rest, request.ref);
      case "file-text":
        return fetcher.fetchText(request);
      case "asset":
        assertRepo(request.owner, request.repo);
        assertRef(request.ref);
        assertRepoPath(request.path);
        return fetchAsset(request);
      case "pr-file-entry":
        return fetcher.fetchDiffEntry(request.owner, request.repo, request.before, request.after, request.path);
      case "probe":
        return probe(request.url);
      default:
        throw new Error("Unknown request.");
    }
  };
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handle(request, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), status: error instanceof FetchError ? error.status : void 0 })
    );
    return true;
  });
  var openBlob = async (url, tab) => {
    if (!url) return;
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return;
    const blob = parseBlobPath(parsed.pathname);
    if (!blob) return;
    let ref;
    if (tab?.id !== void 0 && tab.url === url) {
      ref = await chrome.tabs.sendMessage(tab.id, { type: "get-ref", rest: blob.rest }).then((reply) => reply?.ref, () => void 0);
    }
    await chrome.tabs.create({ url: viewerUrl({ kind: "blob", ...blob, ref }), index: tab ? tab.index + 1 : void 0, openerTabId: tab?.id });
  };
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_PAGE, title: "Preview HTML file", contexts: ["page"], documentUrlPatterns: ["https://github.com/*.html", "https://github.com/*.htm"] });
      chrome.contextMenus.create({ id: MENU_LINK, title: "Preview HTML file", contexts: ["link"], targetUrlPatterns: ["https://github.com/*/blob/*.html", "https://github.com/*/blob/*.htm"] });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void openBlob(info.menuItemId === MENU_LINK ? info.linkUrl : info.pageUrl, tab);
  });
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "preview") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await openBlob(tab?.url, tab);
  });
  chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage();
  });
})();
