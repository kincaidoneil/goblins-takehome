import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { fixtures, type MockConfig, makeMockModelClient, renderJson } from "../src/index.ts";
import { callsAt, fixtureBytes, request } from "./helpers.ts";

const fixed: MockConfig = { _tag: "Fixed", latencyMs: 0 };

describe("fixture table", () => {
  it("lists every fixture image with the SHA-256 of its bytes", () => {
    const files = readdirSync(new URL("../fixtures/", import.meta.url)).filter((f) =>
      f.endsWith(".png"),
    );
    expect(fixtures.map((f) => f.file).sort()).toEqual(files.sort());
    for (const fixture of fixtures) {
      const actual = createHash("sha256").update(fixtureBytes(fixture.file)).digest("hex");
      expect(`${fixture.file} ${actual}`).toBe(`${fixture.file} ${fixture.sha256}`);
    }
  });
});

describe("fixed mode answers each fixture as scripted", () => {
  it.effect("graded, partial, zero and flagged fixtures", () =>
    Effect.gen(function* () {
      for (const file of [
        "correct.png",
        "partial.png",
        "wrong.png",
        "blank.png",
        "illegible.png",
      ]) {
        const fixture = fixtures.find((f) => f.file === file);
        const outcome = fixture?.outcome;
        if (
          outcome === undefined ||
          outcome._tag === "FailsAlways" ||
          outcome._tag === "FailsFirst"
        ) {
          throw new Error(`${file} should answer`);
        }
        const { texts } = yield* callsAt(fixed, 0, 1, fixtureBytes(file));
        expect(texts).toEqual([renderJson(outcome)]);
      }
    }),
  );

  it.effect("needs-teacher carries its reason", () =>
    Effect.gen(function* () {
      const { texts } = yield* callsAt(fixed, 0, 1, fixtureBytes("illegible.png"));
      expect(JSON.parse(texts[0] ?? "")).toEqual({
        status: "needs_teacher",
        reason: "The final answer is illegible: it could be 4 or 1.",
      });
    }),
  );

  it.effect("fails-once fails with a non-retryable 400, then succeeds on the retry", () =>
    Effect.gen(function* () {
      const { tally, errors } = yield* callsAt(fixed, 0, 3, fixtureBytes("fails-once.png"));
      expect(tally).toEqual({ ProviderError: 1, Ok: 2 });
      expect(errors[0]).toMatchObject({ _tag: "ProviderError", status: 400 });
    }),
  );

  it.effect("fails-once counts attempts per grade", () =>
    Effect.gen(function* () {
      const client = yield* makeMockModelClient(fixed, { seed: 1 });
      const image = fixtureBytes("fails-once.png");
      const first = yield* Effect.either(client.complete(request(image, "grade-a")));
      const other = yield* Effect.either(client.complete(request(image, "grade-b")));
      const retry = yield* Effect.either(client.complete(request(image, "grade-a")));
      expect([first, other, retry].map(Either.isRight)).toEqual([false, false, true]);
    }),
  );

  it.effect("fails-always times out on every call", () =>
    Effect.gen(function* () {
      const { tally } = yield* callsAt(fixed, 0, 5, fixtureBytes("fails-always.png"));
      expect(tally).toEqual({ Timeout: 5 });
    }),
  );

  it.effect("malformed answers text that is not JSON", () =>
    Effect.gen(function* () {
      const { texts } = yield* callsAt(fixed, 0, 1, fixtureBytes("malformed.png"));
      expect(() => JSON.parse(texts[0] ?? "")).toThrow();
    }),
  );

  it.effect("an unknown image gets the same derived outcome every time", () =>
    Effect.gen(function* () {
      const image = new TextEncoder().encode("not a fixture");
      const { texts } = yield* callsAt(fixed, 0, 3, image);
      expect(new Set(texts).size).toBe(1);
    }),
  );

  it.effect("an unreadable image URL fails like the provider: a 400", () =>
    Effect.gen(function* () {
      const client = yield* makeMockModelClient(fixed, { seed: 1 });
      const result = yield* Effect.either(
        client.complete({
          model: "test/model",
          tag: { purpose: "grade" },
          messages: [
            { role: "user", content: [{ type: "image", url: "http://127.0.0.1:9/x.png" }] },
          ],
        }),
      );
      expect(Either.isLeft(result) && result.left).toMatchObject({
        _tag: "ProviderError",
        status: 400,
      });
    }),
  );
});
