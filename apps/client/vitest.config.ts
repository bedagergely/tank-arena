import { defineConfig } from "vitest/config";

// Pure-logic tests only — the React components are exercised through the app
// itself, so the React/Tailwind plugins are not needed here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
