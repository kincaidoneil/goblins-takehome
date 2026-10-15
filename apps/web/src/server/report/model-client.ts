/**
 * The model behind the report's grouping call, logged like every other call: OpenRouter when
 * `MODEL_CLIENT=openrouter`, the mock otherwise, wrapped so each call writes a row to
 * `model_calls`. Needs only the database from the app runtime.
 */
import { CallLog, OpenRouter } from "@goblins/grader";
import * as MockModel from "@goblins/mock-model";
import { Config, Effect, Layer } from "effect";

const ModelChoice = Config.literal(
  "mock",
  "openrouter",
)("MODEL_CLIENT").pipe(Config.withDefault("mock"));

/** The mock answers instantly with text that isn't a grouping, so the report shows its fallback. */
const mockModel = MockModel.layer({ _tag: "Fixed", latencyMs: 0 });

/** OpenRouter or the mock, each wrapped so every call writes a row to `model_calls`. */
export const ReportModelClient = Layer.unwrapEffect(
  Effect.map(Effect.orDie(ModelChoice), (choice) =>
    choice === "openrouter"
      ? CallLog.withCallLog("openrouter").pipe(Layer.provide(OpenRouter.layer))
      : CallLog.withCallLog("mock").pipe(Layer.provide(mockModel)),
  ),
).pipe(Layer.provide(CallLog.postgres));
