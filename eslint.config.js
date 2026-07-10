import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const nodeSourceFiles = [
  "*.config.{js,mjs,cjs,ts}",
  "eslint.config.js",
  "vitest.setup.ts",
  "apps/api/src/**/*.ts",
  "packages/**/*.{js,mjs,cjs,ts,tsx}",
  "plugins/**/scripts/**/*.{js,mjs,cjs,ts}",
  "plugins/openclaw/server/**/*.js",
  "scripts/**/*.{js,mjs,cjs,ts}",
  "tests/**/*.{js,mjs,cjs,ts,tsx}"
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/target/**",
      "**/coverage/**",
      "**/*.min.js",
      "plugins/**/build/**",
      "plugins/**/runtime/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: nodeSourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node
    }
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: [
      "plugins/openclaw/docs/**/*.js",
      "scripts/docs/capture-web-docs-screenshots.mjs"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        SwaggerUIBundle: "readonly"
      }
    }
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      // Forge keeps testable flow/model exports beside components. Vite safely
      // falls back to a module reload for these intentionally mixed modules.
      "react-refresh/only-export-components": "off"
    }
  }
);
