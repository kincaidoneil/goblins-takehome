import type { Meta, StoryObj } from "@storybook/react-vite";
import anglesPage1 from "../../../templates/templates/angle-relationships/page-1.png";
import linearPage1 from "../../../templates/templates/linear-relationships/page-1.png";
import { CroppedFigure } from "./ProblemPanel";

const meta = {
  title: "Student/CroppedFigure",
  component: CroppedFigure,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CroppedFigure>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Static, e.g. above a student's whiteboard in the teacher's review panel. */
export const Static: Story = {
  args: {
    figure: {
      src: anglesPage1,
      alt: "Square CDFG with segments from C and G to M on side DF, angles labeled.",
      crop: { x: 0.579, y: 0.516, w: 0.233, h: 0.185 },
    },
  },
};

/** With `onOpen`: a button with a Zoom hint, as on the student screen. */
export const Tappable: Story = {
  args: {
    figure: {
      src: linearPage1,
      alt: "A graph of cups of flour against cups of sugar.",
      crop: { x: 0.162, y: 0.389, w: 0.275, h: 0.189 },
      onOpen: () => {},
    },
  },
};
