import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const shim = (file: string) => fileURLToPath(new URL(`./src/shims/${file}`, import.meta.url));

export default defineConfig({
  envDir: "../..",
  resolve: {
    alias: [
      // Base UI's CommonJS dependency keeps a runtime require("react") in the server bundle,
      // which fails on Vercel. ESM stand-ins backed by React 19's own hook.
      {
        find: /^use-sync-external-store\/shim\/with-selector(\.js)?$/,
        replacement: shim("use-sync-external-store-with-selector.ts"),
      },
      {
        find: /^use-sync-external-store\/shim(\/index\.js)?$/,
        replacement: shim("use-sync-external-store-shim.ts"),
      },
    ],
  },
  plugins: [nitro(), tailwindcss(), tanstackStart(), viteReact()],
});
