import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "test/e2e",
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: process.env.CI ? [["github"], ["list"]] : "list",
    use: { trace: "retain-on-failure" },
    projects: [
        { name: "e2e", testIgnore: /a11y\.spec\.ts/ },
        { name: "a11y", testMatch: /a11y\.spec\.ts/ }
    ]
});
