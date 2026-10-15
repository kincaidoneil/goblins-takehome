/**
 * The real grading pipeline (`packages/grader`) wired into the app.
 *
 * In production, grade jobs go through Upstash QStash to `/api/queue/grade`, which
 * claims the grade, calls the model and records the outcome. Everywhere else (local
 * development, E2E, previews behind Vercel's deployment protection, which QStash
 * can't reach) the inline scripted mock in `grading.ts` stays in place.
 *
 * The model is the mock unless `MODEL_CLIENT=openrouter`; load-test grades always
 * use the mock.
 */
import { DatabaseLive } from "@goblins/domain";
import {
  CallLog,
  Consumer,
  Grader,
  GradeStore,
  ModelClient,
  OpenRouter,
  QStashQueue,
} from "@goblins/grader";
import * as MockModel from "@goblins/mock-model";
import { Config, Effect, Layer, ManagedRuntime, Option, Redacted } from "effect";
import { GradeQueue } from "./grading";

/** QStash settings, present only in a production deploy with the integration connected. */
export const qstashConfig: Option.Option<QStashQueue.QStashConfig> = (() => {
  const env = process.env;
  const token = env.QSTASH_TOKEN;
  const current = env.QSTASH_CURRENT_SIGNING_KEY;
  const next = env.QSTASH_NEXT_SIGNING_KEY;
  const host = env.GRADER_PUBLIC_HOST ?? env.VERCEL_PROJECT_PRODUCTION_URL;
  if (
    env.VERCEL_ENV !== "production" ||
    token === undefined ||
    current === undefined ||
    next === undefined ||
    host === undefined
  ) {
    return Option.none();
  }
  return Option.some({
    token: Redacted.make(token),
    baseUrl: env.QSTASH_URL ?? "https://qstash.upstash.io",
    currentSigningKey: Redacted.make(current),
    nextSigningKey: Redacted.make(next),
    consumerUrl: `https://${host}/api/queue/grade`,
    parallelism: Number(env.GRADER_PARALLELISM ?? "100"),
  });
})();

/** Sends grade jobs to QStash. A failed send is logged; the sweeper resends the grade. */
export const QStashGradeQueue = (config: QStashQueue.QStashConfig) => {
  const queue = QStashQueue.makeQueue(QStashQueue.makePublish(config));
  return Layer.succeed(GradeQueue, {
    enqueue: (job) =>
      queue
        .enqueue(job)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logError("Grade job not sent; the sweeper will resend it", error),
          ),
        ),
  });
};

/** The mock answers in the placeholder grader's format, with latency sampled from the seed profile. */
const mockModel = MockModel.layer(
  { _tag: "Sampled", profile: "seed", scenario: undefined, anchorMs: undefined },
  { render: Grader.placeholderRender },
);

const ModelChoice = Config.literal(
  "mock",
  "openrouter",
)("MODEL_CLIENT").pipe(Config.withDefault("mock"));

/** OpenRouter when `MODEL_CLIENT=openrouter`, the mock otherwise. */
const configuredModel = Layer.unwrapEffect(
  Effect.map(Effect.orDie(ModelChoice), (choice) =>
    choice === "openrouter" ? OpenRouter.layer : mockModel,
  ),
);

/** Load-test grades always get the mock, as their own service so they can't reach OpenRouter. */
const loadTestModel = Layer.effect(Consumer.LoadTestModelClient, ModelClient).pipe(
  Layer.provide(mockModel),
);

const graderServices = Layer.mergeAll(
  Consumer.ModelRouterLive.pipe(
    Layer.provide(Layer.mergeAll(configuredModel, loadTestModel, CallLog.postgres)),
  ),
  GradeStore.postgres,
  Layer.succeed(Grader.Grader, Grader.placeholder),
).pipe(Layer.provide(DatabaseLive), Layer.orDie);

/** Built on the first delivery, so routes that never grade don't open a second pool. */
const graderRuntime = ManagedRuntime.make(graderServices);

/** The QStash consumer route's handler, or `None` outside production. */
export const consumeGradeJob = Option.map(qstashConfig, (config) =>
  QStashQueue.makeHandler({
    runtime: graderRuntime,
    verify: QStashQueue.makeVerify(config),
    publish: QStashQueue.makePublish(config),
  }),
);

/** Verifies that a request (the sweep schedule) came from QStash. */
export const fromQStash = (request: Request, body: string) =>
  Option.match(qstashConfig, {
    onNone: () => Promise.resolve(false),
    onSome: (config) => {
      const signature = request.headers.get("upstash-signature");
      return signature === null
        ? Promise.resolve(false)
        : QStashQueue.makeVerify(config)(signature, body);
    },
  });
