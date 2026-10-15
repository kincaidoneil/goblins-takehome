/**
 * Which model runs each AI task, and how. Chosen from the evals in packages/evals; change these
 * only with a new eval run that supports it.
 */
import type { CompletionRequest } from "../ModelClient.ts";

export interface ModelChoice {
  /** OpenRouter model id. */
  readonly model: string;
  readonly maxTokens: number;
  readonly reasoning?: NonNullable<CompletionRequest["reasoning"]>;
}

export const models = {
  // First eval pass (prompt v2, 230 cases): 93% exact, $0.0009 per grade, 1.9 s p50. The
  // eval report settles this; see packages/evals.
  grade: { model: "google/gemini-3.1-flash-lite", maxTokens: 1500 },
  // Every answer key right on all four templates, $0.006 per worksheet, 30–60 s. Replies run to
  // 14k tokens on a 4-page worksheet, and one run went past 16k, so the cap leaves room.
  extract: { model: "anthropic/claude-haiku-5.5", maxTokens: 32000 },
  // 12 of 12 chat-editing cases, $0.002 per message.
  chat: { model: "anthropic/claude-haiku-5.5", maxTokens: 16000 },
} satisfies Record<string, ModelChoice>;
