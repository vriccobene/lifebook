import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.sqlite*", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // lifebook-core must stay pure: no I/O libraries and no dependency on apps.
    files: ["packages/lifebook-core/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "fs/*", "path", "http", "https", "net", "child_process"],
              message: "lifebook-core must not perform I/O.",
            },
            {
              group: [
                "@lifebook/api",
                "@lifebook/web",
                "fastify*",
                "better-sqlite3",
                "drizzle-orm*",
                "react*",
              ],
              message: "lifebook-core must not depend on apps or I/O libraries.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "process", "window", "document"],
    },
  },
);
