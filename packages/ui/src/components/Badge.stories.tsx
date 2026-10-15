import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const tones = ["neutral", "brand", "accent", "success", "warning", "info", "danger"] as const;

const meta = {
  title: "Components/Badge",
  component: Badge,
  args: { children: "Live" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllTones: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {tones.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {tones.map((tone) => (
          <Badge key={tone} tone={tone} appearance="outline">
            {tone}
          </Badge>
        ))}
      </div>
    </div>
  ),
};
