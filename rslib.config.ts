import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    entry: {
      index: "src/index.ts",
    },
  },
  lib: [
    {
      format: "cjs",
      output: {
        distPath: {
          root: "dist",
        },
      },
    },
  ],
});
