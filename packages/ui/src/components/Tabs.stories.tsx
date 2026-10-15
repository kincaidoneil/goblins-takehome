import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "./Tabs";

const items = [
  { value: "problems", label: "Problems", content: <p>12 problems, 30 points.</p> },
  { value: "rubric", label: "Rubric", content: <p>1 pt: correct setup. 1 pt: correct answer.</p> },
  { value: "pages", label: "Original pages", content: <p>2 pages.</p> },
  { value: "share", label: "Share", content: null, disabled: true },
] as const;

const meta = {
  title: "Components/Tabs",
  component: Tabs<(typeof items)[number]["value"]>,
  args: { items },
} satisfies Meta<typeof Tabs<(typeof items)[number]["value"]>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SecondSelected: Story = { args: { defaultValue: "rubric" } };
