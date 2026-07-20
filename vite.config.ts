import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "include-validation-report",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "fixtures/validation/report.json",
        source: readFileSync(resolve(__dirname, "fixtures/validation/report.json")),
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        inspector: resolve(__dirname, "inspect.html"),
        comparison: resolve(__dirname, "compare.html"),
        validation: resolve(__dirname, "validate.html"),
        viewer: resolve(__dirname, "viewer.html"),
      },
    },
  },
});
