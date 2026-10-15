import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

/** The monorepo root, so stories can import other workspace packages' source. */
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({
    ...vite,
    server: {
      ...vite.server,
      fs: { ...vite.server?.fs, allow: [...(vite.server?.fs?.allow ?? []), workspaceRoot] },
    },
  }),
};

export default config;
