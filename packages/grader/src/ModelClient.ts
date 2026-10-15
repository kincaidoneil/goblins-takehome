/**
 * The one interface every model call goes through. `packages/grader` ships the
 * OpenRouter implementation; `packages/mock-model` ships the mock. Callers never
 * know which one they have.
 */
import { Context, Effect, Schema } from "effect"

/** What a call is for. The usage report maps these onto the PRD's budget lines. */
export type CallPurpose =
  | "grade"
  | "extract"
  | "rubric-chat"
  | "eval"
  | "calibration"

/** Metadata recorded in the call log next to each call. Not sent to the provider. */
export interface CallTag {
  readonly purpose: CallPurpose
  /** The thing this call works on, such as a grade id, for joining log rows to app data. */
  readonly subjectId?: string
  /** Set when the call was made for a load-test run; its rows are deleted after the run. */
  readonly loadTestRunId?: string
}

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  /** An https URL or a `data:` URL. */
  | { readonly type: "image"; readonly url: string }

export type Message =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | ReadonlyArray<ContentPart> }
  | { readonly role: "assistant"; readonly content: string }

export interface CompletionRequest {
  /** OpenRouter model id, such as `google/gemini-2.5-flash`. */
  readonly model: string
  readonly messages: ReadonlyArray<Message>
  readonly tag: CallTag
  readonly maxTokens?: number
  readonly temperature?: number
  /** Ask for JSON matching this JSON Schema. The caller still validates the text. */
  readonly jsonSchema?: { readonly name: string; readonly schema: object }
}

export interface Usage {
  readonly promptTokens: number
  readonly completionTokens: number
  /** Cost in US dollars as reported by the provider. Zero for the mock. */
  readonly costUsd: number
}

export interface Completion {
  /** Provider generation id, for looking the call up in OpenRouter. */
  readonly id: string
  /** The model that actually answered, which can differ from the requested id. */
  readonly model: string
  readonly text: string
  readonly usage: Usage
}

/** HTTP 429, or the provider said it is out of capacity. Retry after the hint if there is one. */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

/** No complete response within the deadline. The call may still have been billed. */
export class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  afterMs: Schema.Number,
}) {}

/** The provider returned an error status (5xx, or a 4xx other than 429), or no response at all. */
export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  /**
   * HTTP status, the error code from a 200 response's error body, or 0 when the
   * request never got a response (DNS, connection reset).
   */
  status: Schema.Number,
  message: Schema.String,
}) {}

/** The provider answered 200 but the body is unusable: malformed, empty, or cut off. */
export class BadResponse extends Schema.TaggedError<BadResponse>()("BadResponse", {
  message: Schema.String,
  /** Present when the provider reported usage, so the call log can still record the cost. */
  usage: Schema.optional(
    Schema.Struct({
      promptTokens: Schema.Number,
      completionTokens: Schema.Number,
      costUsd: Schema.Number,
    }),
  ),
}) {}

export type ModelError = RateLimited | Timeout | ProviderError | BadResponse

/**
 * Whether trying the same request again can succeed. A 4xx other than 429 means the
 * request itself is wrong (bad model id, too many tokens), so repeating it only spends money.
 */
export const isRetryable = (error: ModelError): boolean => {
  switch (error._tag) {
    case "RateLimited":
    case "Timeout":
    case "BadResponse":
      return true
    case "ProviderError":
      return error.status === 0 || error.status === 408 || error.status >= 500
  }
}

export class ModelClient extends Context.Tag("@goblins/grader/ModelClient")<
  ModelClient,
  {
    readonly complete: (request: CompletionRequest) => Effect.Effect<Completion, ModelError>
  }
>() {}
