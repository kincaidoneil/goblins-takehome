import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Ref, TestClock } from "effect";
import * as SpendGuard from "../src/SpendGuard.ts";

/** A fake usage endpoint: returns the current value, or fails when it is `undefined`. */
const fakeUsage = Effect.gen(function* () {
  const usage = yield* Ref.make<number | undefined>(0);
  const fetches = yield* Ref.make(0);
  const fetchUsage = Effect.zipRight(
    Ref.update(fetches, (n) => n + 1),
    Effect.flatMap(Ref.get(usage), (u) =>
      u === undefined ? Effect.fail("down") : Effect.succeed(u),
    ),
  );
  return { usage, fetches, fetchUsage };
});

const tag = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.either(effect), (r) =>
    Either.isLeft(r) && typeof r.left === "object" && r.left !== null && "_tag" in r.left
      ? r.left._tag
      : "ok",
  );

describe("SpendGuard", () => {
  it.effect("allows calls under the cap and refuses them once spend reaches it", () =>
    Effect.gen(function* () {
      const fake = yield* fakeUsage;
      yield* Ref.set(fake.usage, 19.99);
      const guard = yield* SpendGuard.make({ capUsd: 20, fetchUsage: fake.fetchUsage });
      expect(yield* tag(guard.check)).toBe("ok");
      // This instance's own spend counts before the next refresh.
      yield* guard.add(0.02);
      expect(yield* tag(guard.check)).toBe("BudgetExceeded");
      expect(yield* Ref.get(fake.fetches)).toBe(1);
    }),
  );

  it.effect("refreshes the key's usage every 30 s, so other instances' spend counts too", () =>
    Effect.gen(function* () {
      const fake = yield* fakeUsage;
      const guard = yield* SpendGuard.make({ capUsd: 20, fetchUsage: fake.fetchUsage });
      expect(yield* tag(guard.check)).toBe("ok");
      yield* Ref.set(fake.usage, 20.5);
      expect(yield* tag(guard.check)).toBe("ok");
      yield* TestClock.adjust("30 seconds");
      expect(yield* tag(guard.check)).toBe("BudgetExceeded");
      expect(yield* Ref.get(fake.fetches)).toBe(2);
    }),
  );

  it.effect("keeps the last figure when a refresh fails, and refuses with none", () =>
    Effect.gen(function* () {
      const fake = yield* fakeUsage;
      yield* Ref.set(fake.usage, undefined);
      const guard = yield* SpendGuard.make({ capUsd: 20, fetchUsage: fake.fetchUsage });
      expect(yield* tag(guard.check)).toBe("ProviderError");

      yield* Ref.set(fake.usage, 5);
      yield* TestClock.adjust("30 seconds");
      expect(yield* tag(guard.check)).toBe("ok");
      yield* Ref.set(fake.usage, undefined);
      yield* TestClock.adjust("30 seconds");
      expect(yield* tag(guard.check)).toBe("ok");
    }),
  );
});
