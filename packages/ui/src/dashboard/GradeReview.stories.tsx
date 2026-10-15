import type { Meta, StoryObj } from "@storybook/react-vite";
import { Either } from "effect";
import { SOLVED_EQUATION } from "../whiteboard/fixtures";
import { renderWhiteboardPng } from "../whiteboard/render";
import { GradeReview, type ReviewLine } from "./GradeReview";

const LINES: ReadonlyArray<ReviewLine> = [
  { id: "a", text: "Subtracts 3 from both sides correctly", maxPoints: 1, awarded: 1 },
  { id: "b", text: "Divides by 2 to get x = 4", maxPoints: 1, awarded: 1 },
  { id: "c", text: "Checks the solution in the original equation", maxPoints: 1, awarded: 0 },
];

/** Renders the handwriting fixture to a PNG, as the app would store it. */
async function whiteboardUrl(): Promise<string> {
  const png = await renderWhiteboardPng(SOLVED_EQUATION);
  return Either.isRight(png) ? URL.createObjectURL(png.right) : "";
}

const meta = {
  title: "Dashboard/GradeReview",
  component: GradeReview,
  loaders: [async () => ({ url: await whiteboardUrl() })],
  render: (args, { loaded }) => (
    <GradeReview {...args} whiteboardUrl={typeof loaded.url === "string" ? loaded.url : ""} />
  ),
  args: {
    studentName: "Maya R.",
    creatureId: 11,
    problemLabel: "3",
    problemText: "Solve 2x + 3 = 11. Check your solution.",
    whiteboardUrl: "",
    lines: LINES,
    state: {
      _tag: "NeedsTeacher",
      read: "2x + 3 = 11\n2x = 8\nx = 4 (circled)",
      reason: "Correct steps and answer; no check shown.",
      flagReason: "The rubric asks for a check, and the circle around x = 4 might be meant as one.",
    },
    onAccept: () => {},
    onSave: () => {},
    onRetry: () => {},
  },
  decorators: [(Story) => <div style={{ maxWidth: 1100 }}>{Story()}</div>],
} satisfies Meta<typeof GradeReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsYou: Story = {};

export const Graded: Story = {
  args: {
    state: {
      _tag: "Graded",
      read: "2x + 3 = 11\n2x = 8\nx = 4 (circled)",
      reason: "Correct steps and answer; no check shown.",
      byTeacher: false,
    },
  },
};

export const ScoredByTeacher: Story = {
  args: {
    lines: LINES.map((line) => ({ ...line, awarded: line.maxPoints })),
    state: { _tag: "Graded", read: undefined, reason: undefined, byTeacher: true },
  },
};

export const CouldntGrade: Story = {
  args: {
    lines: LINES.map((line) => ({ ...line, awarded: 0 })),
    state: { _tag: "CouldntGrade", failureReason: "The grader didn't answer after 3 tries." },
  },
};

export const StillGrading: Story = {
  args: { lines: LINES.map((line) => ({ ...line, awarded: 0 })), state: { _tag: "Pending" } },
};

export const Saving: Story = { args: { busy: true } };
