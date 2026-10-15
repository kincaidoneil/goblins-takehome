/**
 * The student's session: lobby, one problem at a time on a whiteboard, a short transition after
 * each submit, and a summary (PRD, "Student work").
 *
 * Live state comes from Electric (session status, the student's own grades). Submissions go
 * through a localStorage outbox so a dropped connection never loses work.
 *
 * E2E scenario (there is no `e2e/` package on this branch yet; add it there when it lands):
 * 1. Seed a lobby session; a student joins as "Maya R." and sees the lobby with their creature.
 * 2. Set the session live; the first problem opens without a reload.
 * 3. Submit is disabled on an empty board. Draw a stroke, reload: the stroke is still there.
 * 4. Submit. The transition cheers ("Nice work!"), then problem 2 opens. Within a few seconds
 *    the strip shows 2/2 on problem 1.
 * 5. A student named "Flag F." sees "Teacher will check" for that problem, never an error.
 * 6. Go offline (context.setOffline), submit problem 2: "Saved. We'll send it when you're back
 *    online." Go online: it sends, and the summary shows both problems.
 * 7. End the session: the student sees "Your teacher ended the session" and their scores.
 */
import { Avatar, type GradeStatus, ProgressStrip, SubmitTransition } from "@goblins/ui";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Schema } from "effect";
import { useMemo, useState } from "react";
import { gradeStatus, nextOpenProblem } from "../../components/student/grades";
import { JoinAgain, Lobby, Summary } from "../../components/student/screens";
import { useOutbox } from "../../components/student/useOutbox";
import { TimeLeft, Workspace } from "../../components/student/Workspace";
import "../../components/student/student.css";
import { studentGrades, studentSession } from "../../lib/sync";
import { getStudentWork, type StudentWork } from "../../server/fns/student";

const isUuid = Schema.is(Schema.UUID);

export const Route = createFileRoute("/play/$sessionId")({
  // Live collections need the browser; there is nothing useful to render on the server.
  ssr: false,
  loader: async ({ params }) => {
    if (!isUuid(params.sessionId)) throw redirect({ to: "/join" });
    const result = await getStudentWork({ data: { sessionId: params.sessionId } });
    if (result._tag === "Err") {
      const { joinCode } = result.error;
      throw redirect({ to: "/join", search: joinCode === null ? {} : { code: joinCode } });
    }
    return result.value;
  },
  head: () => ({ meta: [{ title: "Your class · Goblins" }] }),
  component: Play,
});

/** Where the student is, apart from what the live session status decides. */
type View =
  | { readonly _tag: "Working"; readonly problemId: string }
  | { readonly _tag: "Transition"; readonly problemId: string }
  | { readonly _tag: "Summary" }
  /** A submit was refused because the session ended before the live status arrived. */
  | { readonly _tag: "Ended" }
  /** A submit was refused because the student is no longer in the session. */
  | { readonly _tag: "NotJoined" };

type Problem = StudentWork["problems"][number];

/** What is on screen. One of these at a time. */
type Screen =
  | { readonly _tag: "Lobby" }
  | { readonly _tag: "Working"; readonly problem: Problem }
  | { readonly _tag: "Transition"; readonly problem: Problem; readonly next: Problem | null }
  | { readonly _tag: "Summary" }
  | { readonly _tag: "Ended" }
  | { readonly _tag: "NotJoined" };

function Play() {
  const work = Route.useLoaderData();
  const { sessionId } = Route.useParams();
  const { data: sessionRows } = useLiveQuery(studentSession(sessionId));
  const { data: gradeRows } = useLiveQuery(studentGrades(sessionId));
  const session = sessionRows?.[0] ?? work.session;

  const [view, setView] = useState<View>(() => {
    const first = nextOpenProblem(
      work.problems,
      (id) => !work.submittedProblemIds.includes(id),
      null,
    );
    return first === null ? { _tag: "Summary" } : { _tag: "Working", problemId: first.id };
  });

  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set(work.submittedProblemIds));
  const outbox = useOutbox(
    { sessionId, studentId: work.student.id },
    {
      onSent: (problemId) => setSent((current) => new Set(current).add(problemId)),
      onRejected: (_problemId, error) => {
        switch (error._tag) {
          case "SessionNotLive":
            setView({ _tag: "Ended" });
            return;
          case "NotJoined":
            setView({ _tag: "NotJoined" });
            return;
          case "UnknownProblem":
          case "InvalidImage":
            // Not expected from this client. The problem unlocks with its strokes intact.
            return;
        }
      },
    },
  );

  const statuses = useMemo(() => {
    const byProblem = new Map<string, GradeStatus>();
    for (const row of gradeRows ?? []) byProblem.set(row.problemId, gradeStatus(row));
    const waiting = new Set(outbox.items.map((item) => item.problemId));
    return new Map(
      work.problems.map((p): [string, GradeStatus] => [
        p.id,
        byProblem.get(p.id) ??
          (sent.has(p.id) || waiting.has(p.id) ? { state: "grading" } : { state: "not-started" }),
      ]),
    );
  }, [gradeRows, outbox.items, sent, work.problems]);
  const statusOf = (id: string): GradeStatus => statuses.get(id) ?? { state: "not-started" };
  const isOpen = (id: string) => statusOf(id).state === "not-started";

  const screen = ((): Screen => {
    if (view._tag === "NotJoined") return view;
    if (session.status === "ended" || view._tag === "Ended") return { _tag: "Ended" };
    if (session.status === "lobby") return { _tag: "Lobby" };
    const find = (id: string) => work.problems.find((p) => p.id === id);
    switch (view._tag) {
      case "Summary":
        return view;
      case "Transition": {
        const problem = find(view.problemId);
        if (problem === undefined) return { _tag: "Summary" };
        return {
          _tag: "Transition",
          problem,
          next: nextOpenProblem(work.problems, isOpen, problem.id),
        };
      }
      case "Working": {
        // The problem may have been submitted meanwhile, e.g. from another device.
        const current = find(view.problemId);
        const problem =
          current !== undefined && isOpen(current.id)
            ? current
            : nextOpenProblem(work.problems, isOpen, view.problemId);
        return problem === null ? { _tag: "Summary" } : { _tag: "Working", problem };
      }
    }
  })();

  const submitProblem = (problemId: string, png: string) => {
    outbox.add({ problemId, png, submittedAt: new Date().toISOString() });
    setView({ _tag: "Transition", problemId });
  };

  const savedOffline = (problemId: string) =>
    outbox.waitingForNetwork && outbox.items.some((item) => item.problemId === problemId);

  const rows = work.problems.map((p) => ({ id: p.id, label: p.label, status: statusOf(p.id) }));
  const working = screen._tag === "Working" || screen._tag === "Transition";
  const currentId =
    screen._tag === "Working"
      ? screen.problem.id
      : screen._tag === "Transition"
        ? (screen.next?.id ?? screen.problem.id)
        : "";

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-2 px-4 pt-3 pb-2 md:px-5">
        <Avatar
          kind="creature"
          creatureId={work.student.avatarId}
          name={work.student.displayName}
          size="sm"
        />
        <span className="font-bold text-text-brand">{work.student.displayName}</span>
        {working && session.timeLimitMinutes !== null && session.startedAt !== null && (
          <span className="ml-auto">
            <TimeLeft startedAt={session.startedAt} limitMinutes={session.timeLimitMinutes} />
          </span>
        )}
      </header>

      {working && (
        <ProgressStrip
          className="shrink-0 px-3 md:px-5"
          problems={rows}
          currentId={currentId}
          onSelect={(problemId) => setView({ _tag: "Working", problemId })}
        />
      )}

      {outbox.waitingForNetwork && screen._tag !== "Transition" && <OfflineNotice />}

      {(() => {
        switch (screen._tag) {
          case "Lobby":
            return <Lobby name={work.student.displayName} avatarId={work.student.avatarId} />;
          case "Working":
            return (
              <Workspace
                key={screen.problem.id}
                sessionId={sessionId}
                studentId={work.student.id}
                problem={screen.problem}
                total={work.problems.length}
                pages={work.pages}
                onSubmit={(png) => submitProblem(screen.problem.id, png)}
              />
            );
          case "Transition":
            return (
              <SubmitTransition
                key={screen.problem.id}
                creatureId={work.student.avatarId}
                problemIndex={work.problems.findIndex((p) => p.id === screen.problem.id)}
                nextLabel={screen.next?.label}
                grade={statusOf(screen.problem.id)}
                offline={savedOffline(screen.problem.id)}
                onDone={() =>
                  setView(
                    screen.next === null
                      ? { _tag: "Summary" }
                      : { _tag: "Working", problemId: screen.next.id },
                  )
                }
              />
            );
          case "Summary":
          case "Ended":
            return (
              <Summary
                name={work.student.displayName}
                avatarId={work.student.avatarId}
                rows={rows}
                ended={screen._tag === "Ended"}
              />
            );
          case "NotJoined":
            return <JoinAgain joinCode={null} />;
        }
      })()}
    </div>
  );
}

function OfflineNotice() {
  return (
    <p
      role="status"
      className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-full bg-sun-100 px-4 py-2 text-center text-sm font-bold text-text-brand md:mx-5"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 18a4.5 4.5 0 01-.6-9A6 6 0 0118 8.5a4.5 4.5 0 01-1 9.5H7z" />
        <path d="M9.5 13l2 2 3.5-3.5" />
      </svg>
      Saved. We'll send it when you're back online.
    </p>
  );
}
