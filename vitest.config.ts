import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "legacy/**"],
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests share one database; running files in parallel would let
    // one suite's cleanup delete another's fixtures mid-assertion.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // Weighted at the places where a bug damages a customer's sending
      // reputation or a prospect's experience — not uniform across the repo.
      include: ["packages/guardrails/**", "packages/orchestrator/**", "packages/shared/**"],
    },
  },
});
