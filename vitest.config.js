import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live under source/; dist/ is a build copy and must not be picked up
    // or integration tests that seed D1 will run twice and race on the DB.
    include: ["source/**/*.test.js"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
