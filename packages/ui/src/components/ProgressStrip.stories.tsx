import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ProgressStrip, type StripProblem } from "./ProgressStrip";

const fresh: ReadonlyArray<StripProblem> = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i + 1}`,
  label: `${i + 1}`,
  status: { state: "not-started" },
}));

const midway: ReadonlyArray<StripProblem> = [
  { id: "p1", label: "1", status: { state: "graded", points: 2, maxPoints: 2 } },
  { id: "p2", label: "2a", status: { state: "graded", points: 3, maxPoints: 4 } },
  { id: "p3", label: "2b", status: { state: "graded", points: 1, maxPoints: 4 } },
  { id: "p4", label: "3", status: { state: "needs-teacher" } },
  { id: "p5", label: "4", status: { state: "graded", points: 2, maxPoints: 2 } },
  { id: "p6", label: "5", status: { state: "grading" } },
  { id: "p7", label: "6", status: { state: "not-started" } },
  { id: "p8", label: "7", status: { state: "not-started" } },
  { id: "p9", label: "8", status: { state: "not-started" } },
  { id: "p10", label: "9", status: { state: "not-started" } },
];

const meta = {
  title: "Student/ProgressStrip",
  component: ProgressStrip,
  args: { problems: midway, currentId: "p7" },
  decorators: [(Story) => <div style={{ maxWidth: 760 }}>{Story()}</div>],
} satisfies Meta<typeof ProgressStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = { args: { problems: fresh, currentId: "p1" } };
export const Midway: Story = {};
export const Finished: Story = {
  args: {
    currentId: "",
    problems: midway.map((p, i) =>
      p.status.state === "not-started" || p.status.state === "grading"
        ? { ...p, status: { state: "graded", points: i % 3 === 0 ? 1 : 2, maxPoints: 2 } }
        : p,
    ),
  },
};
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 340 }}>{Story()}</div>],
};

function Interactive() {
  const [current, setCurrent] = useState("p7");
  return <ProgressStrip problems={midway} currentId={current} onSelect={setCurrent} />;
}

export const Navigable: Story = { render: () => <Interactive /> };
