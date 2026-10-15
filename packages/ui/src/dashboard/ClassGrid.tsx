import { Avatar } from "../components/Avatar";
import type { GradeStatus } from "../components/grade";
import { ScoreChip } from "../components/ScoreChip";
import { cx } from "../cx";

export interface GridStudent {
  id: string;
  name: string;
  creatureId: number;
}

export interface GridProblem {
  id: string;
  /** As printed, e.g. "3" or "2b". */
  label: string;
  maxPoints: number;
}

export interface ClassGridProps {
  students: ReadonlyArray<GridStudent>;
  problems: ReadonlyArray<GridProblem>;
  /** The grade for one cell. */
  status: (studentId: string, problemId: string) => GradeStatus;
  /** Opens a cell's review. Cells with nothing submitted aren't clickable. */
  onOpen?: (studentId: string, problemId: string) => void;
  /**
   * For a mirrored projector: names become "Student 1, 2, ..." and scores
   * become a plain "done" mark, so the class sees progress but not who scored what.
   */
  hidden?: boolean;
  className?: string;
}

function graded(status: GradeStatus): { points: number; max: number } | undefined {
  return status.state === "graded" ? { points: status.points, max: status.maxPoints } : undefined;
}

function format(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Students down the side, problems across the top, one grade per cell. */
export function ClassGrid({
  students,
  problems,
  status,
  onOpen,
  hidden = false,
  className,
}: ClassGridProps) {
  return (
    <div className={cx("gb-grid-scroll", className)} data-hidden={hidden || undefined}>
      <table className="gb-grid">
        <thead>
          <tr>
            <th scope="col" className="gb-grid-corner">
              Student
            </th>
            {problems.map((problem) => (
              <th key={problem.id} scope="col" className="gb-grid-problem">
                {problem.label}
              </th>
            ))}
            <th scope="col" className="gb-grid-total-head">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student, row) => {
            const scores = problems.map((p) => graded(status(student.id, p.id)));
            const earned = scores.reduce((sum, s) => sum + (s?.points ?? 0), 0);
            const possible = scores.reduce((sum, s) => sum + (s?.max ?? 0), 0);
            return (
              <tr key={student.id}>
                <th scope="row" className="gb-grid-student">
                  <span className="gb-grid-who">
                    {hidden ? (
                      <span className="gb-grid-anon" aria-hidden="true" />
                    ) : (
                      <Avatar
                        kind="creature"
                        creatureId={student.creatureId}
                        size="sm"
                        name={student.name}
                      />
                    )}
                    {hidden ? `Student ${row + 1}` : student.name}
                  </span>
                </th>
                {problems.map((problem) => {
                  const cell = status(student.id, problem.id);
                  const open = onOpen !== undefined && cell.state !== "not-started";
                  const chip = hidden ? (
                    <HiddenMark status={cell} />
                  ) : (
                    <ScoreChip status={cell} size="sm" />
                  );
                  return (
                    <td key={problem.id} className="gb-grid-cell">
                      {open ? (
                        <button
                          type="button"
                          className="gb-grid-open"
                          aria-label={`${hidden ? `Student ${row + 1}` : student.name}, problem ${problem.label}`}
                          onClick={() => onOpen(student.id, problem.id)}
                        >
                          {chip}
                        </button>
                      ) : (
                        chip
                      )}
                    </td>
                  );
                })}
                <td className="gb-grid-total">
                  {hidden || possible === 0 ? "–" : `${format(earned)}/${format(possible)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="gb-grid-student gb-grid-average-head">
              Class average
            </th>
            {problems.map((problem) => {
              const done = students
                .map((s) => graded(status(s.id, problem.id)))
                .filter((s) => s !== undefined);
              const average =
                done.length === 0
                  ? undefined
                  : done.reduce((sum, s) => sum + s.points, 0) / done.length;
              return (
                <td key={problem.id} className="gb-grid-average">
                  {hidden || average === undefined
                    ? "–"
                    : `${format(average)}/${problem.maxPoints}`}
                </td>
              );
            })}
            <td className="gb-grid-average" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Progress without scores: open, in progress, or done. */
function HiddenMark({ status }: { status: GradeStatus }) {
  const done = status.state !== "not-started" && status.state !== "grading";
  const tone = status.state === "not-started" ? "empty" : done ? "done" : "pending";
  return (
    <span
      className="gb-grid-mark"
      data-tone={tone}
      role="img"
      aria-label={done ? "Done" : tone === "pending" ? "Submitted" : "Not started"}
    />
  );
}
