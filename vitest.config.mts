import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the Next.js server bundle; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    globals: false,
    // Tests that issue several documents render a PDF each; give slow machines room.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/finance/**/*.ts", "src/lib/pdf/**/*.ts", "src/lib/auth/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts"],
      thresholds: {
        "src/lib/finance/**": { lines: 90, functions: 90, statements: 90, branches: 80 },
      },
    },
  },
});
