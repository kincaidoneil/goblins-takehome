import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { Projector } from "../../../components/teacher/dashboard/Projector";
import { teacherGrades, teacherSession, teacherStudents } from "../../../lib/sync";
import { getSession, startSession } from "../../../server/fns/sessions";

export const Route = createFileRoute("/sessions/$sessionId/projector")({
  // Live data comes from Electric in the browser.
  ssr: false,
  loader: ({ params }) => getSession({ data: { sessionId: params.sessionId } }),
  head: () => ({ meta: [{ title: "Projector · Goblins Grader" }] }),
  component: ProjectorPage,
});

function ProjectorPage() {
  const loaded = Route.useLoaderData();
  const { sessionId } = Route.useParams();
  if (loaded._tag === "Err") {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-8 text-center">
        <p className="text-xl">
          Sign in as the class's teacher in this browser to show the projector.
        </p>
      </main>
    );
  }
  return (
    <LiveProjector
      sessionId={sessionId}
      joinCode={loaded.value.joinCode}
      title={loaded.value.assignmentTitle}
      problemCount={loaded.value.problems.length}
    />
  );
}

function LiveProjector(props: {
  readonly sessionId: string;
  readonly joinCode: string;
  readonly title: string;
  readonly problemCount: number;
}) {
  const { data: sessions } = useLiveQuery((q) =>
    q.from({ session: teacherSession(props.sessionId) }),
  );
  const { data: students } = useLiveQuery((q) =>
    q.from({ student: teacherStudents(props.sessionId) }),
  );
  // Every submission has a grade row, so the grade count is the submission count.
  const { data: grades } = useLiveQuery((q) => q.from({ grade: teacherGrades(props.sessionId) }));
  const session = sessions[0];
  if (session === undefined) return <main className="min-h-dvh bg-bg" aria-busy="true" />;
  return (
    <Projector
      title={props.title}
      joinCode={props.joinCode}
      joinUrl={`${window.location.origin}/join`}
      problemCount={props.problemCount}
      session={session}
      students={students}
      submittedCount={grades.length}
      onStart={async () => {
        await startSession({ data: { sessionId: props.sessionId } });
      }}
    />
  );
}
