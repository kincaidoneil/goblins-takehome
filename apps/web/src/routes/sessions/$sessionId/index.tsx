import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogClose,
  Field,
  Input,
  Menu,
  ScoreChip,
  ToastProvider,
  useToast,
} from "@goblins/ui";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CellDetail } from "../../../components/teacher/dashboard/CellDetail";
import {
  type DashboardProblem,
  gradeKey,
  gradeStatus,
  studentLabel,
} from "../../../components/teacher/dashboard/model";
import { TeacherHeader } from "../../../components/teacher/TeacherHeader";
import {
  type SessionRow,
  type StudentRow,
  type TeacherGradeRow,
  teacherGrades,
  teacherSession,
  teacherStudents,
} from "../../../lib/sync";
import { accept, renameStudent, retry, splitStudent } from "../../../server/fns/grading";
import { endSession, getSession, setHideNames, startSession } from "../../../server/fns/sessions";

export const Route = createFileRoute("/sessions/$sessionId/")({
  // Live data comes from Electric in the browser.
  ssr: false,
  loader: ({ params }) => getSession({ data: { sessionId: params.sessionId } }),
  head: () => ({ meta: [{ title: "Dashboard · Goblins Auto-Grader" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const loaded = Route.useLoaderData();
  const { sessionId } = Route.useParams();
  if (loaded._tag === "Err") {
    return (
      <div className="min-h-dvh bg-bg">
        <TeacherHeader />
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="text-xl">This dashboard belongs to another account</h1>
          <p className="mt-2 text-text-muted">Sign in as the teacher who launched this session.</p>
        </main>
      </div>
    );
  }
  return (
    <ToastProvider>
      <Dashboard
        sessionId={sessionId}
        title={loaded.value.assignmentTitle}
        joinCode={loaded.value.joinCode}
        problems={loaded.value.problems}
        hideNamesInitially={loaded.value.teacher.hideNamesAndScores}
      />
    </ToastProvider>
  );
}

type Selected = { readonly studentId: string; readonly problemId: string } | null;

function Dashboard(props: {
  readonly sessionId: string;
  readonly title: string;
  readonly joinCode: string;
  readonly problems: ReadonlyArray<DashboardProblem>;
  readonly hideNamesInitially: boolean;
}) {
  const { data: sessions } = useLiveQuery((q) =>
    q.from({ session: teacherSession(props.sessionId) }),
  );
  const { data: students } = useLiveQuery((q) =>
    q
      .from({ student: teacherStudents(props.sessionId) })
      .orderBy(({ student }) => student.createdAt, "asc"),
  );
  const { data: grades } = useLiveQuery((q) => q.from({ grade: teacherGrades(props.sessionId) }));
  const [hideNames, setHide] = useState(props.hideNamesInitially);
  const [selected, setSelected] = useState<Selected>(null);

  const gradeByCell = useMemo(
    () => new Map(grades.map((grade) => [gradeKey(grade.studentId, grade.problemId), grade])),
    [grades],
  );
  const labelOf = (student: StudentRow) =>
    studentLabel(
      student,
      students.findIndex((s) => s.id === student.id),
      hideNames,
    );
  const session = sessions[0];

  const toggleHide = async () => {
    const next = !hideNames;
    setHide(next);
    await setHideNames({ data: { hide: next } });
  };

  const selectedGrade =
    selected === null
      ? undefined
      : gradeByCell.get(gradeKey(selected.studentId, selected.problemId));
  const selectedStudent = students.find((s) => s.id === selected?.studentId);
  const selectedProblem = props.problems.find((p) => p.id === selected?.problemId);

  return (
    <div className="min-h-dvh bg-bg">
      <TeacherHeader>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate font-extrabold text-brand text-lg">{props.title}</h1>
          {session !== undefined && <StatusPill status={session.status} />}
        </div>
        <SessionControls
          sessionId={props.sessionId}
          session={session}
          joinCode={props.joinCode}
          hideNames={hideNames}
          onToggleHide={toggleHide}
          canStart={students.length > 0}
        />
      </TeacherHeader>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Summary
          students={students}
          grades={grades}
          problems={props.problems}
          hideScores={hideNames}
        />

        <NeedsYou
          grades={grades}
          students={students}
          problems={props.problems}
          labelOf={labelOf}
          hideScores={hideNames}
          onOpen={(grade) =>
            setSelected({ studentId: grade.studentId, problemId: grade.problemId })
          }
        />

        <Grid
          sessionId={props.sessionId}
          students={students}
          problems={props.problems}
          gradeByCell={gradeByCell}
          hideNames={hideNames}
          labelOf={labelOf}
          onOpen={(studentId, problemId) => setSelected({ studentId, problemId })}
        />
      </main>

      {selectedGrade !== undefined &&
        selectedStudent !== undefined &&
        selectedProblem !== undefined && (
          <CellDetail
            open
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
            student={selectedStudent}
            studentLabel={labelOf(selectedStudent)}
            problem={selectedProblem}
            grade={selectedGrade}
          />
        )}
    </div>
  );
}

function StatusPill({ status }: { readonly status: SessionRow["status"] }) {
  const look = {
    lobby: { label: "Lobby", className: "bg-sun-100 text-green-800" },
    live: { label: "Live", className: "bg-lime-100 text-green-800" },
    ended: { label: "Ended", className: "bg-surface-sunken text-text-muted" },
  }[status];
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 font-bold text-sm ${look.className}`}
    >
      {status === "live" && (
        <span className="size-2 animate-pulse rounded-full bg-green-600" aria-hidden="true" />
      )}
      {look.label}
    </span>
  );
}

function SessionControls(props: {
  readonly sessionId: string;
  readonly session: SessionRow | undefined;
  readonly joinCode: string;
  readonly hideNames: boolean;
  readonly onToggleHide: () => void;
  readonly canStart: boolean;
}) {
  const [ending, setEnding] = useState(false);
  const status = props.session?.status;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {status !== "ended" && (
        <span className="hidden rounded-md bg-surface-sunken px-3 py-1.5 font-bold text-brand text-sm tabular-nums md:inline">
          Code {props.joinCode}
        </span>
      )}
      <Button variant="ghost" size="sm" aria-pressed={props.hideNames} onClick={props.onToggleHide}>
        {props.hideNames ? "Show names and scores" : "Hide names and scores"}
      </Button>
      {status !== "ended" && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            window.open(
              `/sessions/${props.sessionId}/projector`,
              `projector-${props.sessionId}`,
              "popup,width=1280,height=800",
            )
          }
        >
          Open projector
        </Button>
      )}
      {status === "lobby" && (
        <Button
          size="sm"
          disabled={!props.canStart}
          onClick={() => startSession({ data: { sessionId: props.sessionId } })}
        >
          Start
        </Button>
      )}
      {status === "live" && (
        <Dialog
          trigger={
            <Button variant="brand" size="sm">
              End session
            </Button>
          }
          title="End the session?"
          description="Students can't join or submit after this. Grading that's already underway still finishes."
          size="sm"
          actions={
            <>
              <DialogClose>
                <Button variant="ghost">Keep going</Button>
              </DialogClose>
              <Button
                variant="brand"
                disabled={ending}
                onClick={async () => {
                  setEnding(true);
                  await endSession({ data: { sessionId: props.sessionId } });
                }}
              >
                End session
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function Summary(props: {
  readonly students: ReadonlyArray<StudentRow>;
  readonly grades: ReadonlyArray<TeacherGradeRow>;
  readonly problems: ReadonlyArray<DashboardProblem>;
  readonly hideScores: boolean;
}) {
  const graded = props.grades.filter((g) => g.state === "graded");
  const earned = graded.reduce((sum, g) => sum + (g.points ?? 0), 0);
  const possible = graded.reduce((sum, g) => sum + g.maxPoints, 0);
  const stats = [
    { label: "Joined", value: String(props.students.length) },
    {
      label: "Submitted",
      value: `${props.grades.length} of ${props.students.length * props.problems.length}`,
    },
    { label: "Graded", value: String(graded.length) },
    {
      label: "Average so far",
      value: props.hideScores || possible === 0 ? "–" : `${Math.round((earned / possible) * 100)}%`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} padding="sm">
          <dt className="text-sm text-text-muted">{stat.label}</dt>
          <dd className="font-black text-2xl text-brand tabular-nums">{stat.value}</dd>
        </Card>
      ))}
    </dl>
  );
}

function NeedsYou(props: {
  readonly grades: ReadonlyArray<TeacherGradeRow>;
  readonly students: ReadonlyArray<StudentRow>;
  readonly problems: ReadonlyArray<DashboardProblem>;
  readonly labelOf: (student: StudentRow) => string;
  readonly hideScores: boolean;
  readonly onOpen: (grade: TeacherGradeRow) => void;
}) {
  const toast = useToast();
  const problemIndex = (id: string) => props.problems.findIndex((p) => p.id === id);
  const studentIndex = (id: string) => props.students.findIndex((s) => s.id === id);
  const waiting = props.grades
    .filter((g) => g.state === "needs_teacher" || g.state === "couldnt_grade")
    // A stable order (problem, then join order), so cards don't move while the teacher works.
    .toSorted(
      (a, b) =>
        problemIndex(a.problemId) - problemIndex(b.problemId) ||
        studentIndex(a.studentId) - studentIndex(b.studentId),
    );
  if (waiting.length === 0) {
    return (
      <section
        aria-labelledby="needs-you"
        className="flex items-center gap-3 rounded-lg bg-success-soft px-4 py-3"
      >
        <h2 id="needs-you" className="font-bold text-success">
          Nothing needs you right now.
        </h2>
        <p className="text-sm text-text-muted">
          Grades the grader is unsure about will show up here.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="needs-you">
      <h2 id="needs-you" className="mb-3 text-lg">
        Needs you <span className="text-text-muted">({waiting.length})</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {waiting.map((grade) => {
          const student = props.students.find((s) => s.id === grade.studentId);
          const problem = props.problems.find((p) => p.id === grade.problemId);
          if (student === undefined || problem === undefined) return null;
          const guess = (grade.modelLinePoints ?? []).reduce((sum, p) => sum + p.points, 0);
          return (
            <li key={grade.submissionId}>
              <Card padding="sm" className="flex items-start gap-3">
                <Avatar kind="creature" creatureId={student.avatarId} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {props.labelOf(student)} · Problem {problem.label}
                  </p>
                  <p className="text-sm text-text-muted">
                    {grade.state === "needs_teacher" ? grade.flagReason : grade.failureReason}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {grade.state === "needs_teacher" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const result = await accept({
                            data: { submissionId: grade.submissionId },
                          });
                          if (result._tag === "Err")
                            toast({ title: "This grade was already resolved", tone: "neutral" });
                        }}
                      >
                        {props.hideScores ? "Accept" : `Accept ${guess}/${grade.maxPoints}`}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => retry({ data: { submissionId: grade.submissionId } })}
                      >
                        Try again
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => props.onOpen(grade)}>
                      {grade.state === "needs_teacher" ? "Look at the work" : "Score it myself"}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Grid(props: {
  readonly sessionId: string;
  readonly students: ReadonlyArray<StudentRow>;
  readonly problems: ReadonlyArray<DashboardProblem>;
  readonly gradeByCell: ReadonlyMap<string, TeacherGradeRow>;
  readonly hideNames: boolean;
  readonly labelOf: (student: StudentRow) => string;
  readonly onOpen: (studentId: string, problemId: string) => void;
}) {
  const [renaming, setRenaming] = useState<StudentRow | null>(null);
  const [splitting, setSplitting] = useState<StudentRow | null>(null);
  if (props.students.length === 0) {
    return (
      <Card className="py-12 text-center">
        <p className="text-lg">No one has joined yet.</p>
        <p className="mt-1 text-text-muted">
          Students join from the projector screen with the code.
        </p>
      </Card>
    );
  }
  return (
    <section aria-labelledby="class-grid">
      <h2 id="class-grid" className="sr-only">
        Students and problems
      </h2>
      <Card padding="sm" className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-bold text-text-muted"
              >
                Student
              </th>
              {props.problems.map((problem) => (
                <th
                  key={problem.id}
                  scope="col"
                  className="px-1 py-2 text-center font-bold text-text-muted"
                >
                  {problem.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-bold text-text-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {props.students.map((student) => {
              const rowGrades = props.problems.map((p) =>
                props.gradeByCell.get(gradeKey(student.id, p.id)),
              );
              const earned = rowGrades.reduce(
                (sum, g) => sum + (g?.state === "graded" ? (g.points ?? 0) : 0),
                0,
              );
              const possible = props.problems.reduce(
                (sum, p) => sum + p.rubricLines.reduce((s, l) => s + l.points, 0),
                0,
              );
              return (
                <tr key={student.id} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal group-hover:bg-surface-sunken"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar kind="creature" creatureId={student.avatarId} size="xs" />
                      <span className="truncate font-bold">{props.labelOf(student)}</span>
                      {!props.hideNames && (
                        <Menu
                          align="start"
                          trigger={
                            <button
                              type="button"
                              aria-label={`Actions for ${student.displayName}`}
                              className="rounded px-1 text-text-subtle opacity-0 hover:text-text group-hover:opacity-100 focus:opacity-100"
                            >
                              ⋯
                            </button>
                          }
                          entries={[
                            { kind: "item", label: "Rename", onSelect: () => setRenaming(student) },
                            {
                              kind: "item",
                              label: "Split into two students",
                              onSelect: () => setSplitting(student),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </th>
                  {props.problems.map((problem, i) => {
                    const grade = rowGrades[i];
                    const status = gradeStatus(grade);
                    return (
                      <td
                        key={problem.id}
                        className="px-1 py-1.5 text-center group-hover:bg-surface-sunken"
                      >
                        {props.hideNames ? (
                          <span
                            role="img"
                            aria-label={grade === undefined ? "Not started" : "Submitted"}
                            className={`inline-block size-3 rounded-full ${grade === undefined ? "bg-border" : "bg-brand"}`}
                          />
                        ) : grade === undefined ? (
                          <ScoreChip status={status} size="sm" />
                        ) : (
                          <button
                            type="button"
                            className="rounded-full focus-visible:outline-2"
                            aria-label={`${student.displayName}, problem ${problem.label}`}
                            onClick={() => props.onOpen(student.id, problem.id)}
                          >
                            <ScoreChip status={status} size="sm" />
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-bold tabular-nums group-hover:bg-surface-sunken">
                    {props.hideNames ? "–" : `${earned}/${possible}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {renaming !== null && (
        <RenameDialog
          sessionId={props.sessionId}
          student={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {splitting !== null && (
        <SplitDialog
          sessionId={props.sessionId}
          student={splitting}
          problems={props.problems}
          gradeByCell={props.gradeByCell}
          onClose={() => setSplitting(null)}
        />
      )}
    </section>
  );
}

const nameError = (tag: string) =>
  tag === "NameTaken"
    ? "Someone in this class already has that name."
    : tag === "InvalidName"
      ? "Type a name with at least one letter."
      : "That didn't save. Try again.";

function RenameDialog(props: {
  readonly sessionId: string;
  readonly student: StudentRow;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(props.student.displayName);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      size="sm"
      title={`Rename ${props.student.displayName}`}
      description="The student types the new name to pick up where they left off."
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={async () => {
              const result = await renameStudent({
                data: { sessionId: props.sessionId, studentId: props.student.id, name },
              });
              if (result._tag === "Ok") props.onClose();
              else setError(nameError(result.error._tag));
            }}
          >
            Rename
          </Button>
        </>
      }
    >
      <Field label="Name" error={error}>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
      </Field>
    </Dialog>
  );
}

function SplitDialog(props: {
  readonly sessionId: string;
  readonly student: StudentRow;
  readonly problems: ReadonlyArray<DashboardProblem>;
  readonly gradeByCell: ReadonlyMap<string, TeacherGradeRow>;
  readonly onClose: () => void;
}) {
  const submitted = props.problems.flatMap((problem) => {
    const grade = props.gradeByCell.get(gradeKey(props.student.id, problem.id));
    return grade === undefined ? [] : [{ problem, grade }];
  });
  const [name, setName] = useState("");
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={`Split ${props.student.displayName} into two students`}
      description="Use this when two students joined under the same name. Pick the work that belongs to the second student; they rejoin with the new name."
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={async () => {
              const result = await splitStudent({
                data: {
                  sessionId: props.sessionId,
                  studentId: props.student.id,
                  newName: name,
                  submissionIds: [...moving],
                },
              });
              if (result._tag === "Ok") props.onClose();
              else setError(nameError(result.error._tag));
            }}
          >
            Split
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="The second student's name" error={error}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex P."
            maxLength={40}
          />
        </Field>
        {submitted.length > 0 && (
          <fieldset>
            <legend className="mb-2 font-bold text-sm text-text-muted">
              Work that belongs to them
            </legend>
            <ul className="flex flex-wrap gap-2">
              {submitted.map(({ problem, grade }) => (
                <li key={grade.submissionId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 has-checked:border-brand has-checked:bg-brand-soft">
                    <input
                      type="checkbox"
                      checked={moving.has(grade.submissionId)}
                      onChange={(event) =>
                        setMoving((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(grade.submissionId);
                          else next.delete(grade.submissionId);
                          return next;
                        })
                      }
                    />
                    Problem {problem.label}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <p className="text-sm text-text-muted">
          <Link to="/join" className="underline">
            /join
          </Link>{" "}
          with the same code and the new name.
        </p>
      </div>
    </Dialog>
  );
}
