import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { ScoreChip } from "../components/ScoreChip";

export interface NeedsYouItem {
  id: string;
  studentName: string;
  creatureId: number;
  problemLabel: string;
  /** "needs" is a flagged grade with a best guess; "failed" is a grade the model couldn't produce. */
  kind: "needs" | "failed";
  /** The grader's flag reason, or why grading failed. */
  reason: string;
}

export interface NeedsYouListProps {
  items: ReadonlyArray<NeedsYouItem>;
  onOpen: (id: string) => void;
}

/** The top of the dashboard: every grade waiting on the teacher, oldest first. */
export function NeedsYouList({ items, onOpen }: NeedsYouListProps) {
  if (items.length === 0) {
    return (
      <section className="gb-needs gb-needs-clear" aria-label="Grades that need you">
        <span className="gb-needs-check" aria-hidden="true">
          ✓
        </span>
        Nothing needs you right now. Grades the grader is unsure about show up here.
      </section>
    );
  }
  return (
    <section className="gb-needs" aria-label="Grades that need you">
      <h2 className="gb-needs-title">
        {items.length} {items.length === 1 ? "grade needs" : "grades need"} you
      </h2>
      <ul className="gb-needs-list">
        {items.map((item) => (
          <li key={item.id} className="gb-needs-item">
            <Avatar
              kind="creature"
              creatureId={item.creatureId}
              size="sm"
              name={item.studentName}
            />
            <div className="gb-needs-text">
              <div className="gb-needs-who">
                {item.studentName} · problem {item.problemLabel}
              </div>
              <div className="gb-needs-reason">{item.reason}</div>
            </div>
            <ScoreChip
              status={
                item.kind === "needs" ? { state: "needs-teacher" } : { state: "couldnt-grade" }
              }
              size="sm"
            />
            <Button size="sm" variant="secondary" onClick={() => onOpen(item.id)}>
              Review
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
