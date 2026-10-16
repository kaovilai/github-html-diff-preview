"use strict";
(() => {
  // src/sandbox/frame.ts
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== "hp-render" || typeof data.html !== "string") return;
    document.open();
    document.write(data.html);
    document.close();
  }, { once: true });
})();
