import { Badge, type BadgeTone, Button, Card, EmptyState } from "@goblins/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TeacherHeader } from "../components/teacher/TeacherHeader";
import { SignInTrigger } from "../lib/auth";
import {
  type AssignmentSummary,
  type ClassSessionSummary,
  listClasses,
} from "../server/fns/classes";

/** The teacher's home: their assignments and class sessions, from any device they sign in on. */
export const Route = createFileRoute("/classes")({
  ssr: false,
  loader: () => listClasses(),
  head: () => ({ meta: [{ title: "My classes · Goblins Grader" }] }),
  component: ClassesPage,
});

const newAssignment = (
  <Link
    to="/"
    search={{ new: 1 }}
    className="gb-button no-underline"
    data-variant="primary"
    data-size="md"
  >
    New assignment
  </Link>
);

function ClassesPage() {
  const result = Route.useLoaderData();
  return (
    <div className="min-h-dvh bg-bg">
      <TeacherHeader>
        <h1 className="truncate font-extrabold text-brand text-lg">My classes</h1>
      </TeacherHeader>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
        {result._tag === "Err" ? (
          <EmptyState
            title="Sign in to see your classes"
            description="Your assignments, live classes and reports are saved to your account."
            actions={
              <SignInTrigger redirectUrl="/classes">
                <Button>Sign in with Google</Button>
              </SignInTrigger>
            }
          />
        ) : result.value.length === 0 ? (
          <EmptyState
            title="No assignments yet"
            description="Drop in a worksheet or pick a template to set up your first one."
            actions={newAssignment}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <p className="text-text-muted">
                {result.value.length} {result.value.length === 1 ? "assignment" : "assignments"}
              </p>
              {newAssignment}
            </div>
            <ul className="flex flex-col gap-4" data-testid="class-list">
              {result.value.map((assignment) => (
                <li key={assignment.id}>
                  <AssignmentCard assignment={assignment} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function AssignmentCard({ assignment }: { readonly assignment: AssignmentSummary }) {
  const title = assignment.title === "" ? "Untitled assignment" : assignment.title;
  return (
    <Card padding="md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-extrabold text-lg">{title}</h2>
        <span className="text-sm text-text-muted">{dateLabel(assignment.createdAt)}</span>
      </div>
      {assignment.sessions.length === 0 ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <Badge tone="neutral">Draft</Badge>
          <Link
            to="/setup/$draftId"
            params={{ draftId: assignment.id }}
            className="font-bold text-brand no-underline hover:underline"
          >
            Continue setup
          </Link>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {assignment.sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
    </Card>
  );
}

const statusBadge: Record<ClassSessionSummary["status"], { label: string; tone: BadgeTone }> = {
  lobby: { label: "Waiting to start", tone: "info" },
  live: { label: "Live", tone: "success" },
  ended: { label: "Ended", tone: "neutral" },
};

function SessionRow({ session }: { readonly session: ClassSessionSummary }) {
  const badge = statusBadge[session.status];
  const students = `${session.studentCount} ${session.studentCount === 1 ? "student" : "students"}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <span className="text-sm text-text-muted">
          {dateLabel(session.createdAt)} · {students}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="font-bold text-brand no-underline hover:underline"
        >
          Dashboard
        </Link>
        {session.status === "ended" && (
          <Link
            to="/sessions/$sessionId/report"
            params={{ sessionId: session.id }}
            className="font-bold text-brand no-underline hover:underline"
          >
            Report
          </Link>
        )}
      </div>
    </li>
  );
}
