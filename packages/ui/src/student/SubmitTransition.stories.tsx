import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubmitTransition } from "./SubmitTransition";

/** Stays up in stories: onDone is a no-op, and the story re-mounts to replay. */
const meta = {
  title: "Student/SubmitTransition",
  component: SubmitTransition,
  parameters: { layout: "fullscreen" },
  args: {
    creatureId: 11,
    problemIndex: 0,
    nextLabel: "4",
    grade: { state: "graded", points: 2, maxPoints: 2 },
    onDone: () => {},
  },
} satisfies Meta<typeof SubmitTransition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScoreArrived: Story = {};
export const PartialCredit: Story = {
  args: { problemIndex: 1, grade: { state: "graded", points: 1, maxPoints: 2 } },
};
export const ScoreNotYetIn: Story = { args: { problemIndex: 2, grade: { state: "grading" } } };
export const TeacherWillCheck: Story = {
  args: { problemIndex: 3, grade: { state: "needs-teacher" } },
};
export const LastProblem: Story = { args: { problemIndex: 4, nextLabel: undefined } };
