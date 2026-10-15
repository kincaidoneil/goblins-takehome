/**
 * ESM stand-in for `use-sync-external-store/shim`. React 19 has `useSyncExternalStore` built in.
 * The CommonJS shim's `require("react")` survives the server bundle and fails on Vercel, where
 * the function ships without node_modules. Aliased in vite.config.ts.
 */
export { useSyncExternalStore } from "react";
