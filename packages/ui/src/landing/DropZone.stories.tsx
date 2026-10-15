import type { Meta, StoryObj } from "@storybook/react-vite";
import "./LandingPage.css";
import { DropZone } from "./DropZone";

const meta = {
  title: "Landing/DropZone",
  component: DropZone,
  args: {
    onFiles: () => new Promise(() => {}),
    onStarted: () => {},
    onShowTemplates: () => {},
  },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
} satisfies Meta<typeof DropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Dragging: Story = { args: { initialState: { _tag: "Dragging" } } };
export const Uploading: Story = {
  args: { initialState: { _tag: "Uploading", fileName: "Unit 3 quiz.pdf" } },
};
export const Unsupported: Story = {
  args: { initialState: { _tag: "Problem", problem: "unsupported" } },
};
export const TooLarge: Story = {
  args: { initialState: { _tag: "Problem", problem: "too-large" } },
};
export const UploadFailed: Story = {
  args: { initialState: { _tag: "Problem", problem: "upload-failed" } },
};
