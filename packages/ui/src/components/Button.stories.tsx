import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Upload a worksheet" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Brand: Story = { args: { variant: "brand", children: "Launch" } };
export const Secondary: Story = { args: { variant: "secondary", children: "Try a template" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Cancel" } };
export const Danger: Story = { args: { variant: "danger", children: "Remove student" } };
export const Disabled: Story = { args: { disabled: true, children: "Submit" } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Button size={size}>Upload</Button>
          <Button size={size} variant="brand">
            Launch
          </Button>
          <Button size={size} variant="secondary">
            Try a template
          </Button>
          <Button size={size} variant="ghost">
            Cancel
          </Button>
          <Button size={size} variant="danger">
            Remove
          </Button>
          <Button size={size} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};
