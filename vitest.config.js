import { defineConfig } from "vitest/config";

// The build step copies `source/` → `dist/`, which means every test
// file ends up duplicated and vitest's default include picks up both
// copies. Two concurrent copies of dashboard.test.js racing for the
// local D1 produces SQLITE_BUSY flake — exclude dist/ so only the
// canonical source/ tests run.
export default defineConfig({
  test: {
    include: ["source/**/*.test.{js,ts}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
