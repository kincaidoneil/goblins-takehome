import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { marker, type Scripted, scriptedFor } from "../src/index.ts";
import { callsAt, request } from "./helpers.ts";

const fixed = { _tag: "Fixed", latencyMs: 0 } as const;

describe("scripted markers", () => {
  it("round-trips every kind through marker()", () => {
    const cases: ReadonlyArray<Scripted> = [
      { _tag: "Graded", score: 2, maxScore: 4, feedback: "Sign error in step 2" },
      { _tag: "NeedsTeacher", reason: "Work is illegible" },
      { _tag: "Fails", error: "RateLimited", untilMs: 1_760_000_000_000 },
      { _tag: "Fails", error: "BadResponse", untilMs: undefined },
      { _tag: "Text", text: '{"problems": []}' },
    ];
    for (const scripted of cases) {
      expect(scriptedFor(request(`Student answer: x = 3 ${marker(scripted)}`))).toEqual(
        scripted._tag === "Text" ? { _tag: "Text", text: "{'problems': []}" } : scripted,
      );
    }
  });

  it("defaults to full marks without a marker, and skips invalid markers", () => {
    expect(scriptedFor(request("no marker here"))._tag).toBe("Graded");
    expect(
      scriptedFor(request("[[mock:fail error=Nope]] [[mock:needs-teacher reason=x]]")),
    ).toEqual({
      _tag: "NeedsTeacher",
      reason: "x",
    });
  });
});

describe("fixed mode", () => {
  it.effect("answers each grade state as scripted", () =>
    Effect.gen(function* () {
      const graded = yield* callsAt(fixed, 0, 1, '[[mock:graded score=1 max=2 feedback="Half"]]');
      const flagged = yield* callsAt(fixed, 0, 1, '[[mock:needs-teacher reason="Blank work"]]');
      const failed = yield* callsAt(fixed, 0, 1, "[[mock:fail error=Timeout]]");
      const malformed = yield* callsAt(fixed, 0, 1, "[[mock:malformed]]");
      const texts = [graded, flagged, malformed].map(({ texts }) => texts[0]);
      expect(texts[0]).toBe(
        JSON.stringify({ status: "graded", score: 1, maxScore: 2, feedback: "Half" }),
      );
      expect(texts[1]).toBe(JSON.stringify({ status: "needs_teacher", reason: "Blank work" }));
      expect(() => JSON.parse(texts[2] ?? "")).toThrow();
      expect(failed.tally).toEqual({ Timeout: 1 });
    }),
  );

  it.effect(
    "a failure with a deadline fails before it and grades after it, so a retry succeeds",
    () =>
      Effect.gen(function* () {
        const text = marker({ _tag: "Fails", error: "ProviderError", untilMs: 10_000 });
        expect((yield* callsAt(fixed, 9_999, 3, text)).tally).toEqual({ ProviderError: 3 });
        expect((yield* callsAt(fixed, 10_000, 3, text)).tally).toEqual({ Ok: 3 });
      }),
  );
});
