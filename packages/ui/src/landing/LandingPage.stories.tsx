import type { Meta, StoryObj } from "@storybook/react-vite";
import "./LandingPage.css";
import { LandingPage } from "./LandingPage";
import { PLACEHOLDER_TEMPLATES } from "./templates";
import type { UploadResult } from "./upload";

/** Stands in for the setup flow until the web app shell lands. */
const stubUpload =
  (result: UploadResult, ms = 1500) =>
  () =>
    new Promise<UploadResult>((resolve) => setTimeout(() => resolve(result), ms));

const meta = {
  title: "Landing/Page",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
  args: {
    templates: PLACEHOLDER_TEMPLATES,
    onFiles: stubUpload({ _tag: "Started", draftId: "draft_123" }),
    onTemplate: () => {},
    onStarted: () => {},
    signInHref: "#sign-in",
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Uploading: Story = {
  args: { dropZoneState: { _tag: "Uploading", fileName: "Unit 3 quiz.pdf" } },
};
export const UnsupportedFile: Story = {
  args: { dropZoneState: { _tag: "Problem", problem: "unsupported" } },
};
export const UnreadablePhoto: Story = {
  args: {
    onFiles: stubUpload({ _tag: "Rejected", reason: "unreadable" }),
    dropZoneState: { _tag: "Problem", problem: "unreadable" },
  },
};
