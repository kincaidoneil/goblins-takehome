/**
 * ModelClient backed by OpenRouter's chat completions API.
 *
 * Real calls spend the project's $20 key, so the layer refuses to build unless
 * `MODEL_CLIENT=openrouter` is set next to `OPENROUTER_API_KEY`. Everything
 * else (development, tests, CI, load tests) uses the mock from `packages/mock-model`.
 */
import { Config, Effect, Either, Layer, Option, Redacted, Schema } from "effect";
import {
  BadResponse,
  type Completion,
  type CompletionRequest,
  type Message,
  ModelClient,
  ProviderError,
  RateLimited,
  Timeout,
} from "./ModelClient.ts";
import * as SpendGuard from "./SpendGuard.ts";

export interface OpenRouterConfig {
  readonly apiKey: Redacted.Redacted;
  /** Deadline for one call, including reading the body. */
  readonly timeoutMs: number;
  readonly baseUrl: string;
  /** Shown on OpenRouter's dashboard next to each call. */
  readonly appName: string;
}

const UsageBody = Schema.Struct({
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
  cost: Schema.optional(Schema.Number),
  completion_tokens_details: Schema.optional(
    Schema.Struct({ reasoning_tokens: Schema.optional(Schema.NullOr(Schema.Number)) }),
  ),
});

const SuccessBody = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  choices: Schema.Array(
    Schema.Struct({
      finish_reason: Schema.NullOr(Schema.String),
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) }),
      /** Set with `finish_reason: "error"` when the upstream provider failed partway through. */
      error: Schema.optional(
        Schema.Struct({ code: Schema.Union(Schema.Number, Schema.String), message: Schema.String }),
      ),
    }),
  ),
  usage: Schema.optional(UsageBody),
});

/** OpenRouter can answer 200 with an error body when the upstream provider fails mid-request. */
const ErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Union(Schema.Number, Schema.String),
    message: Schema.String,
  }),
});

const decodeSuccess = Schema.decodeUnknownOption(SuccessBody);
const decodeError = Schema.decodeUnknownOption(ErrorBody);

const toWireMessage = (message: Message) =>
  message.role === "user" && typeof message.content !== "string"
    ? {
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image_url", image_url: { url: part.url } },
        ),
      }
    : { role: message.role, content: message.content };

const toRequestBody = (request: CompletionRequest) => ({
  model: request.model,
  messages: request.messages.map(toWireMessage),
  ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
  ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  ...(request.reasoning === undefined ? {} : { reasoning: { effort: request.reasoning.effort } }),
  ...(request.jsonSchema === undefined
    ? {}
    : {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.jsonSchema.name,
            strict: true,
            schema: request.jsonSchema.schema,
          },
        },
      }),
  usage: { include: true },
});

/**
 * We ask for cost with `usage: { include: true }`. A response without it can't be
 * costed, and logging it as free would undercount spend, so it has no usage.
 */
const toUsage = (usage: typeof UsageBody.Type) => {
  if (usage.cost === undefined) return undefined;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    costUsd: usage.cost,
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
  };
};

/** Retry-After is either seconds or an HTTP date. */
const parseRetryAfterMs = (header: string | null, now: number): number | undefined => {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

const errorForStatus = (status: number, retryAfter: string | null, text: string) => {
  const retryAfterMs = parseRetryAfterMs(retryAfter, Date.now());
  const hint = retryAfterMs === undefined ? {} : { retryAfterMs };
  if (status === 429) return new RateLimited(hint);
  const message = Option.match(decodeError(safeJson(text)), {
    onNone: () => text.slice(0, 500),
    onSome: (body) => body.error.message,
  });
  return new ProviderError({ status, message, ...hint });
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const parseCompletion = (
  text: string,
): Either.Either<Completion, BadResponse | ProviderError | RateLimited> => {
  const json = safeJson(text);
  const success = decodeSuccess(json);
  if (Option.isNone(success)) {
    return Either.left(
      Option.match(decodeError(json), {
        onNone: () =>
          new BadResponse({ message: `Unrecognized response body: ${text.slice(0, 200)}` }),
        onSome: (body): RateLimited | ProviderError =>
          body.error.code === 429
            ? new RateLimited({})
            : new ProviderError({
                status: typeof body.error.code === "number" ? body.error.code : 502,
                message: body.error.message,
              }),
      }),
    );
  }
  const body = success.value;
  const usage = body.usage === undefined ? undefined : toUsage(body.usage);
  const badResponse = (message: string, truncated = false) =>
    Either.left(
      new BadResponse({
        message,
        ...(truncated ? { truncated } : {}),
        ...(usage === undefined ? {} : { usage }),
      }),
    );
  const choice = body.choices[0];
  if (choice === undefined) return badResponse("No choices in response");
  if (choice.finish_reason === "error" || choice.error !== undefined) {
    const code = choice.error?.code;
    return Either.left(
      code === 429
        ? new RateLimited({})
        : new ProviderError({
            status: typeof code === "number" ? code : 502,
            message: choice.error?.message ?? "The provider failed partway through the answer",
          }),
    );
  }
  if (choice.finish_reason === "length") return badResponse("Response cut off at max tokens", true);
  if (choice.message.content === null || choice.message.content.trim() === "") {
    return badResponse("Empty response");
  }
  if (usage === undefined)
    return badResponse("Response has no usage or no cost, so its cost is unknown");
  return Either.right({ id: body.id, model: body.model, text: choice.message.content, usage });
};

export const make = (
  config: OpenRouterConfig,
  guard: SpendGuard.SpendGuard,
): ModelClient["Type"] => ({
  complete: (request) =>
    Effect.gen(function* () {
      yield* guard.check;
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
              "Content-Type": "application/json",
              "X-Title": config.appName,
            },
            body: JSON.stringify(toRequestBody(request)),
          }).then(async (res) => ({
            status: res.status,
            retryAfter: res.headers.get("retry-after"),
            text: await res.text(),
          })),
        catch: (cause) => new ProviderError({ status: 0, message: String(cause) }),
      }).pipe(
        Effect.timeoutFail({
          duration: config.timeoutMs,
          onTimeout: () => new Timeout({ afterMs: config.timeoutMs }),
        }),
      );
      if (response.status !== 200) {
        return yield* errorForStatus(response.status, response.retryAfter, response.text);
      }
      const parsed = parseCompletion(response.text);
      // Count every reported cost toward the cap, including unusable answers.
      const usage = Either.match(parsed, {
        onLeft: (e) => (e._tag === "BadResponse" ? e.usage : undefined),
        onRight: (c) => c.usage,
      });
      if (usage !== undefined) yield* guard.add(usage.costUsd);
      return yield* parsed;
    }),
});

/** `mock` is the default everywhere; see docs/decisions.md. */
const ModelClientChoice = Config.literal(
  "mock",
  "openrouter",
)("MODEL_CLIENT").pipe(Config.withDefault("mock"));

/**
 * Fails to build unless real calls are explicitly allowed, so a missing flag can never
 * spend money, and refuses calls once spend reaches `MODEL_SPEND_CAP_USD` (default $20).
 */
export const layer = Layer.effect(
  ModelClient,
  Effect.gen(function* () {
    if ((yield* ModelClientChoice) !== "openrouter") {
      return yield* Effect.dieMessage(
        "OpenRouter ModelClient requested without MODEL_CLIENT=openrouter. Use the mock model, or set the flag deliberately.",
      );
    }
    const config = {
      apiKey: yield* Config.redacted("OPENROUTER_API_KEY"),
      timeoutMs: yield* Config.integer("OPENROUTER_TIMEOUT_MS").pipe(Config.withDefault(45_000)),
      baseUrl: yield* Config.string("OPENROUTER_BASE_URL").pipe(
        Config.withDefault("https://openrouter.ai/api/v1"),
      ),
      appName: "Goblins auto-grader",
    };
    const guard = yield* SpendGuard.make({
      capUsd: yield* Config.number("MODEL_SPEND_CAP_USD").pipe(Config.withDefault(20)),
      fetchUsage: SpendGuard.fetchOpenRouterUsage(config),
    });
    return make(config, guard);
  }),
);
