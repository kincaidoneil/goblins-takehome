/**
 * A simulated testing window: many classes at once, each on its own schedule, with this
 * machine's load sampled throughout.
 */
import { Effect } from "effect";
import { runClass } from "./class.ts";
import { sampleGenerator } from "./health.ts";
import { classEndMs, type Pace, planClass } from "./pacing.ts";
import { forkRng } from "./rng.ts";
import type { Target } from "./target.ts";
import { loadWhiteboards } from "./whiteboards.ts";

export interface SimulationOptions {
  readonly target: Target;
  readonly classes: number;
  readonly studentsPerClass: number;
  /** How many problems the template has, for planning the schedule. */
  readonly problems: number;
  readonly templateId: string;
  readonly pace: Pace;
  readonly seed: number;
  readonly drainMs: number;
  readonly submitGiveUpMs: number;
  /** Teacher numbers start here, so two steps of one run never share a teacher. */
  readonly firstTeacher?: number;
}

export const planSimulation = (options: SimulationOptions) =>
  Array.from({ length: options.classes }, (_, i) =>
    planClass(forkRng(options.seed, `class:${i}`), options.pace, {
      students: options.studentsPerClass,
      problems: options.problems,
    }),
  );

/** When the last scheduled submission happens, from the start of the simulation. */
export const plannedDurationMs = (options: SimulationOptions) =>
  Math.max(0, ...planSimulation(options).map(classEndMs));

export const runSimulation = (options: SimulationOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const whiteboards = loadWhiteboards();
      const plans = planSimulation(options);
      const runStartMs = Date.now();
      yield* Effect.forkScoped(Effect.scoped(sampleGenerator));
      yield* Effect.forEach(
        plans,
        (plan, i) =>
          runClass({
            target: options.target,
            classId: `c${i}`,
            teacher: (options.firstTeacher ?? 0) + i,
            templateId: options.templateId,
            plan,
            whiteboards,
            seed: options.seed,
            runStartMs,
            drainMs: options.drainMs,
            submitGiveUpMs: options.submitGiveUpMs,
          }),
        { concurrency: "unbounded", discard: true },
      );
      return { runStartMs, runEndMs: Date.now() };
    }),
  );
