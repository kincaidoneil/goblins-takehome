import { useClerk } from "@clerk/tanstack-react-start";
import { Badge, Button, Card, EmptyState, Tabs } from "@goblins/ui";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { MathText } from "../../components/teacher/MathText";
import { TeacherHeader } from "../../components/teacher/TeacherHeader";
import {
  type AssignmentForReview,
  type Edit,
  editAssignment,
  getAssignment,
  launch,
} from "../../server/fns/assignments";

export const Route = createFileRoute("/assignments/$assignmentId")({
  loader: ({ params }) => getAssignment({ data: { assignmentId: params.assignmentId } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?._tag === "Ok"
            ? `${loaderData.value.title} · Goblins Auto-Grader`
            : "Assignment · Goblins Auto-Grader",
      },
    ],
  }),
  component: ReviewPage,
});

type Problem = AssignmentForReview["problems"][number];

function ReviewPage() {
  const result = Route.useLoaderData();
  if (result._tag === "Err") {
    return (
      <div className="min-h-dvh bg-bg">
        <TeacherHeader />
        <main className="mx-auto max-w-xl px-4 py-20">
          <EmptyState
            title="We couldn't find that assignment"
            description="It may belong to another account. Sign in with the account that made it, or start a new one."
          />
        </main>
      </div>
    );
  }
  return <Review assignment={result.value} />;
}

function Review({ assignment }: { readonly assignment: AssignmentForReview }) {
  const router = useRouter();
  const save = async (edit: Edit) => {
    await editAssignment({ data: { assignmentId: assignment.id, edit } });
    await router.invalidate();
  };
  const totalPoints = assignment.problems.reduce(
    (sum, problem) => sum + problem.rubricLines.reduce((s, line) => s + line.points, 0),
    0,
  );

  return (
    <div className="min-h-dvh bg-bg">
      <TeacherHeader>
        <TitleInput
          title={assignment.title}
          locked={assignment.locked}
          onSave={(title) => save({ _tag: "Rename", title })}
        />
        <LaunchButton assignmentId={assignment.id} signedIn={assignment.signedIn} />
      </TeacherHeader>
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="problems-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 id="problems-heading" className="text-xl">
              What the grader will know
            </h1>
            <p className="text-sm text-text-muted">
              {assignment.problems.length} problems · {totalPoints} points
            </p>
          </div>
          {assignment.locked ? (
            <Card tone="tint" padding="sm">
              <p className="text-sm">
                This assignment has been launched, so its problems and rubrics are locked. That
                keeps every student graded against the same rubric.
              </p>
            </Card>
          ) : (
            <p className="text-sm text-text-muted">
              Check each problem's answer and point lines. Click any text to change it, or ask for
              changes in the panel on the right.
            </p>
          )}
          {assignment.problems.map((problem) => (
            <ProblemCard
              key={problem.id}
              problem={problem}
              locked={assignment.locked}
              onSave={save}
            />
          ))}
        </section>
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)]">
          <Card padding="sm" className="flex h-full flex-col">
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              items={[
                {
                  value: "worksheet",
                  label: "Original worksheet",
                  content: <Worksheet pages={assignment.pages} />,
                },
                {
                  value: "chat",
                  label: "Ask for changes",
                  content: <ChatPanel />,
                },
              ]}
            />
          </Card>
        </aside>
      </main>
    </div>
  );
}

function TitleInput(props: {
  readonly title: string;
  readonly locked: boolean;
  readonly onSave: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(props.title);
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">Assignment name</span>
      <input
        value={value}
        disabled={props.locked}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const next = value.trim();
          if (next !== "" && next !== props.title) void props.onSave(next);
          else setValue(props.title);
        }}
        className="w-full truncate rounded-md bg-transparent px-2 py-1 font-extrabold text-brand text-lg outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
      />
    </label>
  );
}

type LaunchState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Launching" }
  | { readonly _tag: "Failed"; readonly message: string };

function LaunchButton({
  assignmentId,
  signedIn,
}: {
  readonly assignmentId: string;
  readonly signedIn: boolean;
}) {
  const clerk = useClerk();
  const navigate = useNavigate();
  const [state, setState] = useState<LaunchState>({ _tag: "Idle" });

  const go = async () => {
    if (!signedIn) {
      // Sign-in is asked for only now, so nothing done before is lost: the draft moves to the
      // teacher's account on the next request.
      clerk.openSignIn({ forceRedirectUrl: window.location.href });
      return;
    }
    setState({ _tag: "Launching" });
    const result = await launch({ data: { assignmentId, timeLimitMinutes: null } });
    if (result._tag === "Err") {
      setState({ _tag: "Failed", message: "Something went wrong launching. Try again." });
      return;
    }
    const { sessionId } = result.value;
    // The projector gets its own window so a teacher with a second screen keeps the dashboard
    // private (PRD, "Privacy on a projected laptop").
    window.open(
      `/sessions/${sessionId}/projector`,
      `projector-${sessionId}`,
      "popup,width=1280,height=800",
    );
    await navigate({ to: "/sessions/$sessionId", params: { sessionId } });
  };

  return (
    <div className="flex shrink-0 items-center gap-3">
      {state._tag === "Failed" && <span className="text-sm text-danger">{state.message}</span>}
      <Button onClick={go} disabled={state._tag === "Launching"}>
        {state._tag === "Launching"
          ? "Launching…"
          : signedIn
            ? "Launch to class"
            : "Sign in to launch"}
      </Button>
    </div>
  );
}

function ProblemCard(props: {
  readonly problem: Problem;
  readonly locked: boolean;
  readonly onSave: (edit: Edit) => Promise<void>;
}) {
  const { problem, locked, onSave } = props;
  const points = problem.rubricLines.reduce((sum, line) => sum + line.points, 0);
  return (
    <Card className="flex flex-col gap-4" id={`problem-${problem.label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 font-extrabold text-sm text-white">
          {problem.label}
        </span>
        <span className="text-sm text-text-muted">
          {points} {points === 1 ? "point" : "points"}
          {problem.pageNumbers.length > 0 && ` · page ${problem.pageNumbers.join(" and ")}`}
        </span>
        {problem.dependsOn.length > 0 && (
          <Badge tone="info">Uses the answer to {problem.dependsOn.join(", ")}</Badge>
        )}
      </div>

      <EditableText
        label="Problem"
        value={problem.text}
        locked={locked}
        render={(text) => <MathText text={text} className="text-base" />}
        onSave={(value) =>
          onSave({ _tag: "EditProblem", problemId: problem.id, field: "text", value })
        }
      />

      {problem.diagramDescription !== null && (
        <EditableText
          label="The diagram, as the grader sees it"
          value={problem.diagramDescription}
          locked={locked}
          render={(text) => <p className="text-sm text-text-muted">{text}</p>}
          onSave={(value) =>
            onSave({
              _tag: "EditProblem",
              problemId: problem.id,
              field: "diagramDescription",
              value,
            })
          }
        />
      )}

      <EditableText
        label="Answer"
        value={problem.answerKey}
        locked={locked}
        render={(text) => <MathText text={asMath(text)} className="font-bold" />}
        onSave={(value) =>
          onSave({ _tag: "EditProblem", problemId: problem.id, field: "answerKey", value })
        }
      />

      <div>
        <h3 className="mb-2 font-bold text-sm text-text-muted">Rubric</h3>
        <ul className="flex flex-col gap-2">
          {problem.rubricLines.map((line) => (
            <RubricLine
              key={line.id}
              line={line}
              locked={locked}
              removable={problem.rubricLines.length > 1}
              onSave={onSave}
            />
          ))}
        </ul>
        {!locked && (
          <button
            type="button"
            className="mt-2 text-sm font-bold text-brand hover:underline"
            onClick={() => onSave({ _tag: "AddRubricLine", problemId: problem.id })}
          >
            + Add a point line
          </button>
        )}
      </div>

      <EditableText
        label="Notes for the grader"
        value={problem.gradingNotes}
        locked={locked}
        render={(text) => <MathText text={text} className="text-sm text-text-muted" />}
        onSave={(value) =>
          onSave({ _tag: "EditProblem", problemId: problem.id, field: "gradingNotes", value })
        }
      />
    </Card>
  );
}

/** Answer keys are LaTeX without delimiters when they contain a command, plain text otherwise. */
const asMath = (text: string) =>
  text.includes("\\(") || !text.includes("\\") ? text : `\\(${text}\\)`;

function RubricLine(props: {
  readonly line: Problem["rubricLines"][number];
  readonly locked: boolean;
  readonly removable: boolean;
  readonly onSave: (edit: Edit) => Promise<void>;
}) {
  const { line, locked, removable, onSave } = props;
  const [description, setDescription] = useState(line.description);
  const save = (points: number, text: string) =>
    onSave({ _tag: "EditRubricLine", rubricLineId: line.id, points, description: text });
  return (
    <li className="flex items-start gap-2 rounded-md bg-surface-sunken p-2">
      <div className="flex shrink-0 items-center rounded-md bg-surface text-sm">
        <button
          type="button"
          aria-label="One point fewer"
          disabled={locked || line.points <= 1}
          className="px-2 py-1 text-text-muted disabled:opacity-30"
          onClick={() => save(line.points - 1, description)}
        >
          −
        </button>
        <span className="w-12 text-center font-bold">{line.points} pt</span>
        <button
          type="button"
          aria-label="One point more"
          disabled={locked || line.points >= 20}
          className="px-2 py-1 text-text-muted disabled:opacity-30"
          onClick={() => save(line.points + 1, description)}
        >
          +
        </button>
      </div>
      <textarea
        value={description}
        disabled={locked}
        rows={1}
        placeholder="What earns this point?"
        aria-label="Point line"
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          if (description !== line.description) void save(line.points, description);
        }}
        className="field-sizing-content min-h-8 flex-1 resize-none rounded-md bg-transparent px-2 py-1 text-sm outline-none focus:bg-surface"
      />
      {!locked && removable && (
        <button
          type="button"
          aria-label="Remove this point line"
          className="px-2 py-1 text-text-subtle hover:text-danger"
          onClick={() => onSave({ _tag: "RemoveRubricLine", rubricLineId: line.id })}
        >
          ×
        </button>
      )}
    </li>
  );
}

/** Shows rendered text; click to edit the source, blur to save. */
function EditableText(props: {
  readonly label: string;
  readonly value: string;
  readonly locked: boolean;
  readonly render: (text: string) => React.ReactNode;
  readonly onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);
  return (
    <div>
      <h3 className="mb-1 font-bold text-sm text-text-muted">{props.label}</h3>
      {editing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the teacher just clicked to edit this text
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== props.value) void props.onSave(draft);
          }}
          className="field-sizing-content w-full rounded-md border border-border-brand bg-surface p-2 font-mono text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={props.locked}
          onClick={() => {
            setDraft(props.value);
            setEditing(true);
          }}
          className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left enabled:hover:bg-surface-sunken"
        >
          {props.render(props.value)}
        </button>
      )}
    </div>
  );
}

function Worksheet({ pages }: { readonly pages: AssignmentForReview["pages"] }) {
  if (pages.length === 0) {
    return (
      <p className="p-4 text-sm text-text-muted">No pages were uploaded with this assignment.</p>
    );
  }
  return (
    <div className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto p-1 lg:max-h-none lg:flex-1">
      {pages.map((page) => (
        <img
          key={page.pageNumber}
          src={page.imageUrl}
          alt={`Worksheet page ${page.pageNumber}`}
          className="w-full rounded-md border border-border"
        />
      ))}
    </div>
  );
}

/**
 * Chat editing ("make problem 3 worth 4 points") is built by the AI-quality stream. Until it lands,
 * the panel says so plainly instead of pretending.
 */
function ChatPanel() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 p-2">
      <Card tone="sunken" padding="sm">
        <p className="text-sm">
          Soon you'll be able to type changes here, like “make problem 3 worth 4 points” or “accept
          unsimplified fractions.” For now, click any text on the left to edit it.
        </p>
      </Card>
    </div>
  );
}
