import { describe, expect, it } from "vitest";
import { studentNames } from "../src/names.ts";
import { classEndMs, planClass, scaled, testingDay } from "../src/pacing.ts";
import { seededRng } from "../src/rng.ts";

const MINUTE = 60_000;

describe("planClass", () => {
  it("follows the PRD's testing day at full scale", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const plan = planClass(seededRng(seed), testingDay, { students: 30, problems: 9 });
      // Classes start within 2 minutes of the bell, after a lobby for joining.
      expect(plan.startAtMs).toBeGreaterThanOrEqual(1 * MINUTE);
      expect(plan.startAtMs).toBeLessThanOrEqual(3 * MINUTE);
      expect(plan.students).toHaveLength(30);
      for (const student of plan.students) {
        expect(student.submitOffsetsMs).toHaveLength(9);
        const last = student.submitOffsetsMs.at(-1) ?? 0;
        // About 10 submissions over 20–40 minutes, in order.
        expect(last).toBeGreaterThanOrEqual(20 * MINUTE - 1);
        expect(last).toBeLessThanOrEqual(40 * MINUTE + 1);
        expect([...student.submitOffsetsMs].sort((a, b) => a - b)).toEqual(student.submitOffsetsMs);
        if (student.resumeBefore !== undefined) {
          expect(student.resumeBefore).toBeGreaterThanOrEqual(1);
          expect(student.resumeBefore).toBeLessThan(9);
        }
      }
    }
  });

  it("is reproducible from the seed", () => {
    const a = planClass(seededRng(7), testingDay, { students: 30, problems: 9 });
    const b = planClass(seededRng(7), testingDay, { students: 30, problems: 9 });
    expect(a).toEqual(b);
  });

  it("compresses the working window but keeps the lobby and bell at real time", () => {
    const full = planClass(seededRng(3), testingDay, { students: 30, problems: 9 });
    const fast = planClass(seededRng(3), scaled(testingDay, 0.1), { students: 30, problems: 9 });
    expect(fast.startAtMs).toBe(full.startAtMs);
    const work = (plan: typeof full) => classEndMs(plan) - plan.startAtMs;
    expect(work(fast)).toBeLessThan(work(full) * 0.2);
  });
});

describe("studentNames", () => {
  it("never repeats a name in a class, even past the name list", () => {
    const names = studentNames(seededRng(1), 2000);
    expect(new Set(names).size).toBe(2000);
  });
});
