import { SignInButton } from "@clerk/tanstack-react-start";
import { Button, EmptyState } from "@goblins/ui";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { teacherGrades, teacherSession, teacherStudents } from "../../../lib/sync";
import { TeacherReport } from "../../../report/components/TeacherReport";
import type { ProblemMistakes } from "../../../report/mistakes";
import { buildReport, type ReportInput } from "../../../report/model";
import type { ReportHeader } from "../../../server/report/data";
import { getMistakes, getReport, shareReport } from "../../../server/report/fns";

/**
 * The teacher's report for one class session. The problems load once; students and grades are
 * live collections, so the report updates as pending grades resolve.
 */
export const Route = createFileRoute("/sessions/$sessionId/report")({
  // Live collections read from the browser.
  ssr: false,
  loader: ({ params }) => getReport({ data: { sessionId: params.sessionId } }),
  head: () => ({ meta: [{ title: "Class report · Goblins Grader" }] }),
  component: ReportPage,
});

function ReportPage() {
  const result = Route.useLoaderData();
  const { sessionId } = Route.useParams();
  if (result._tag === "Ok") {
    return (
      <LiveReport
        sessionId={sessionId}
        header={result.value.header}
        snapshot={result.value.snapshot}
      />
    );
  }
  switch (result.error._tag) {
    case "NotSignedIn":
      return (
        <Centered
          title="Sign in to see this report"
          description="Reports are private to the teacher who ran the class."
        >
          <SignInButton mode="modal">
            <Button>Sign in with Google</Button>
          </SignInButton>
        </Centered>
      );
    case "ReportNotFound":
      return (
        <Centered
          title="We couldn’t find this report"
          description="It may belong to another teacher’s account, or the link is incomplete."
        >
          <Link to="/" className="gb-button no-underline" data-variant="secondary" data-size="md">
            Go to your assignments
          </Link>
        </Centered>
      );
  }
}

function Centered({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <EmptyState title={title} description={description} actions={children} />
    </main>
  );
}

function LiveReport({
  sessionId,
  header,
  snapshot,
}: {
  readonly sessionId: string;
  readonly header: ReportHeader;
  /** What the server read at load time. */
  readonly snapshot: ReportInput;
}) {
  const sessions = useLiveQuery(() => teacherSession(sessionId), [sessionId]);
  const students = useLiveQuery(() => teacherStudents(sessionId), [sessionId]);
  const grades = useLiveQuery(() => teacherGrades(sessionId), [sessionId]);
  const live = sessions.isReady && students.isReady && grades.isReady;
  // Previews and some school networks have no sync; the snapshot still makes a full report.
  const syncFailed = sessions.isError || students.isError || grades.isError;

  const input: ReportInput = useMemo(
    () =>
      live
        ? {
            problems: snapshot.problems,
            students: [...(students.data ?? [])].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            ),
            grades: grades.data ?? [],
          }
        : snapshot,
    [live, snapshot, students.data, grades.data],
  );

  // Regroup mistakes when the missed grades on weak problems change, not on every grade update.
  const signature = useMemo(() => {
    const report = buildReport(input);
    return report.weak
      .map((w) => `${w.problem.id}:${w.misses.map((m) => `${m.student.id}/${m.points}`).join(",")}`)
      .join(";");
  }, [input]);
  const [mistakes, setMistakes] = useState<ReadonlyArray<ProblemMistakes>>([]);
  useEffect(() => {
    if (signature === "") return;
    let current = true;
    void getMistakes({ data: { sessionId } }).then((result) => {
      if (current && result._tag === "Ok") setMistakes(result.value);
    });
    return () => {
      current = false;
    };
  }, [sessionId, signature]);

  const createShareLink = async () => {
    const result = await shareReport({ data: { sessionId } });
    return result._tag === "Ok"
      ? new URL(`/share/${result.value.token}`, window.location.origin).toString()
      : null;
  };

  const endedAt = (live ? sessions.data?.[0]?.endedAt : undefined) ?? header.endedAt;
  return (
    <TeacherReport
      meta={{ title: header.title, course: null, topic: header.title, endedAt }}
      input={input}
      mistakes={mistakes}
      dashboardHref={`/sessions/${sessionId}`}
      createShareLink={createShareLink}
      notice={
        syncFailed ? (
          <p className="m-0 px-1 text-sm text-text-muted" data-testid="sync-off">
            Live updates are off here. Reload the page to see newly checked grades.
          </p>
        ) : undefined
      }
    />
  );
}
