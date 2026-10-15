import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, Input, Textarea } from "./Field";

const meta = {
  title: "Components/Field",
  component: Field,
  args: { label: "Your name", children: null },
  decorators: [(Story) => <div style={{ maxWidth: 360 }}>{Story()}</div>],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {
  args: {
    label: "Your name",
    description: "First name and last initial, like Maya R.",
    children: <Input placeholder="Maya R." />,
  },
};

export const Filled: Story = {
  args: { label: "Assignment name", children: <Input defaultValue="Unit 3 quiz: circles" /> },
};

export const WithError: Story = {
  args: {
    label: "Join code",
    error: "That code doesn't match a class. Check the board and try again.",
    children: <Input defaultValue="620-19" />,
  },
};

export const Disabled: Story = {
  args: { label: "Join code", children: <Input defaultValue="620-192" disabled /> },
};

export const Multiline: Story = {
  args: {
    label: "Rubric",
    description: "One point line per row.",
    children: (
      <Textarea
        defaultValue={"1 pt: correct setup.\n1 pt: correct answer. Accept equivalent forms."}
      />
    ),
  },
};

export const BareInput: Story = {
  render: () => <Input placeholder="Search students" aria-label="Search students" />,
};
