// Runs inside the manifest sandbox page (opaque origin, scripts allowed). The viewer posts the prepared document here.
window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string; html?: unknown } | null;
    if (!data || data.type !== "hp-render" || typeof data.html !== "string") return;
    document.open();
    document.write(data.html);
    document.close();
}, { once: true });
