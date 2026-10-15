/**
 * The last step: pick an optional time limit, sign in with Google if needed (the only sign-in in
 * setup), then open the projector and the class session.
 */
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Button, Dialog } from "@goblins/ui";
import { useState } from "react";
import { launch } from "../server/setup/fns";
import { dashboardPath, projectorPath } from "./links";
import { pointsLabel } from "./problem-groups";

export interface LaunchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly draftId: string;
  readonly title: string;
  readonly problemCount: number;
  readonly points: number;
  readonly timeLimitMinutes: number | null;
  readonly onTimeLimitChange: (minutes: number | null) => void;
  /** A problem the server refused to launch with, so the screen can point at it. */
  readonly onProblemNeedsText: (label: string) => void;
}

const LIMITS: ReadonlyArray<number | null> = [null, 20, 30, 45, 60];

type LaunchState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Launching" }
  | { readonly _tag: "Failed"; readonly message: string };

export function LaunchDialog({
  open,
  onOpenChange,
  draftId,
  title,
  problemCount,
  points,
  timeLimitMinutes,
  onTimeLimitChange,
  onProblemNeedsText,
}: LaunchDialogProps) {
  const { isSignedIn, user } = useUser();
  const clerk = useClerk();
  const [state, setState] = useState<LaunchState>({ _tag: "Idle" });

  const signIn = () => {
    const back = new URL(window.location.href);
    back.searchParams.set("launch", "1");
    if (timeLimitMinutes === null) back.searchParams.delete("minutes");
    else back.searchParams.set("minutes", String(timeLimitMinutes));
    clerk.openSignIn({
      forceRedirectUrl: back.toString(),
      signUpForceRedirectUrl: back.toString(),
    });
  };

  const start = async () => {
    // Open the projector window inside the click, before any await, so it isn't blocked as a
    // popup; point it at the session once it exists.
    const projector = window.open("about:blank", "goblins-projector");
    setState({ _tag: "Launching" });
    const result = await launch({ data: { draftId, timeLimitMinutes } });
    if (result._tag === "Ok") {
      if (projector !== null) projector.location.href = projectorPath(result.value.sessionId);
      window.location.assign(dashboardPath(result.value.sessionId));
      return;
    }
    projector?.close();
    switch (result.error._tag) {
      case "NotSignedIn":
        setState({ _tag: "Idle" });
        signIn();
        return;
      case "DraftNotFound":
        setState({
          _tag: "Failed",
          message: "We couldn't find this assignment. Reload the page and try again.",
        });
        return;
      case "NotLaunchable":
        switch (result.error.reason) {
          case "still_extracting":
            setState({
              _tag: "Failed",
              message: "The worksheet is still being read. Try again in a moment.",
            });
            return;
          case "extraction_failed":
            setState({
              _tag: "Failed",
              message: "This worksheet couldn't be read, so there's nothing to grade yet.",
            });
            return;
          case "no_title":
            setState({ _tag: "Failed", message: "Give the assignment a name first." });
            return;
          case "empty_problem":
            setState({ _tag: "Idle" });
            onOpenChange(false);
            onProblemNeedsText(result.error.label ?? "");
            return;
        }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (state._tag !== "Launching") onOpenChange(next);
      }}
      title={`Launch “${title}”`}
      description={`${problemCount} ${problemCount === 1 ? "problem" : "problems"} · ${pointsLabel(points)}. Students join with a code on your projector; they don't need accounts.`}
      actions={
        isSignedIn ? (
          <Button
            size="lg"
            className="setup-launch-cta"
            onClick={start}
            disabled={state._tag === "Launching"}
          >
            {state._tag === "Launching" ? "Opening…" : "Open the projector"}
          </Button>
        ) : (
          <Button size="lg" className="setup-launch-cta" onClick={signIn}>
            <GoogleMark /> Sign in with Google to launch
          </Button>
        )
      }
    >
      <fieldset className="setup-limit">
        <legend className="setup-section-title">Time limit</legend>
        <div className="setup-limit-options">
          {LIMITS.map((minutes) => (
            <label key={minutes ?? "none"} className="setup-limit-option">
              <input
                type="radio"
                name="time-limit"
                checked={minutes === timeLimitMinutes}
                onChange={() => onTimeLimitChange(minutes)}
              />
              <span>{minutes === null ? "No limit" : `${minutes} min`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ul className="setup-launch-notes">
        <li>The projector opens in its own window. Drag it to the classroom screen.</li>
        <li>The rubric locks once you launch, so every student is graded the same way.</li>
        {isSignedIn ? (
          <li>Signed in as {user.primaryEmailAddress?.emailAddress ?? user.fullName ?? "you"}.</li>
        ) : (
          <li>Signing in keeps your class and grades in your account. Your setup is saved.</li>
        )}
      </ul>
      {state._tag === "Failed" && (
        <p className="setup-error" role="alert">
          {state.message}
        </p>
      )}
    </Dialog>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92a8.78 8.78 0 002.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 009 18z"
      />
      <path fill="#FBBC05" d="M3.96 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3-2.33z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 00.96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
