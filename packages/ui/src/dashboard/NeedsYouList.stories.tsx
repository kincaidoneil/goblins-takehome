import type { Meta, StoryObj } from "@storybook/react-vite";
import { NeedsYouList } from "./NeedsYouList";

const meta = {
  title: "Dashboard/NeedsYouList",
  component: NeedsYouList,
  args: {
    onOpen: () => {},
    items: [
      {
        id: "1",
        studentName: "Maya R.",
        creatureId: 11,
        problemLabel: "4",
        kind: "needs",
        reason: "Last digit could be a 6 or a b; best guess 2/2.",
      },
      {
        id: "2",
        studentName: "Jordan T.",
        creatureId: 7,
        problemLabel: "3b",
        kind: "needs",
        reason: "Left 6/8 unsimplified; the rubric doesn't say if that's full credit.",
      },
      {
        id: "3",
        studentName: "Liam K.",
        creatureId: 21,
        problemLabel: "2",
        kind: "failed",
        reason: "The grader didn't answer after 3 tries.",
      },
    ],
  },
  decorators: [(Story) => <div style={{ maxWidth: 720 }}>{Story()}</div>],
} satisfies Meta<typeof NeedsYouList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeWaiting: Story = {};
export const NothingWaiting: Story = { args: { items: [] } };
