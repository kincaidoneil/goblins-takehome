import type { Meta, StoryObj } from "@storybook/react-vite";
import { Wordmark } from "./Wordmark";

const meta = {
  title: "Components/Wordmark",
  component: Wordmark,
  args: { product: "grader" },
} satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grader: Story = {};
export const Goblins: Story = { args: { product: "goblins" } };

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 20 }}>
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} style={{ display: "flex", gap: 40 }}>
          <Wordmark product="grader" size={size} />
          <Wordmark product="goblins" size={size} />
        </div>
      ))}
    </div>
  ),
};
