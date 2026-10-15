import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import anglesPage1 from "../../../templates/templates/angle-relationships/page-1.png";
import page1 from "../../../templates/templates/linear-relationships/page-1.png";
import page2 from "../../../templates/templates/linear-relationships/page-2.png";
import page3 from "../../../templates/templates/linear-relationships/page-3.png";
import { Button } from "./Button";
import { Dialog, DialogClose } from "./Dialog";
import { WorksheetViewer } from "./WorksheetViewer";

const pages = [
  { pageNumber: 1, imageUrl: page1 },
  { pageNumber: 2, imageUrl: page2 },
  { pageNumber: 3, imageUrl: page3 },
];

const meta = {
  title: "Components/WorksheetViewer",
  component: WorksheetViewer,
  args: { pages },
  decorators: [
    (Story) => (
      <div style={{ height: "80dvh", maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorksheetViewer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MultiPage: Story = {};

export const OnePage: Story = { args: { pages: pages.slice(0, 1) } };

/** Setup's pages pane: a narrow sticky column, the active problem's pages marked. */
export const SetupColumn: Story = {
  args: { highlightPages: [2, 3] },
  decorators: [
    (Story) => (
      <div style={{ width: 340, height: "calc(100dvh - 112px)" }}>
        <Story />
      </div>
    ),
  ],
};

/** Jumping from outside, like a problem card's "Page 2" button. */
export const ControlledPage: Story = {
  render: (args) => {
    const [page, setPage] = useState(1);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[1, 2, 3].map((n) => (
            <Button key={n} variant="secondary" size="sm" onClick={() => setPage(n)}>
              Go to page {n}
            </Button>
          ))}
        </div>
        <WorksheetViewer {...args} page={page} onPageChange={setPage} />
      </div>
    );
  },
};

/** The student's "See worksheet" sheet. */
export const InDialog: Story = {
  render: (args) => (
    <Dialog
      size="lg"
      defaultOpen
      trigger={<Button variant="secondary">See worksheet</Button>}
      title="Problem 2a on the worksheet"
      actions={
        <DialogClose>
          <Button variant="brand">Back to my work</Button>
        </DialogClose>
      }
    >
      <div style={{ height: "62dvh" }}>
        <WorksheetViewer {...args} />
      </div>
    </Dialog>
  ),
};

/** Opened from a problem's figure: zoomed to the figure's region of its page. */
export const FocusedOnFigure: Story = {
  args: {
    pages: [{ pageNumber: 1, imageUrl: anglesPage1 }],
    focus: { pageNumber: 1, x: 0.579, y: 0.516, w: 0.233, h: 0.185 },
  },
};
