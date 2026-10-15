import { Button } from "../components/Button";

/** The app drives this from the board and the network. */
export type SubmitState =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Submitting" }
  | { readonly _tag: "QueuedOffline" };

export interface SubmitButtonProps {
  state: SubmitState;
  onSubmit: () => void;
}

/**
 * Submit, with a line of help underneath. Offline is not an error: the work
 * is saved on the device and sends when the connection comes back.
 */
export function SubmitButton({ state, onSubmit }: SubmitButtonProps) {
  return (
    <div className="gb-submit" data-state={state._tag}>
      <Button
        size="lg"
        disabled={state._tag !== "Ready"}
        onClick={onSubmit}
        className="gb-submit-button"
      >
        {state._tag === "Submitting" && <span className="gb-submit-spinner" aria-hidden="true" />}
        {state._tag === "QueuedOffline" && <CloudIcon />}
        {LABEL[state._tag]}
      </Button>
      <p className="gb-submit-hint" aria-live="polite">
        {HINT[state._tag]}
      </p>
    </div>
  );
}

const LABEL: Record<SubmitState["_tag"], string> = {
  Empty: "Submit",
  Ready: "Submit",
  Submitting: "Sending…",
  QueuedOffline: "Saved",
};

const HINT: Record<SubmitState["_tag"], string> = {
  Empty: "Show your work on the board first.",
  Ready: "Happy with it? Submit to move on.",
  Submitting: "",
  QueuedOffline: "You're offline. Your work is saved and sends as soon as you're back.",
};

function CloudIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5Z" />
      <path d="m9.5 13.5 2 2 3.5-3.5" />
    </svg>
  );
}
