import { defineConfig } from "vitest/config";

// Every test file boots a Colyseus server on @colyseus/testing's fixed port, so files cannot run in parallel.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
