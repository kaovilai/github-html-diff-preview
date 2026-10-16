"use strict";
(() => {
  // src/shared/messages.ts
  var send = async (request) => {
    const response = await chrome.runtime.sendMessage(request);
    if (!response) throw new Error("No response from the extension background worker.");
    if (!response.ok) throw Object.assign(new Error(response.error), { status: response.status });
    return response.data;
  };

  // src/shared/script-trust.ts
  var KEY = "trustedScriptRepos";
  var VALID = /^[^/\s]+\/[^/\s]+$/;
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
  var untrustRepo = (key) => save(listTrusted().filter((item) => item !== key.toLowerCase()));
  var untrustAll = () => save([]);

  // src/options/index.ts
  var byId = (id) => document.getElementById(id);
  byId("probe").addEventListener("click", async () => {
    const out = byId("probe-result");
    out.hidden = false;
    out.textContent = "Testing\u2026";
    try {
      const result = await send({ type: "probe", url: byId("probe-url").value.trim() });
      out.textContent = [`ref: ${result.ref}`, `path: ${result.path}`, ...result.outcomes.map((o) => `${o.ok ? "OK  " : "FAIL"} ${o.strategy.padEnd(9)} ${o.detail}`)].join("\n");
    } catch (error) {
      out.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  var renderTrusted = () => {
    const repos = listTrusted();
    byId("trusted-empty").hidden = repos.length > 0;
    byId("trusted-clear").hidden = repos.length === 0;
    byId("trusted-list").replaceChildren(...repos.map((key) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `https://github.com/${key}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const code = document.createElement("code");
      code.textContent = key;
      link.append(code);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${key} from the list`);
      remove.addEventListener("click", () => {
        untrustRepo(key);
        renderTrusted();
      });
      item.append(link, remove);
      return item;
    }));
  };
  byId("trusted-clear").addEventListener("click", () => {
    untrustAll();
    renderTrusted();
  });
  window.addEventListener("storage", renderTrusted);
  renderTrusted();
})();
