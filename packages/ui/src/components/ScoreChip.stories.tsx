import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GradeStatus } from "./grade";
import { ScoreChip } from "./ScoreChip";

const meta = {
  title: "Components/ScoreChip",
  component: ScoreChip,
  args: { status: { state: "graded", points: 4, maxPoints: 4 } },
} satisfies Meta<typeof ScoreChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullCredit: Story = {};
export const Partial: Story = { args: { status: { state: "graded", points: 2, maxPoints: 4 } } };
export const Low: Story = { args: { status: { state: "graded", points: 0, maxPoints: 4 } } };
export const NeedsYou: Story = { args: { status: { state: "needs-teacher" } } };
export const CouldntGrade: Story = { args: { status: { state: "couldnt-grade" } } };
export const Grading: Story = { args: { status: { state: "grading" } } };
export const NotStarted: Story = { args: { status: { state: "not-started" } } };
export const Concealed: Story = { args: { concealed: true } };
export const StudentSeesTeacherCheck: Story = {
  args: { status: { state: "needs-teacher" }, audience: "student" },
};

const all: ReadonlyArray<[string, GradeStatus]> = [
  ["Not started", { state: "not-started" }],
  ["Grading", { state: "grading" }],
  ["Full", { state: "graded", points: 4, maxPoints: 4 }],
  ["Partial", { state: "graded", points: 3, maxPoints: 4 }],
  ["Partial", { state: "graded", points: 2, maxPoints: 4 }],
  ["Low", { state: "graded", points: 1, maxPoints: 4 }],
  ["Low", { state: "graded", points: 0, maxPoints: 4 }],
  ["Needs you", { state: "needs-teacher" }],
  ["Couldn't grade", { state: "couldnt-grade" }],
];

export const AllStates: Story = {
  render: () => (
    <table style={{ borderSpacing: "16px 10px" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--gb-color-text-muted)", fontSize: 14 }}>
          <th>State</th>
          <th>Teacher</th>
          <th>Student</th>
          <th>Small</th>
          <th>Concealed</th>
        </tr>
      </thead>
      <tbody>
        {all.map(([label, status], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <tr key={i}>
            <td>{label}</td>
            <td>
              <ScoreChip status={status} />
            </td>
            <td>
              <ScoreChip status={status} audience="student" />
            </td>
            <td>
              <ScoreChip status={status} size="sm" />
            </td>
            <td>
              <ScoreChip status={status} size="sm" concealed />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
