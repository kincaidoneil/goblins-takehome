import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Dialog, DialogClose } from "./Dialog";
import { Field, Input } from "./Field";

const meta = {
  title: "Components/Dialog",
  component: Dialog,
  args: { title: "End the session?" },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  args: {
    defaultOpen: true,
    trigger: <Button variant="secondary">End session</Button>,
    title: "End the session?",
    description:
      "Students can't join or submit after this. Grades in progress will still finish, and your report opens next.",
    actions: (
      <>
        <DialogClose>
          <Button variant="ghost">Keep going</Button>
        </DialogClose>
        <DialogClose>
          <Button variant="brand">End and see report</Button>
        </DialogClose>
      </>
    ),
  },
};

export const WithForm: Story = {
  args: {
    defaultOpen: true,
    size: "sm",
    trigger: <Button variant="secondary">Rename</Button>,
    title: "Rename student",
    children: (
      <Field label="Name">
        <Input defaultValue="maya r" />
      </Field>
    ),
    actions: (
      <>
        <DialogClose>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <DialogClose>
          <Button variant="brand">Save</Button>
        </DialogClose>
      </>
    ),
  },
};

export const Closed: Story = {
  args: {
    trigger: <Button variant="secondary">Open dialog</Button>,
    title: "Share this report",
    description: "Anyone with the link sees class results without student names.",
    actions: (
      <DialogClose>
        <Button>Copy link</Button>
      </DialogClose>
    ),
  },
};
