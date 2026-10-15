import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Menu } from "./Menu";

const meta = {
  title: "Components/Menu",
  component: Menu,
  args: {
    trigger: <Button variant="secondary">Maya R.</Button>,
    entries: [
      { kind: "item", label: "Rename", onSelect: () => {} },
      { kind: "item", label: "Split into two students", onSelect: () => {} },
      { kind: "item", label: "Retry failed grades", onSelect: () => {}, disabled: true },
      { kind: "separator" },
      { kind: "item", label: "Remove from session", onSelect: () => {}, tone: "danger" },
    ],
  },
  decorators: [(Story) => <div style={{ minHeight: 260 }}>{Story()}</div>],
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Opened by the play function so the screenshot shows the popup. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector("button")?.click();
  },
};
