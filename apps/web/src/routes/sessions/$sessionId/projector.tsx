import { Avatar, Button } from "@goblins/ui";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { teacherGrades, teacherSession, teacherStudents } from "../../../lib/sync";
import { getSession, startSession } from "../../../server/fns/sessions";

export const Route = createFileRoute("/sessions/$sessionId/projector")({
  // Live data comes from Electric in the browser.
  ssr: false,
  loader: ({ params }) => getSession({ data: { sessionId: params.sessionId } }),
  head: () => ({ meta: [{ title: "Projector · Goblins" }] }),
  component: Projector,
});

/** "482913" → "482 913", easier to read from the back of a room. */
const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

function Projector() {
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
    q
      .from({ student: teacherStudents(props.sessionId) })
      .orderBy(({ student }) => student.createdAt, "asc"),
  );
  // Every submission has a grade row, so the grade count is the submission count.
  const { data: done } = useLiveQuery((q) => q.from({ grade: teacherGrades(props.sessionId) }));
  const session = sessions[0];
  const joinUrl = `${window.location.origin}/join?code=${props.joinCode}`;

  return (
    <main className="flex min-h-dvh flex-col bg-bg" style={{ backgroundImage: "var(--gb-glow)" }}>
      {session === undefined ? null : session.status === "lobby" ? (
        <Lobby
          sessionId={props.sessionId}
          joinCode={props.joinCode}
          joinUrl={joinUrl}
          title={props.title}
          students={students}
        />
      ) : (
        <Running
          status={session.status}
          startedAt={session.startedAt}
          timeLimitMinutes={session.timeLimitMinutes}
          joinCode={props.joinCode}
          submitted={done.length}
          possible={students.length * props.problemCount}
        />
      )}
    </main>
  );
}

function Lobby(props: {
  readonly sessionId: string;
  readonly joinCode: string;
  readonly joinUrl: string;
  readonly title: string;
  readonly students: ReadonlyArray<{ id: string; displayName: string; avatarId: number }>;
}) {
  const [starting, setStarting] = useState(false);
  const host = new URL(props.joinUrl).host;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-10 py-12">
      <div className="flex flex-wrap items-center justify-center gap-12">
        <div className="text-center">
          <p className="text-xl text-text-muted">
            Go to <span className="font-extrabold text-brand">{host}/join</span> and enter
          </p>
          <p
            className="mt-2 font-black text-brand tabular-nums tracking-wider"
            style={{ fontSize: "var(--gb-text-code)", lineHeight: 1 }}
          >
            <span className="sr-only">Join code {props.joinCode.split("").join(" ")}</span>
            <span aria-hidden="true">{spacedCode(props.joinCode)}</span>
          </p>
          <p className="mt-4 text-lg text-text-muted">{props.title}</p>
        </div>
        <div className="rounded-xl bg-surface p-5 shadow-md">
          <QRCodeSVG
            value={props.joinUrl}
            size={220}
            fgColor="#1b6f4f"
            aria-label="QR code to join"
          />
          <p className="mt-2 text-center text-sm text-text-muted">Or scan to join</p>
        </div>
      </div>

      <section aria-live="polite" className="flex-1">
        <h2 className="mb-6 text-center text-xl">
          {props.students.length === 0
            ? "Waiting for the first student…"
            : `${props.students.length} ${props.students.length === 1 ? "student has" : "students have"} joined`}
        </h2>
        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-5">
          {props.students.map((student) => (
            <li key={student.id} className="flex w-28 animate-pop flex-col items-center gap-2">
              <Avatar
                kind="creature"
                creatureId={student.avatarId}
                size="lg"
                name={student.displayName}
              />
              <span className="max-w-full truncate font-bold text-lg">{student.displayName}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex justify-center">
        <Button
          size="lg"
          disabled={starting || props.students.length === 0}
          onClick={async () => {
            setStarting(true);
            await startSession({ data: { sessionId: props.sessionId } });
          }}
        >
          {starting ? "Starting…" : "Start"}
        </Button>
      </div>
    </div>
  );
}

const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Once the session starts, the projector shows only time and one progress visual for the whole
 * class: no names and no per-problem counts (PRD, "Launch and join").
 */
function Running(props: {
  readonly status: "live" | "ended";
  readonly startedAt: string | null;
  readonly timeLimitMinutes: number | null;
  readonly joinCode: string;
  readonly submitted: number;
  readonly possible: number;
}) {
  const now = useNow(1000);
  const started = props.startedAt === null ? now : Date.parse(props.startedAt);
  const elapsed = now - started;
  const share = props.possible === 0 ? 0 : Math.min(1, props.submitted / props.possible);

  if (props.status === "ended") {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <div>
          <p className="font-black text-brand" style={{ fontSize: "var(--gb-text-3xl)" }}>
            Great work, everyone!
          </p>
          <p className="mt-4 text-2xl text-text-muted">That's the end of this session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-14 px-10">
      <div className="text-center">
        <p className="text-xl text-text-muted">
          {props.timeLimitMinutes === null ? "Time working" : "Time left"}
        </p>
        <p
          className="font-black text-brand tabular-nums"
          style={{ fontSize: "var(--gb-text-code)", lineHeight: 1 }}
        >
          {props.timeLimitMinutes === null
            ? formatClock(elapsed)
            : formatClock(props.timeLimitMinutes * 60_000 - elapsed)}
        </p>
      </div>
      <div className="w-full">
        <div
          className="h-10 w-full overflow-hidden rounded-full bg-surface-sunken shadow-inner"
          role="progressbar"
          aria-label="Class progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-[var(--gb-ease-out)]"
            style={{ width: `${Math.max(share * 100, 2)}%` }}
          />
        </div>
        <p className="mt-4 text-center text-2xl font-bold text-brand">
          {share >= 1 ? "Everyone's done!" : "Keep going, you've got this"}
        </p>
      </div>
      <p className="text-lg text-text-muted">
        Joining late? Code{" "}
        <span className="font-extrabold text-brand tabular-nums">{spacedCode(props.joinCode)}</span>
      </p>
    </div>
  );
}
