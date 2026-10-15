import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { CreatureArt } from "./creatures";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  args: {
    title: "No assignments yet",
    description:
      "Drop in the worksheet you were going to hand out anyway, or start from a template.",
    art: (
      <div style={{ display: "flex", gap: -8 }}>
        <CreatureArt id={0} size={72} title="" />
        <CreatureArt id={11} size={72} title="" />
        <CreatureArt id={26} size={72} title="" />
      </div>
    ),
    actions: (
      <>
        <Button>Upload a worksheet</Button>
        <Button variant="secondary">Browse templates</Button>
      </>
    ),
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoAssignments: Story = {};

export const Lobby: Story = {
  args: {
    title: "Waiting for students",
    description: "Students join at the code on the board. They'll show up here as they arrive.",
    art: <CreatureArt id={36} size={96} title="" />,
    actions: undefined,
  },
};

export const NothingToCheck: Story = {
  args: {
    title: "Nothing needs you",
    description: "Every grade so far is one the grader is sure about.",
    art: <CreatureArt id={18} size={80} title="" />,
    actions: undefined,
  },
};
