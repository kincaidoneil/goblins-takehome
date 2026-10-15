/**
 * Scripted content: what a mocked call answers, chosen from a marker in the
 * request text so E2E tests can force every grade state.
 *
 * Markers look like `[[mock:<kind> key=value key="quoted value"]]` and may sit
 * in any text part of any message. The first valid marker wins.
 *
 *   [[mock:graded score=3 max=4 feedback="Good work"]]
 *   [[mock:needs-teacher reason="Work is illegible"]]
 *   [[mock:fail error=Timeout until=1760000000000]]
 *   [[mock:malformed]]
 *   [[mock:text value="any completion text"]]
 *
 * `fail` fails every call until the epoch-millisecond `until` (or always, if
 * absent). A deadline keeps the mock stateless across serverless instances
 * while still letting a test watch a failed grade succeed on retry.
 */

import type { CompletionRequest } from "@goblins/grader";
import { type FailureKind, failureKinds } from "./fate.ts";

export type Scripted =
  | {
      readonly _tag: "Graded";
      readonly score: number;
      readonly maxScore: number;
      readonly feedback: string;
    }
  | { readonly _tag: "NeedsTeacher"; readonly reason: string }
  | { readonly _tag: "Fails"; readonly error: FailureKind; readonly untilMs: number | undefined }
  | { readonly _tag: "Text"; readonly text: string };

/** A scripted outcome that answers rather than fails. */
export type Answer = Exclude<Scripted, { readonly _tag: "Fails" }>;

/** Answer when the request has no marker, and after a scripted failure's deadline. */
export const defaultScripted: Answer = {
  _tag: "Graded",
  score: 1,
  maxScore: 1,
  feedback: "Correct.",
};

/** Turns a scripted grade into completion text. The grader stream supplies its own when its output schema lands. */
export type Render = (answer: Answer) => string;

export const renderJson: Render = (answer) => {
  switch (answer._tag) {
    case "Graded":
      return JSON.stringify({
        status: "graded",
        score: answer.score,
        maxScore: answer.maxScore,
        feedback: answer.feedback,
      });
    case "NeedsTeacher":
      return JSON.stringify({ status: "needs_teacher", reason: answer.reason });
    case "Text":
      return answer.text;
  }
};

const MARKER = /\[\[mock:([a-z-]+)((?:\s+[a-zA-Z]+=(?:"[^"]*"|[^\s\]]+))*)\s*\]\]/g;
const ARG = /([a-zA-Z]+)=(?:"([^"]*)"|([^\s\]]+))/g;

const parseArgs = (raw: string): ReadonlyMap<string, string> => {
  const args = new Map<string, string>();
  for (const match of raw.matchAll(ARG)) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== undefined && value !== undefined) args.set(key, value);
  }
  return args;
};

const finite = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const isFailureKind = (value: string): value is FailureKind =>
  failureKinds.some((kind) => kind === value);

const fromMarker = (kind: string, args: ReadonlyMap<string, string>): Scripted | undefined => {
  switch (kind) {
    case "graded": {
      const maxScore = finite(args.get("max")) ?? 1;
      const score = finite(args.get("score")) ?? maxScore;
      return {
        _tag: "Graded",
        score,
        maxScore,
        feedback: args.get("feedback") ?? "Graded by mock.",
      };
    }
    case "needs-teacher":
      return {
        _tag: "NeedsTeacher",
        reason: args.get("reason") ?? "Mock flagged this for the teacher.",
      };
    case "fail": {
      const error = args.get("error") ?? "ProviderError";
      return isFailureKind(error)
        ? { _tag: "Fails", error, untilMs: finite(args.get("until")) }
        : undefined;
    }
    case "malformed":
      return { _tag: "Text", text: "mock: this is not the JSON you asked for" };
    case "text": {
      const value = args.get("value");
      return value === undefined ? undefined : { _tag: "Text", text: value };
    }
    default:
      return undefined;
  }
};

const textsOf = (request: CompletionRequest): Array<string> =>
  request.messages.flatMap((message) =>
    typeof message.content === "string"
      ? [message.content]
      : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );

/** The scripted answer for a request: its first valid marker, else the default. */
export const scriptedFor = (request: CompletionRequest): Scripted => {
  for (const text of textsOf(request)) {
    for (const match of text.matchAll(MARKER)) {
      const scripted = fromMarker(match[1] ?? "", parseArgs(match[2] ?? ""));
      if (scripted !== undefined) return scripted;
    }
  }
  return defaultScripted;
};

/** A scripted failure past its `until` deadline answers like an unmarked request. */
export const scriptedAt = (
  scripted: Scripted,
  nowMs: number,
): Answer | Extract<Scripted, { readonly _tag: "Fails" }> =>
  scripted._tag === "Fails" && scripted.untilMs !== undefined && nowMs >= scripted.untilMs
    ? defaultScripted
    : scripted;

/** Builds a marker string. Tests and the simulator use this instead of hand-writing markers. */
export const marker = (scripted: Scripted): string => {
  const q = (s: string) => `"${s.replaceAll('"', "'")}"`;
  switch (scripted._tag) {
    case "Graded":
      return `[[mock:graded score=${scripted.score} max=${scripted.maxScore} feedback=${q(scripted.feedback)}]]`;
    case "NeedsTeacher":
      return `[[mock:needs-teacher reason=${q(scripted.reason)}]]`;
    case "Fails":
      return scripted.untilMs === undefined
        ? `[[mock:fail error=${scripted.error}]]`
        : `[[mock:fail error=${scripted.error} until=${scripted.untilMs}]]`;
    case "Text":
      return `[[mock:text value=${q(scripted.text)}]]`;
  }
};
