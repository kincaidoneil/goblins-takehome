import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { ScoreChip } from "./ScoreChip";
import { Tooltip } from "./Tooltip";

const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
  args: {
    content: "Hide names and scores while your screen is projected",
    children: <Button variant="secondary">Hide names</Button>,
  },
  decorators: [(Story) => <div style={{ padding: "64px 24px" }}>{Story()}</div>],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = { args: { defaultOpen: true } };

export const OnScoreChip: Story = {
  args: {
    defaultOpen: true,
    side: "bottom",
    content: "Unsimplified fraction; the rubric doesn't say whether 6/8 gets full credit.",
    children: (
      <button type="button" style={{ all: "unset", borderRadius: 999 }}>
        <ScoreChip status={{ state: "needs-teacher" }} />
      </button>
    ),
  },
};
