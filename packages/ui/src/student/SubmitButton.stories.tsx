import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubmitButton } from "./SubmitButton";

const meta = {
  title: "Student/SubmitButton",
  component: SubmitButton,
  args: { state: { _tag: "Ready" }, onSubmit: () => {} },
} satisfies Meta<typeof SubmitButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Empty: Story = { args: { state: { _tag: "Empty" } } };
export const Submitting: Story = { args: { state: { _tag: "Submitting" } } };
export const QueuedOffline: Story = { args: { state: { _tag: "QueuedOffline" } } };
