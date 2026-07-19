import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        inspector: resolve(__dirname, "inspect.html"),
        validation: resolve(__dirname, "validate.html"),
        viewer: resolve(__dirname, "viewer.html"),
      },
    },
  },
});
