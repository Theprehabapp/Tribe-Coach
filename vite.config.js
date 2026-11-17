import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// `--mode fake` swaps Supabase for an in-memory stand-in so the UI can be smoke-tested offline.
export default defineConfig(({ mode }) => ({
  // Two pages: the app (index.html) and the public sign-up page (join.html, served at /join).
  build: { rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), join: fileURLToPath(new URL("./join.html", import.meta.url)) } } },
  plugins: mode === "fake" ? [{
    name: "fake-api",
    enforce: "pre",
    resolveId(src, importer) {
      if (src === "./api.js" && /src\/(main|upload|notify|join)\.js$/.test(importer || "")) return fileURLToPath(new URL("./test/fake/api.js", import.meta.url));
    },
  }] : [],
}));
