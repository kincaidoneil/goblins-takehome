/**
 * The stand-in's grading worker: an in-memory queue with a concurrency cap, the domain's claim and
 * outcome writes, the mock model, and the grading pipeline's retry policy (15 minutes of retries
 * for transient errors, 2 s backoff doubling to 60 s, Retry-After honored). It mirrors
 * `packages/grader` closely enough to exercise the load test locally; it is not the grader under
 * test. Once the grader's consumer merges, the stand-in should run that instead.
 */
import {
  type GradeJob,
  type GraderOutcome,
  type GradingInput,
  recordOutcome,
  releaseClaim,
  startGrading,
  stuckJobs,
} from "@goblins/domain";
import { isRetryable, type ModelClient, type ModelError } from "@goblins/grader";
import { type LoadTestRun, makeMockModelClient, selectModel } from "@goblins/mock-model";
import { Duration, Effect, Either, Option, Queue, Schedule, Schema } from "effect";

const GIVE_UP_AFTER_MS = 15 * 60_000;
const BAD_RESPONSE_ATTEMPTS = 3;

interface Delivery {
  readonly job: GradeJob;
  readonly firstEnqueuedAt: number;
  readonly deliveryCount: number;
}

const Answer = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("graded"),
    score: Schema.Number,
    maxScore: Schema.Number,
    feedback: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal("needs_teacher"), reason: Schema.String }),
);
const decodeAnswer = Schema.decodeUnknownEither(Schema.parseJson(Answer));

/** Spreads `fraction` of the rubric's points over its lines, first lines first. */
const linePointsFor = (input: GradingInput, fraction: number) => {
  const total = input.rubricLines.reduce((sum, line) => sum + line.points, 0);
  let remaining = Math.round(total * Math.min(1, Math.max(0, fraction)));
  return input.rubricLines.map((line) => {
    const points = Math.min(line.points, remaining);
    remaining -= points;
    return { rubricLineId: line.id, points };
  });
};

type Attempt =
  | { readonly _tag: "Outcome"; readonly outcome: GraderOutcome }
  | { readonly _tag: "Error"; readonly error: ModelError };

export const makeGrader = (options: {
  readonly concurrency: number;
  /** The mock spec each load-test run asked for, keyed by run id. */
  readonly runs: Map<string, LoadTestRun>;
}) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Delivery>();
    const clients = new Map<string, ModelClient["Type"]>();

    const clientFor = (runId: Option.Option<string>) =>
      Effect.gen(function* () {
        const run = Option.flatMap(runId, (id) => Option.fromNullable(options.runs.get(id)));
        const selection = selectModel({ env: process.env, loadTest: Option.getOrUndefined(run) });
        if (Either.isLeft(selection)) return yield* Effect.die(selection.left.message);
        if (selection.right._tag === "Real") {
          return yield* Effect.die("the stand-in never calls the real model");
        }
        const key = JSON.stringify(selection.right.config);
        const cached = clients.get(key);
        if (cached !== undefined) return cached;
        const client = yield* makeMockModelClient(selection.right.config);
        clients.set(key, client);
        return client;
      });

    const callModel = (input: GradingInput): Effect.Effect<Attempt> =>
      Effect.gen(function* () {
        const client = yield* clientFor(input.loadTestRunId);
        for (let attempt = 1; ; attempt++) {
          const result = yield* client
            .complete({
              model: "mock",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: input.problem.text },
                    { type: "image", url: input.whiteboardUrl },
                  ],
                },
              ],
              tag: {
                purpose: "grade",
                subjectId: input.lease.submissionId,
                ...Option.match(input.loadTestRunId, {
                  onNone: () => ({}),
                  onSome: (loadTestRunId) => ({ loadTestRunId }),
                }),
              },
            })
            .pipe(Effect.either);
          if (Either.isLeft(result)) return { _tag: "Error", error: result.left } satisfies Attempt;
          const answer = decodeAnswer(result.right.text);
          if (Either.isRight(answer)) {
            const a = answer.right;
            const outcome: GraderOutcome =
              a.status === "graded"
                ? {
                    _tag: "Sure",
                    result: {
                      read: "(mock)",
                      linePoints: linePointsFor(input, a.score / a.maxScore),
                      reason: a.feedback,
                    },
                  }
                : {
                    _tag: "Unsure",
                    result: {
                      read: "(mock)",
                      linePoints: linePointsFor(input, 0),
                      reason: a.reason,
                    },
                    flagReason: a.reason,
                  };
            return { _tag: "Outcome", outcome } satisfies Attempt;
          }
          if (attempt >= BAD_RESPONSE_ATTEMPTS) {
            return {
              _tag: "Outcome",
              outcome: { _tag: "Failed", failureReason: "the model's answer was unusable" },
            } satisfies Attempt;
          }
        }
      });

    const handle = (delivery: Delivery) =>
      Effect.gen(function* () {
        const claim = yield* startGrading(delivery.job);
        if (claim._tag !== "Claimed") return;
        const input = claim.input;
        const attempt = yield* callModel(input);
        if (attempt._tag === "Outcome") {
          yield* recordOutcome(input.lease, attempt.outcome);
          return;
        }
        const error = attempt.error;
        const age = Date.now() - delivery.firstEnqueuedAt;
        if (!isRetryable(error) || age >= GIVE_UP_AFTER_MS) {
          yield* recordOutcome(input.lease, {
            _tag: "Failed",
            failureReason: `${error._tag} after ${delivery.deliveryCount} deliveries`,
          });
          return;
        }
        const backoff = Math.min(60_000, 2000 * 2 ** (delivery.deliveryCount - 1));
        const hinted =
          error._tag === "RateLimited" ? Math.max(backoff, error.retryAfterMs ?? 0) : backoff;
        yield* releaseClaim(input.lease);
        yield* Queue.offer(queue, { ...delivery, deliveryCount: delivery.deliveryCount + 1 }).pipe(
          Effect.delay(Duration.millis(hinted * (0.8 + 0.4 * Math.random()))),
          Effect.forkDaemon,
        );
      }).pipe(Effect.catchAllCause((cause) => Effect.logError("grading failed", cause)));

    for (let i = 0; i < options.concurrency; i++) {
      yield* Queue.take(queue).pipe(Effect.flatMap(handle), Effect.forever, Effect.forkDaemon);
    }

    // The sweeper: re-enqueues grades whose message may have been lost. A duplicate is harmless.
    yield* stuckJobs({ queuedSeconds: 60, limit: 500 }).pipe(
      Effect.flatMap((jobs) =>
        Queue.offerAll(
          queue,
          jobs.map((job) => ({ job, firstEnqueuedAt: Date.now(), deliveryCount: 1 })),
        ),
      ),
      Effect.catchAllCause((cause) => Effect.logError("sweeper failed", cause)),
      Effect.repeat(Schedule.spaced(Duration.seconds(15))),
      Effect.forkDaemon,
    );

    return {
      enqueue: (job: GradeJob) =>
        Queue.offer(queue, { job, firstEnqueuedAt: Date.now(), deliveryCount: 1 }),
    };
  });
