import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "eslint-config-next/core-web-vitals";

/**
 * Lint config for the workspace.
 *
 * Type-aware rules are deliberately not enabled: `npm run typecheck` already
 * runs the compiler over every package, so turning them on here would double
 * the cost of CI to re-derive what tsc has just proven.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      // The original calling agent, kept runnable until the new stack places a
      // real call. It is frozen, so lint findings against it are not actionable.
      "legacy/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Build and tooling config files run in Node, not the browser or a bundle.
  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.config.js"],
    languageOptions: { globals: globals.node },
  },

  // Next's rules cover the app router and its own APIs, so they are scoped to
  // the app rather than applied to the packages, where they never match.
  ...nextPlugin.map((config) => ({ ...config, files: ["apps/web/**/*.{ts,tsx}"] })),

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // An unused parameter is often a signature being honoured rather than a
      // mistake; a leading underscore is how the code says so.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  {
    // Tests reach for non-null assertions on fixtures they just created, where
    // the alternative is a guard that can never fire.
    files: ["**/*.test.ts", "**/*.integration.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
