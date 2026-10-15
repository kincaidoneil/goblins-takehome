import type { Preview } from "@storybook/react-vite";
import { ToastProvider } from "../src/components/Toast";
import { TooltipProvider } from "../src/components/Tooltip";
import "../src/tokens.css";
import "../src/base.css";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
};

export default preview;
