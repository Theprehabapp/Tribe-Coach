import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// `--mode fake` swaps Supabase for an in-memory stand-in so the UI can be smoke-tested offline.
export default defineConfig(({ mode }) => ({
  plugins: mode === "fake" ? [{
    name: "fake-api",
    enforce: "pre",
    resolveId(src, importer) {
      if (src === "./api.js" && /src\/(main|upload)\.js$/.test(importer || "")) return fileURLToPath(new URL("./test/fake/api.js", import.meta.url));
    },
  }] : [],
}));
