/**
 * The QStash route handler, with QStash's signature check and publish faked out:
 * deliveries are acknowledged, retried by a delayed republish, or redelivered by
 * QStash when the republish fails.
 */
import { describe, expect, it } from "@effect/vitest";
import { Attempt } from "@goblins/domain";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as CallLog from "../src/CallLog.ts";
import { ModelRouter } from "../src/Consumer.ts";
import * as Grader from "../src/Grader.ts";
import * as GradeStore from "../src/GradeStore.ts";
import { type Completion, type ModelError, ProviderError } from "../src/ModelClient.ts";
import * as QStashQueue from "../src/QStashQueue.ts";
import { fullMarks, material, sub } from "./fixtures.ts";

const setup = async (answer: () => Effect.Effect<Completion, ModelError>) => {
  const store = await Effect.runPromise(GradeStore.inMemory);
  const log = await Effect.runPromise(CallLog.inMemory);
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(GradeStore.GradeStore, store.service),
      Layer.succeed(Grader.Grader, Grader.placeholder),
      Layer.succeed(ModelRouter, {
        forGrade: () => CallLog.wrap({ complete: () => answer() }, log.service),
      }),
    ),
  );
  const published: Array<{
    envelope: QStashQueue.Envelope;
    options: { deduplicationId: string; delaySeconds: number };
  }> = [];
  let publishFails = false;
  const publish: QStashQueue.Publish = async (envelope, options) => {
    if (publishFails) throw new Error("QStash unreachable");
    published.push({ envelope, options });
  };
  const handler = QStashQueue.makeHandler({
    runtime,
    verify: async (signature) => signature === "valid",
    publish,
  });
  const job = await Effect.runPromise(store.insert(sub("g1"), material()));
  const deliver = (envelope: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request("https://app.example/api/grade", {
        method: "POST",
        headers: { "upstash-signature": "valid", ...headers },
        body: JSON.stringify(envelope),
      }),
    );
  return {
    store,
    job,
    deliver,
    published,
    failPublish: () => {
      publishFails = true;
    },
  };
};

const firstDelivery = (job: unknown) => ({ job, deliveryCount: 1, enqueuedAt: Date.now() });

describe("QStash route handler", () => {
  it("grades a delivery and acknowledges it", async () => {
    const t = await setup(() => Effect.succeed(fullMarks()));
    const response = await t.deliver(firstDelivery(t.job));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "graded" });
    expect(await Effect.runPromise(t.store.get(sub("g1")))).toMatchObject({ state: "graded" });
  });

  it("rejects a request without a valid QStash signature", async () => {
    const t = await setup(() => Effect.succeed(fullMarks()));
    const response = await t.deliver(firstDelivery(t.job), { "upstash-signature": "forged" });
    expect(response.status).toBe(401);
    expect(await Effect.runPromise(t.store.get(sub("g1")))).toMatchObject({ state: "submitted" });
  });

  it("schedules a retry as a delayed message carrying the delivery count and first enqueue time", async () => {
    const t = await setup(() => Effect.fail(new ProviderError({ status: 503, message: "down" })));
    const enqueuedAt = Date.now() - 30_000;
    const response = await t.deliver(
      { job: t.job, deliveryCount: 2, enqueuedAt },
      { "upstash-retried": "1" },
    );
    expect(response.status).toBe(200);
    expect(t.published).toHaveLength(1);
    const [retry] = t.published;
    // Delivery 2 of our own retries, plus one QStash redelivery: the next is delivery 4.
    expect(retry?.envelope).toEqual({ job: t.job, deliveryCount: 4, enqueuedAt });
    expect(retry?.options.deduplicationId).toBe(`grade:${sub("g1")}:1:delivery:4`);
    expect(retry?.options.delaySeconds).toBeGreaterThanOrEqual(6);
    // The claim was released, so the retry can take the grade at once.
    expect(await Effect.runPromise(t.store.get(sub("g1")))).toMatchObject({ state: "submitted" });
  });

  it("asks QStash to redeliver when the retry can't be scheduled", async () => {
    const t = await setup(() => Effect.fail(new ProviderError({ status: 503, message: "down" })));
    t.failPublish();
    const response = await t.deliver(firstDelivery(t.job));
    expect(response.status).toBe(500);
  });

  it("acknowledges and drops a malformed message", async () => {
    const t = await setup(() => Effect.succeed(fullMarks()));
    const response = await t.deliver({ job: { submissionId: "not-a-uuid", attempt: 0 } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "dropped" });
  });

  it("enqueues a first delivery under the submit path's dedupe key", async () => {
    const published: Array<{ envelope: QStashQueue.Envelope; deduplicationId: string }> = [];
    const queue = QStashQueue.makeQueue(async (envelope, options) => {
      published.push({ envelope, deduplicationId: options.deduplicationId });
    });
    const job = { submissionId: sub("g2"), attempt: Attempt.make(1) };
    await Effect.runPromise(queue.enqueue(job));
    expect(published).toMatchObject([
      { envelope: { job, deliveryCount: 1 }, deduplicationId: `grade:${sub("g2")}:1` },
    ]);
    expect(published[0]?.envelope.enqueuedAt).toBeTypeOf("number");
  });
});
