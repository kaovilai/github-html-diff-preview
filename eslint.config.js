import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**", "store/generated/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["scripts/**/*.mjs", "*.config.{js,ts}"],
        languageOptions: { globals: { process: "readonly", console: "readonly" } }
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
            "no-empty": ["error", { allowEmptyCatch: true }]
        }
    }
);
