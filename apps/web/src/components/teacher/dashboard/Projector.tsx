import { Avatar, Button, CreatureArt } from "@goblins/ui";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import type { SessionRow, StudentRow } from "../../../lib/sync";
import { formatDuration, formatRemaining, sessionClock, spacedCode, useNow } from "./clock";
import "./projector.css";

export interface ProjectorProps {
  readonly title: string;
  readonly joinCode: string;
  /** Where students go, without the code: "https://…/join". */
  readonly joinUrl: string;
  readonly problemCount: number;
  readonly session: SessionRow;
  readonly students: ReadonlyArray<StudentRow>;
  /** Grades in the session, one per submitted problem. Only the count is shown. */
  readonly submittedCount: number;
  readonly onStart: () => Promise<void>;
}

/**
 * The window the teacher puts on the projector. Before the start: the code, a QR code and every
 * student as they join, so mistakes are visible to the room. After: only time and one shared
 * progress bar for the class. No names, no per-problem counts.
 */
export function Projector(props: ProjectorProps) {
  const { session } = props;
  const now = useNow();
  const clock = sessionClock(session, now);
  return (
    <div className="pj">
      <header className="flex items-center justify-between gap-4 px-[4vw] pt-[2.5vw]">
        <span className="pj-brand">
          <Avatar kind="creature" creatureId={0} size="sm" name="" />
          Goblins Grader
        </span>
        <span className="truncate font-bold text-text-muted">{props.title}</span>
      </header>
      {clock._tag === "Lobby" ? <Lobby {...props} /> : <Live {...props} clock={clock} />}
    </div>
  );
}

function Lobby({ joinCode, joinUrl, students, onStart }: ProjectorProps) {
  const [starting, setStarting] = useState(false);
  const joined = [...students].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const host = joinUrl.replace(/^https?:\/\//, "");
  return (
    <>
      <main className="pj-lobby">
        <section className="pj-join" aria-label="How to join">
          <p className="pj-join-url">
            Go to <strong>{host}</strong>
            <br />
            and type this code
          </p>
          <div className="pj-code-card">
            <p className="pj-code" data-testid="projector-code">
              {spacedCode(joinCode)}
            </p>
          </div>
          <div className="pj-scan">
            <QRCodeSVG
              className="pj-qr"
              value={`${joinUrl}?code=${joinCode}`}
              size={256}
              marginSize={0}
              fgColor="#145a40"
              title="Scan to join"
            />
            <span>Or scan this with your device's camera</span>
          </div>
        </section>
        <section className="pj-roster" aria-live="polite" aria-label="Students who have joined">
          <h2 className="pj-roster-title" data-testid="projector-joined">
            {joined.length === 0
              ? "Waiting for the class"
              : `${joined.length} ${joined.length === 1 ? "student is" : "students are"} here`}
          </h2>
          {joined.length === 0 ? (
            <div className="pj-waiting">
              <span className="pj-bob">
                <CreatureArt id={7} size={140} title="" />
              </span>
              Your creature appears here when you join.
            </div>
          ) : (
            <ul className="pj-roster-list" data-size={joined.length > 18 ? "large" : undefined}>
              {joined.map((student) => (
                <li key={student.id} className="pj-student">
                  <Avatar kind="creature" creatureId={student.avatarId} size="sm" name="" />
                  {student.displayName}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="pj-footer">
        <span className="pj-late">See your name? You're in. Wrong name? Tell your teacher.</span>
        <Button
          variant="primary"
          className="pj-start"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            await onStart();
            setStarting(false);
          }}
        >
          {starting ? "Starting…" : "Start"}
        </Button>
      </footer>
    </>
  );
}

const cheer = (share: number, done: boolean) => {
  if (done) return "Every problem is in. Amazing work!";
  if (share >= 0.75) return "Almost there. Keep going!";
  if (share >= 0.5) return "Halfway there!";
  if (share >= 0.25) return "A quarter of the way. Nice work!";
  return "Show your thinking on each problem.";
};

function Live({
  joinCode,
  joinUrl,
  problemCount,
  students,
  submittedCount,
  clock,
}: ProjectorProps & {
  readonly clock: Exclude<ReturnType<typeof sessionClock>, { _tag: "Lobby" }>;
}) {
  const possible = students.length * problemCount;
  const share = possible === 0 ? 0 : Math.min(1, submittedCount / possible);
  const done = possible > 0 && submittedCount >= possible;
  const ended = clock._tag === "Ended";
  return (
    <>
      <main className="pj-live">
        <div>
          {clock._tag === "Counting" && (
            <>
              <p className="pj-clock" data-testid="projector-clock">
                {formatRemaining(clock.remainingMs)}
              </p>
              <p className="pj-clock-label">left</p>
            </>
          )}
          {clock._tag === "Running" && (
            <>
              <p className="pj-clock" data-testid="projector-clock">
                {formatDuration(clock.elapsedMs)}
              </p>
              <p className="pj-clock-label">since we started</p>
            </>
          )}
          {clock._tag === "TimeUp" && (
            <>
              <p className="pj-clock" data-text>
                Time's up
              </p>
              <p className="pj-clock-label">Finish the problem you're on and press Submit.</p>
            </>
          )}
          {ended && (
            <>
              <p className="pj-clock" data-text>
                That's a wrap!
              </p>
              <p className="pj-clock-label">Thanks for showing your work, everyone.</p>
            </>
          )}
        </div>

        <div
          className="pj-progress"
          role="img"
          aria-label={`The class has finished ${Math.round(share * 100)} percent of the problems`}
        >
          <div className="pj-track">
            <div className="pj-fill" style={{ width: `${share * 100}%` }} />
            <div className="pj-ticks" aria-hidden="true">
              {[0.25, 0.5, 0.75].map((at) => (
                <span key={at} style={{ left: `${at * 100}%` }} />
              ))}
            </div>
            <span
              className="pj-rider"
              style={{ left: `clamp(3%, ${share * 100}%, 97%)` }}
              aria-hidden="true"
            >
              <CreatureArt id={0} title="" />
            </span>
          </div>
          <div className="pj-progress-caption">
            <span>Class progress</span>
            <span data-testid="projector-progress">{Math.round(share * 100)}%</span>
          </div>
        </div>

        <p key={cheer(share, done)} className="pj-cheer">
          {ended ? "Your teacher has your work." : cheer(share, done)}
        </p>
      </main>
      {!ended && (
        <footer className="pj-footer">
          <span className="pj-late">
            Joining late? Go to {joinUrl.replace(/^https?:\/\//, "")} and type{" "}
            <strong>{spacedCode(joinCode)}</strong>
          </span>
        </footer>
      )}
    </>
  );
}
