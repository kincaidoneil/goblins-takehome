/**
 * Samples this machine's own load while a simulation runs. A load generator that is out of CPU,
 * or whose event loop is stalled, reports its own delay as server latency; the load test marks
 * any step where that happened instead of blaming the app.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Effect, Schedule } from "effect";
import { Recorder } from "./events.ts";
import { inFlight } from "./http.ts";

export const SAMPLE_MS = 2000;

export const sampleGenerator = Effect.gen(function* () {
  const recorder = yield* Recorder;
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  yield* Effect.addFinalizer(() => Effect.sync(() => histogram.disable()));
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  yield* Effect.sync(() => {
    const cpu = process.cpuUsage(lastCpu);
    const now = performance.now();
    const elapsedUs = (now - lastAt) * 1000;
    lastCpu = process.cpuUsage();
    lastAt = now;
    recorder.record({
      type: "generator",
      at: Date.now(),
      eventLoopDelayP99Ms: Math.round(histogram.percentile(99) / 1e6),
      cpuPercent: Math.round(((cpu.user + cpu.system) / elapsedUs) * 100),
      openRequests: inFlight.count,
      heapMb: Math.round(process.memoryUsage().heapUsed / 1e6),
    });
    histogram.reset();
  }).pipe(Effect.delay(SAMPLE_MS), Effect.repeat(Schedule.forever));
});
