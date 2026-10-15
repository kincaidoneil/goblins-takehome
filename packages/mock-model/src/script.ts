/**
 * Scripted content: what a mocked call answers.
 *
 * The answer is keyed on the whiteboard image in the request. The mock hashes
 * the image bytes and looks the hash up in the fixture table
 * (`src/fixtures.ts`); E2E tests and the class simulator submit those same
 * pre-drawn images, so prompts stay free of test-only text. An image that
 * matches no fixture gets an outcome derived from its hash, so the same image
 * always gets the same grade.
 */
import type { CompletionRequest } from "@goblins/grader";
import { Effect } from "effect";
import type { Failure } from "./fate.ts";

export type Answer =
  | {
      readonly _tag: "Graded";
      readonly score: number;
      readonly maxScore: number;
      readonly feedback: string;
    }
  | { readonly _tag: "NeedsTeacher"; readonly reason: string }
  /** Raw completion text, such as a reply that is not the JSON the grader asked for. */
  | { readonly _tag: "Text"; readonly text: string };

export type Scripted =
  | Answer
  | { readonly _tag: "FailsAlways"; readonly failure: Failure }
  | {
      /**
       * Fails the first `times` calls for each grade (`tag.subjectId`), then
       * answers `afterwards`. The count lives in memory on one instance, which holds
       * for a test that fails once and retries seconds later.
       */
      readonly _tag: "FailsFirst";
      readonly failure: Failure;
      readonly times: number;
      readonly afterwards: Answer;
    };

/** Answer when the request has no image. */
export const defaultAnswer: Answer = {
  _tag: "Graded",
  score: 1,
  maxScore: 1,
  feedback: "Correct.",
};

/** Turns an answer into completion text. The grader stream supplies its own when its output schema lands. */
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

/** Outcome for an image that matches no fixture: 70% correct, 15% incorrect, 15% flagged. */
export const fallbackFor = (sha256: string): Answer => {
  const bucket = Number.parseInt(sha256.slice(0, 8), 16) % 100;
  if (bucket < 70) return defaultAnswer;
  if (bucket < 85) return { _tag: "Graded", score: 0, maxScore: 1, feedback: "Incorrect." };
  return { _tag: "NeedsTeacher", reason: "The grader could not read this work with confidence." };
};

/** URLs of every image in the request's user messages, in order. */
export const imageUrlsOf = (request: CompletionRequest): Array<string> =>
  request.messages.flatMap((message) =>
    message.role !== "user" || typeof message.content === "string"
      ? []
      : message.content.flatMap((part) => (part.type === "image" ? [part.url] : [])),
  );

export type ImageError =
  | { readonly _tag: "ImageUnavailable"; readonly message: string }
  | { readonly _tag: "ImageTimedOut" };

const DATA_URL = /^data:([^,]*?)(;base64)?,(.*)$/s;

/**
 * Image bytes from a `data:` URL, or fetched from an http(s) URL as the
 * provider would. The fetch is real network time, so it is bounded by a real
 * timer rather than Effect's clock.
 */
export const imageBytes = (
  url: string,
  timeoutMs: number,
): Effect.Effect<Uint8Array, ImageError> => {
  const data = DATA_URL.exec(url);
  if (data !== null) {
    const payload = data[3] ?? "";
    return Effect.succeed(
      data[2] === undefined
        ? new TextEncoder().encode(decodeURIComponent(payload))
        : new Uint8Array(Buffer.from(payload, "base64")),
    );
  }
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    catch: (cause): ImageError =>
      cause instanceof Error && cause.name === "TimeoutError"
        ? { _tag: "ImageTimedOut" }
        : {
            _tag: "ImageUnavailable",
            message: `could not fetch image: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
  });
};

export const sha256Hex = (bytes: Uint8Array): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("hex")),
  );
