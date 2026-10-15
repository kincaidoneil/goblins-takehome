/**
 * One problem as the grader will know it: the text, what it reads instead of the diagram, the
 * answer key, the rubric's point lines, notes, and links to earlier problems. Everything is
 * editable in place.
 */
import { Badge, Button, Dialog, DialogClose, Menu } from "@goblins/ui";
import { useState } from "react";
import type { DraftProblem } from "../server/setup/draft";
import type { Edit } from "../server/setup/edits";

export type EditBuilder = ReadonlyArray<Edit> | ((latest: DraftProblem) => ReadonlyArray<Edit>);

import { EditableText } from "./EditableText";
import { pointsLabel, totalPoints } from "./problem-groups";

export interface ProblemCardProps {
  readonly problem: DraftProblem;
  /** Problems before this one, which it may build on. */
  readonly earlier: ReadonlyArray<DraftProblem>;
  /** Labels of later problems that build on this one. */
  readonly usedBy: ReadonlyArray<string>;
  /** The shared stem shown above a group of parts; hidden from this card's text. */
  readonly stem: string | null;
  readonly highlighted: boolean;
  /** Open in edit mode, for a problem the chat just added with no text. */
  readonly isNew: boolean;
  /** Point at a blank answer key, e.g. after launch refused a problem without one. */
  readonly needsAnswerKey: boolean;
  /**
   * Edits run one at a time. Pass a function to build them from the problem as it is when the
   * edit runs, so a rubric or link change doesn't undo one still being saved.
   */
  readonly onEdit: (edits: EditBuilder) => void;
  readonly onShowPage: (pageNumber: number) => void;
}

const withoutStem = (text: string, stem: string | null) =>
  stem !== null && text.startsWith(stem) ? text.slice(stem.length).replace(/^\n+/, "") : text;

const withStem = (text: string, stem: string | null) =>
  stem === null || stem === "" ? text : `${stem}\n\n${text}`;

export function ProblemCard({
  problem,
  earlier,
  usedBy,
  stem,
  highlighted,
  isNew,
  needsAnswerKey,
  onEdit,
  onShowPage,
}: ProblemCardProps) {
  const [linking, setLinking] = useState(false);
  const [addingDiagram, setAddingDiagram] = useState(false);
  const showDiagram = problem.diagramDescription !== null || addingDiagram;
  const total = totalPoints(problem);
  const setField =
    (field: "text" | "answerKey" | "diagramDescription" | "gradingNotes") => (value: string) =>
      onEdit([
        {
          _tag: "SetField",
          problemId: problem.id,
          field,
          value: field === "text" ? withStem(value, stem) : value,
        },
      ]);

  type Line = { readonly points: number; readonly description: string };
  const setLines = (update: (lines: ReadonlyArray<Line>) => ReadonlyArray<Line>) =>
    onEdit((latest) => {
      const [first, ...rest] = update(latest.rubric);
      return first === undefined
        ? []
        : [{ _tag: "SetRubric", problemId: latest.id, lines: [first, ...rest] }];
    });
  const setLinks = (update: (dependsOn: ReadonlyArray<string>) => ReadonlyArray<string>) =>
    onEdit((latest) => [
      { _tag: "SetDependencies", problemId: latest.id, dependsOn: [...update(latest.dependsOn)] },
    ]);

  const dependsOn = earlier.filter((p) => problem.dependsOn.includes(p.id));

  return (
    <article
      id={`problem-${problem.id}`}
      className="setup-problem"
      data-highlighted={highlighted || undefined}
      aria-label={`Problem ${problem.label}`}
    >
      <header className="setup-problem-header">
        <span className="setup-problem-label">{problem.label}</span>
        <div className="setup-problem-meta">
          {problem.pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              className="setup-page-link"
              onClick={() => onShowPage(page)}
            >
              Page {page}
            </button>
          ))}
          <Badge tone="brand">{pointsLabel(total)}</Badge>
        </div>
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              className="setup-icon-button"
              aria-label={`More for problem ${problem.label}`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.5" fill="currentColor" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                <circle cx="13" cy="8" r="1.5" fill="currentColor" />
              </svg>
            </button>
          }
          entries={[
            {
              kind: "item",
              label: "Describe a diagram for the grader",
              disabled: showDiagram,
              onSelect: () => setAddingDiagram(true),
            },
            {
              kind: "item",
              label: problem.gradeWithPageImage
                ? "Stop sending the page image"
                : "Also send the page image to the grader",
              onSelect: () =>
                onEdit([
                  {
                    _tag: "SetGradeWithPageImage",
                    problemId: problem.id,
                    value: !problem.gradeWithPageImage,
                  },
                ]),
            },
            ...(earlier.length > 0
              ? [
                  {
                    kind: "item" as const,
                    label: "Link to an earlier problem",
                    onSelect: () => setLinking(true),
                  },
                ]
              : []),
            { kind: "separator" },
            {
              kind: "item",
              label: "Remove problem",
              tone: "danger",
              onSelect: () => onEdit([{ _tag: "RemoveProblem", problemId: problem.id }]),
            },
          ]}
        />
      </header>

      <EditableText
        value={withoutStem(problem.text, stem)}
        onSave={setField("text")}
        label={`Problem ${problem.label} text`}
        placeholder="Type the problem as it reads on the worksheet."
        className="setup-problem-text"
        startEditing={isNew}
      />

      {showDiagram && (
        <section className="setup-diagram">
          <h4 className="setup-section-title">
            <EyeIcon /> The grader reads this instead of the picture
          </h4>
          <EditableText
            value={problem.diagramDescription ?? ""}
            onSave={(value) => {
              setAddingDiagram(false);
              setField("diagramDescription")(value);
            }}
            startEditing={addingDiagram}
            label={`Problem ${problem.label} diagram description`}
            placeholder="Describe the diagram: labels, lengths, angles and marks."
          />
          {problem.gradeWithPageImage && (
            <p className="setup-hint">It also gets the page image for this problem.</p>
          )}
        </section>
      )}
      {!showDiagram && problem.gradeWithPageImage && (
        <p className="setup-hint">The grader also gets the page image for this problem.</p>
      )}

      <section className="setup-section">
        <h4 className="setup-section-title">Answer key</h4>
        <EditableText
          value={problem.answerKey}
          onSave={setField("answerKey")}
          label={`Problem ${problem.label} answer key`}
          placeholder={
            needsAnswerKey
              ? "Needed before launch: the answer, and how to get there."
              : "The answer, and how to get there."
          }
          className="setup-answer"
        />
      </section>

      <section className="setup-section">
        <h4 className="setup-section-title">Rubric</h4>
        <ul className="setup-rubric">
          {problem.rubric.map((line, index) => (
            <li key={line.id} className="setup-rubric-line">
              <PointsStepper
                value={line.points}
                label={`Points for rubric line ${index + 1} of problem ${problem.label}`}
                onChange={(points) =>
                  setLines((lines) => lines.map((l, i) => (i === index ? { ...l, points } : l)))
                }
              />
              <EditableText
                value={line.description}
                onSave={(description) =>
                  description.trim() !== "" &&
                  setLines((lines) =>
                    lines.map((l, i) => (i === index ? { ...l, description } : l)),
                  )
                }
                label={`Rubric line ${index + 1} of problem ${problem.label}`}
                placeholder="What earns this point."
                className="setup-rubric-text"
              />
              {problem.rubric.length > 1 && (
                <button
                  type="button"
                  className="setup-icon-button"
                  aria-label={`Remove rubric line ${index + 1} of problem ${problem.label}`}
                  onClick={() => setLines((lines) => lines.filter((_, i) => i !== index))}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="setup-add-line"
          onClick={() =>
            setLines((lines) => [
              ...lines,
              { points: 1, description: "Describe what earns this point." },
            ])
          }
        >
          + Add a point line
        </button>
        <EditableText
          value={problem.gradingNotes}
          onSave={setField("gradingNotes")}
          label={`Problem ${problem.label} grading notes`}
          placeholder="Add a note for the grader, like “accept unsimplified fractions.”"
          className="setup-notes"
        />
      </section>

      {(dependsOn.length > 0 || usedBy.length > 0) && (
        <footer className="setup-links">
          {dependsOn.map((dependency) => (
            <span key={dependency.id} className="setup-link-chip">
              <LinkIcon />
              Uses the answer to {dependency.label}: follow-through credit on
              <button
                type="button"
                className="setup-chip-remove"
                aria-label={`Unlink ${problem.label} from ${dependency.label}`}
                onClick={() => setLinks((links) => links.filter((id) => id !== dependency.id))}
              >
                ×
              </button>
            </span>
          ))}
          {usedBy.length > 0 && (
            <span className="setup-link-chip" data-tone="quiet">
              <LinkIcon />
              {usedBy.join(", ")} {usedBy.length === 1 ? "builds" : "build"} on this answer
            </span>
          )}
        </footer>
      )}

      <Dialog
        open={linking}
        onOpenChange={setLinking}
        title={`What does ${problem.label} build on?`}
        description="A student who gets an earlier answer wrong still earns method credit here for correct work built on their own answer."
        actions={
          <DialogClose>
            <Button variant="brand">Done</Button>
          </DialogClose>
        }
      >
        <div className="setup-link-options">
          {earlier.map((candidate) => {
            const checked = problem.dependsOn.includes(candidate.id);
            return (
              <label key={candidate.id} className="setup-link-option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setLinks((links) =>
                      links.includes(candidate.id)
                        ? links.filter((id) => id !== candidate.id)
                        : [...links, candidate.id],
                    )
                  }
                />
                <span className="setup-link-option-label">{candidate.label}</span>
                <span className="setup-link-option-text">
                  {candidate.text.replace(/\\[()[\]]/g, "").slice(0, 90)}
                </span>
              </label>
            );
          })}
        </div>
      </Dialog>
    </article>
  );
}

function PointsStepper({
  value,
  label,
  onChange,
}: {
  readonly value: number;
  readonly label: string;
  readonly onChange: (value: number) => void;
}) {
  return (
    <fieldset className="setup-stepper" aria-label={label}>
      <button
        type="button"
        aria-label="One point fewer"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="setup-stepper-value">
        {value} pt{value === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        aria-label="One point more"
        disabled={value >= 20}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </fieldset>
  );
}

function EyeIcon() {
  return (
    <svg className="setup-inline-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="setup-inline-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
