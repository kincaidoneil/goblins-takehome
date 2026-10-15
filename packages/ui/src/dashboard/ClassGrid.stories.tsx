import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClassGrid } from "./ClassGrid";
import { fixtureStatus, PROBLEMS, STUDENTS } from "./fixtures";

const meta = {
  title: "Dashboard/ClassGrid",
  component: ClassGrid,
  args: { students: STUDENTS, problems: PROBLEMS, status: fixtureStatus, onOpen: () => {} },
} satisfies Meta<typeof ClassGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidSession: Story = {};

/** "Hide names and scores" for a mirrored projector. */
export const Hidden: Story = { args: { hidden: true } };

export const JustStarted: Story = {
  args: { status: () => ({ state: "not-started" }), students: STUDENTS.slice(0, 6) },
};

export const NarrowScreen: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 420 }}>{Story()}</div>],
};
