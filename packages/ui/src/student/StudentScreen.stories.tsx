import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useState } from "react";
import ANGLES_PAGE_1 from "../../../templates/templates/angle-relationships/page-1.png";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import type { GradeStatus } from "../components/grade";
import { ProgressStrip, type StripProblem } from "../components/ProgressStrip";
import { EMPTY_DOC, type WhiteboardDoc } from "../whiteboard/doc";
import { SOLVED_EQUATION, SOLVED_EQUATION_PORTRAIT } from "../whiteboard/fixtures";
import { isDocEmpty } from "../whiteboard/render";
import { Whiteboard } from "../whiteboard/Whiteboard";
import { ProblemPanel } from "./ProblemPanel";
import { StudentWorkLayout } from "./StudentWorkLayout";
import { SubmitButton, type SubmitState } from "./SubmitButton";
import { SubmitTransition } from "./SubmitTransition";

const PROBLEMS = [
  { id: "p1", label: "1", text: "Solve 3(x − 4) = 12x." },
  { id: "p2", label: "2", text: "Solve 2(x + 5) = 3x + 1. Explain or show your reasoning." },
  { id: "p3", label: "3", text: "Solve 2x + 3 = 11. Check your solution." },
  {
    id: "p4",
    label: "4",
    text: "List two pairs of angles in square CDFG that are complementary.",
    figure: {
      src: ANGLES_PAGE_1,
      alt: "Square CDFG with a point E on side DF and segments from C to E.",
      crop: { x: 0.579, y: 0.516, w: 0.233, h: 0.185 },
      onOpen: () => {},
    },
  },
  { id: "p5", label: "5", text: "Solve 12(5 + 2y) = 4y − (6 − 9y)." },
] as const;

/** The app's problem panel, built from the problem data. */
function Problem({ index }: { index: number }) {
  const problem = PROBLEMS[index] ?? PROBLEMS[0];
  return (
    <ProblemPanel
      label={problem.label}
      total={PROBLEMS.length}
      points={2}
      {...("figure" in problem ? { figure: problem.figure } : {})}
    >
      {problem.text}
    </ProblemPanel>
  );
}

const style = `
/* Like the app's play route: one screen tall on a phone, so the board fills what's left. */
.story-screen { display: flex; flex-direction: column; min-height: 100dvh; }
@media (max-width: 860px) { .story-screen { height: 100dvh; } }
.story-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; color: var(--gb-color-text-brand); font-weight: 800; }
`;

type Phase =
  | { readonly _tag: "Working" }
  | { readonly _tag: "Submitting" }
  | { readonly _tag: "Transition"; readonly grade: GradeStatus };

interface ScreenProps {
  /** Starts on this problem with this work, for screenshots of each state. */
  start: { index: number; doc: WhiteboardDoc; phase: Phase; offline: boolean };
  /** What the mock grader returns, and after how long. */
  gradeAfterMs: number;
}

/** The whole student screen, driven by a fake network and grader. */
function StudentScreen({ start, gradeAfterMs }: ScreenProps) {
  const [index, setIndex] = useState(start.index);
  const [doc, setDoc] = useState(start.doc);
  const [boardKey, setBoardKey] = useState(0);
  const [phase, setPhase] = useState<Phase>(start.phase);
  const [grades, setGrades] = useState<ReadonlyArray<GradeStatus>>(
    PROBLEMS.map(
      (_, i): GradeStatus =>
        i < start.index
          ? { state: "graded", points: i === 1 ? 1 : 2, maxPoints: 2 }
          : { state: "not-started" },
    ),
  );

  const setGrade = (i: number, grade: GradeStatus) =>
    setGrades((all) => all.map((g, j) => (j === i ? grade : g)));

  function submit() {
    const submitted = index;
    setPhase({ _tag: "Submitting" });
    setGrade(submitted, { state: "grading" });
    window.setTimeout(() => setPhase({ _tag: "Transition", grade: { state: "grading" } }), 500);
    window.setTimeout(() => {
      const grade: GradeStatus =
        submitted === 3 ? { state: "needs-teacher" } : { state: "graded", points: 2, maxPoints: 2 };
      setGrade(submitted, grade);
      setPhase((p) => (p._tag === "Transition" ? { _tag: "Transition", grade } : p));
    }, 500 + gradeAfterMs);
  }

  const next = useCallback(() => {
    setPhase({ _tag: "Working" });
    setIndex((i) => Math.min(i + 1, PROBLEMS.length - 1));
    setDoc(EMPTY_DOC);
    setBoardKey((k) => k + 1);
  }, []);

  const strip: ReadonlyArray<StripProblem> = PROBLEMS.map((p, i) => ({
    id: p.id,
    label: p.label,
    status: grades[i] ?? { state: "not-started" },
  }));

  const submitState: SubmitState = start.offline
    ? { _tag: "QueuedOffline" }
    : phase._tag !== "Working"
      ? { _tag: "Submitting" }
      : isDocEmpty(doc)
        ? { _tag: "Empty" }
        : { _tag: "Ready" };

  return (
    <>
      <style>{style}</style>
      <div className="story-screen">
        <StudentWorkLayout
          progress={
            <>
              <div className="story-top">
                <Avatar kind="creature" creatureId={11} size="sm" />
                Maya R. · Unit 3 quiz
              </div>
              <ProgressStrip
                problems={strip}
                currentId={PROBLEMS[index]?.id ?? ""}
                onSelect={(id) => {
                  setIndex(PROBLEMS.findIndex((p) => p.id === id));
                  setDoc(EMPTY_DOC);
                  setBoardKey((k) => k + 1);
                }}
              />
            </>
          }
          problem={<Problem index={index} />}
          board={
            <Whiteboard
              key={boardKey}
              initialDoc={doc}
              onChange={setDoc}
              disabled={phase._tag !== "Working"}
              accessory={
                <Button variant="secondary" size="sm">
                  See worksheet
                </Button>
              }
            />
          }
          submit={<SubmitButton state={submitState} onSubmit={submit} />}
        />
      </div>
      {phase._tag === "Transition" && (
        <SubmitTransition
          creatureId={11}
          problemIndex={index}
          nextLabel={PROBLEMS[index + 1]?.label}
          grade={phase.grade}
          onDone={next}
        />
      )}
    </>
  );
}

const meta = {
  title: "Student/Screen",
  component: StudentScreen,
  parameters: { layout: "fullscreen" },
  args: {
    start: { index: 2, doc: SOLVED_EQUATION, phase: { _tag: "Working" }, offline: false },
    gradeAfterMs: 700,
  },
} satisfies Meta<typeof StudentScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Draw, Submit, and watch the transition into the next problem. */
export const Working: Story = {};

export const EmptyBoard: Story = {
  args: { start: { index: 2, doc: EMPTY_DOC, phase: { _tag: "Working" }, offline: false } },
};

export const Submitting: Story = {
  args: {
    start: { index: 2, doc: SOLVED_EQUATION, phase: { _tag: "Submitting" }, offline: false },
  },
};

export const QueuedOffline: Story = {
  args: { start: { index: 2, doc: SOLVED_EQUATION, phase: { _tag: "Working" }, offline: true } },
};

/** A geometry problem: its diagram sits under the text, so the student doesn't need "See worksheet". */
export const WithDiagram: Story = {
  args: { start: { index: 3, doc: EMPTY_DOC, phase: { _tag: "Working" }, offline: false } },
};

/** On a phone the page is portrait (3:4), so there is room to write. */
export const PhonePortrait: Story = {
  args: {
    start: { index: 2, doc: SOLVED_EQUATION_PORTRAIT, phase: { _tag: "Working" }, offline: false },
  },
};

/** The grade arrives after the transition, so it fills in on the strip instead. */
export const SlowGrade: Story = { args: { gradeAfterMs: 4000 } };
