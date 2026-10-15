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
import { DatabaseLive, Db, schema } from "@goblins/domain";
import {
  AiGrader,
  CallLog,
  Consumer,
  Grader,
  GradeStore,
  type ModelClient,
  OpenRouter,
  QStashQueue,
} from "@goblins/grader";
import * as MockModel from "@goblins/mock-model";
import { eq } from "drizzle-orm";
import { Config, Effect, Either, Layer, ManagedRuntime, Option, Redacted } from "effect";
import { GradeQueue } from "./grading";

/**
 * QStash settings. On in a production deploy with the integration connected, or
 * anywhere with `GRADER_QUEUE=qstash`, which the load test's local ramp uses with
 * QStash's local dev server (`QSTASH_URL=http://127.0.0.1:8080`).
 */
export const qstashConfig: Option.Option<QStashQueue.QStashConfig> = (() => {
  const env = process.env;
  const token = env.QSTASH_TOKEN;
  const current = env.QSTASH_CURRENT_SIGNING_KEY;
  const next = env.QSTASH_NEXT_SIGNING_KEY;
  const host = env.GRADER_PUBLIC_HOST ?? env.VERCEL_PROJECT_PRODUCTION_URL;
  const consumerUrl =
    env.GRADER_CONSUMER_URL ?? (host === undefined ? undefined : `https://${host}/api/queue/grade`);
  const enabled = env.VERCEL_ENV === "production" || env.GRADER_QUEUE === "qstash";
  if (
    !enabled ||
    token === undefined ||
    current === undefined ||
    next === undefined ||
    consumerUrl === undefined
  ) {
    return Option.none();
  }
  return Option.some({
    token: Redacted.make(token),
    baseUrl: env.QSTASH_URL ?? "https://qstash.upstash.io",
    currentSigningKey: Redacted.make(current),
    nextSigningKey: Redacted.make(next),
    consumerUrl,
    // The free plan caps parallelism at 10; the local dev server allows more.
    parallelism: Number(env.GRADER_PARALLELISM ?? "10"),
  });
})();

/** Sends grade jobs to QStash. A failed send is logged; the sweeper resends the grade. */
export const QStashGradeQueue = (config: QStashQueue.QStashConfig) => {
  const queue = QStashQueue.makeQueue(QStashQueue.makePublish(config));
  return Layer.succeed(GradeQueue, {
    enqueue: (job, dedupeKey) =>
      queue
        .enqueue(job, dedupeKey)
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

/** The mock config for a load-test run without a stored spec: the seed profile, no scenario. */
const defaultLoadTestConfig: MockModel.MockConfig = {
  _tag: "Sampled",
  profile: "seed",
  scenario: undefined,
  anchorMs: undefined,
};

/**
 * Load-test grades always get the mock, as their own service so they can't reach
 * OpenRouter. Each run's mock spec (scenario, start time) is stored on its class
 * session (`load_test_mock_spec`, from the load test's `x-goblins-mock-model`
 * header) and read by run id, so every function instance replays the same scenario
 * on the same clock. One mock client per spec, cached.
 */
const loadTestModel = Layer.effect(
  Consumer.LoadTestModelClient,
  Effect.gen(function* () {
    const db = yield* Db;
    const specs = new Map<string, Option.Option<string>>();
    const clients = new Map<string, ModelClient["Type"]>();

    const specFor = (runId: string) =>
      Effect.gen(function* () {
        const cached = specs.get(runId);
        if (cached !== undefined) return cached;
        const rows = yield* db
          .select({ spec: schema.classSessions.loadTestMockSpec })
          .from(schema.classSessions)
          .where(eq(schema.classSessions.loadTestRunId, runId))
          .limit(1);
        const spec = Option.fromNullable(rows[0]?.spec);
        specs.set(runId, spec);
        return spec;
      }).pipe(Effect.orElseSucceed(() => Option.none<string>()));

    const clientFor = (spec: Option.Option<string>) =>
      Effect.gen(function* () {
        const key = Option.getOrElse(spec, () => "");
        const cached = clients.get(key);
        if (cached !== undefined) return cached;
        const config = Option.match(spec, {
          onNone: () => defaultLoadTestConfig,
          onSome: (raw) =>
            Either.getOrElse(MockModel.parseMockSpec(raw, "header"), () => defaultLoadTestConfig),
        });
        const client = yield* MockModel.makeMockModelClient(config, {
          render: Grader.placeholderRender,
        });
        clients.set(key, client);
        return client;
      });

    return {
      complete: (request) =>
        Effect.gen(function* () {
          const runId = request.tag.loadTestRunId;
          const spec = runId === undefined ? Option.none<string>() : yield* specFor(runId);
          const client = yield* clientFor(spec);
          return yield* client.complete(request);
        }),
    } satisfies ModelClient["Type"];
  }),
);

/**
 * Which grader runs. Real grades on OpenRouter use AI quality's evaluated grader
 * (`AiGrader`). On the mock, and for every load-test grade (always on the mock),
 * the placeholder grader runs, because the mock answers in its reply format.
 */
const gradeWith = Layer.effect(
  Grader.Grader,
  Effect.map(Effect.orDie(ModelChoice), (choice) => ({
    grade: (input, tag) =>
      choice === "openrouter" && Option.isNone(input.loadTestRunId)
        ? AiGrader.grader.grade(input, tag)
        : Grader.placeholder.grade(input, tag),
  })),
);

const graderServices = Layer.mergeAll(
  Consumer.ModelRouterLive.pipe(
    Layer.provide(Layer.mergeAll(configuredModel, loadTestModel, CallLog.postgres)),
  ),
  GradeStore.postgres,
  gradeWith,
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
