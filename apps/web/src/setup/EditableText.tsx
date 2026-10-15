/**
 * Text the teacher can click to edit in place. Shows rendered math until clicked; saves on blur or
 * Cmd/Ctrl+Enter, and Escape puts the old text back.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MathText } from "./MathText";

export interface EditableTextProps {
  readonly value: string;
  readonly onSave: (value: string) => void;
  /** Accessible name, e.g. "Problem 3 text". */
  readonly label: string;
  /** Shown when the value is empty. */
  readonly placeholder: string;
  readonly className?: string;
  /** Opens in edit mode, e.g. for a problem the teacher just added. */
  readonly startEditing?: boolean;
}

export function EditableText({
  value,
  onSave,
  label,
  placeholder,
  className,
  startEditing = false,
}: EditableTextProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    const element = ref.current;
    if (!editing || element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  // Grow with the text, so a long problem never scrolls inside a small box.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 4}px`;
  });

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        aria-label={label}
        className={`setup-editable-input ${className ?? ""}`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        rows={1}
      />
    );
  }

  return (
    // Clicking anywhere on the text edits it; the pencil button is the keyboard route.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the pencil button handles the keyboard
    // biome-ignore lint/a11y/noStaticElementInteractions: as above
    <div className={`setup-editable ${className ?? ""}`} onClick={() => setEditing(true)}>
      {value.trim() === "" ? (
        <span className="setup-editable-placeholder">{placeholder}</span>
      ) : (
        <MathText text={value} />
      )}
      <button
        type="button"
        aria-label={`Edit ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        className="setup-editable-pencil"
        onClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
