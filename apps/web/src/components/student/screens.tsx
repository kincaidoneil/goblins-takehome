/**
 * The student's screens other than the workspace: lobby, between-problem transition, summary
 * and "join again". Copy is warm and about effort, never about speed or mistakes.
 */
import { Avatar, Button, EmptyState, type GradeStatus, ScoreChip } from "@goblins/ui";

export function Lobby({ name, avatarId }: { name: string; avatarId: number }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">
      <EmptyState
        art={
          <div className="animate-[gb-bob_2.4s_ease-in-out_infinite] motion-reduce:animate-none">
            <Avatar kind="creature" creatureId={avatarId} name={name} size="xl" />
          </div>
        }
        title={`You're in, ${name}!`}
        description="Find your creature on the board. Your first problem opens when your teacher starts."
        actions={
          <p className="flex items-center gap-2 font-bold text-text-brand" role="status">
            <Dots />
            Waiting for your teacher to start
          </p>
        }
      />
    </div>
  );
}

function Dots() {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  );
}

export interface SummaryRow {
  id: string;
  label: string;
  status: GradeStatus;
}

/** After the last problem, or when the teacher ends the session. */
export function Summary({
  name,
  avatarId,
  rows,
  ended,
}: {
  name: string;
  avatarId: number;
  rows: ReadonlyArray<SummaryRow>;
  ended: boolean;
}) {
  const done = rows.filter((row) => row.status.state !== "not-started").length;
  const scoring = rows.some((row) => row.status.state === "grading");
  const firstName = name.split(/\s+/)[0] ?? name;
  const title =
    done === rows.length
      ? `You finished, ${firstName}!`
      : ended
        ? "Your teacher ended the session"
        : `Nice work, ${firstName}!`;
  const description =
    done === 0
      ? "Thanks for joining today."
      : done === rows.length
        ? `You showed your work on all ${rows.length} problems. That's real effort.`
        : `You showed your work on ${done} of ${rows.length} problems. Thanks for your effort today.`;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-8">
      <EmptyState
        art={<Avatar kind="creature" creatureId={avatarId} name={name} size="xl" />}
        title={title}
        description={description}
      />
      {done > 0 && (
        <ul className="flex flex-col rounded-xl bg-surface p-2 shadow-md">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-12 items-center justify-between gap-3 rounded-md px-3"
            >
              <span className="font-bold text-text-brand">Problem {row.label}</span>
              {row.status.state === "not-started" ? (
                <span className="text-sm text-text-subtle">Not started</span>
              ) : row.status.state === "grading" ? (
                <span className="text-sm text-text-muted">Score coming</span>
              ) : (
                <ScoreChip status={row.status} audience="student" size="sm" />
              )}
            </li>
          ))}
        </ul>
      )}
      {scoring && (
        <p className="text-center text-sm text-text-muted">
          Scores fill in here as they're checked. You can leave this page open.
        </p>
      )}
    </div>
  );
}

/** The cookie is missing or the teacher changed the class list. */
export function JoinAgain({ joinCode }: { joinCode: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">
      <EmptyState
        title="Let's get you back in"
        description="Join again with the same name to pick up where you left off."
        actions={
          <Button
            size="lg"
            nativeButton={false}
            render={<a href={joinCode === null ? "/join" : `/join?code=${joinCode}`} />}
          >
            Join again
          </Button>
        }
      />
    </div>
  );
}
