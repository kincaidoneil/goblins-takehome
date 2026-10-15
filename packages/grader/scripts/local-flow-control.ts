/**
 * Checks QStashQueue against QStash's local dev server: publish N jobs with flow
 * control, receive them on a local consumer that verifies each signature and holds
 * it for 5 s, and report peak concurrency and wall time.
 *
 *   npx @upstash/qstash-cli dev -port 8089
 *   QSTASH_URL=http://127.0.0.1:8089 QSTASH_TOKEN=... QSTASH_CURRENT_SIGNING_KEY=... \
 *     QSTASH_NEXT_SIGNING_KEY=... pnpm --filter @goblins/grader exec tsx scripts/local-flow-control.ts 60 10
 */
import { createServer } from "node:http";
import { Attempt, SubmissionId } from "@goblins/domain";
import { Redacted } from "effect";
import * as QStashQueue from "../src/QStashQueue.ts";

const [n = 60, parallelism = 10] = process.argv.slice(2).map(Number);
const env = (name: string) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};
const port = 8095;
const config: QStashQueue.QStashConfig = {
  token: Redacted.make(env("QSTASH_TOKEN")),
  baseUrl: env("QSTASH_URL"),
  currentSigningKey: Redacted.make(env("QSTASH_CURRENT_SIGNING_KEY")),
  nextSigningKey: Redacted.make(env("QSTASH_NEXT_SIGNING_KEY")),
  consumerUrl: `http://127.0.0.1:${port}/consume`,
  parallelism,
};
const verify = QStashQueue.makeVerify(config);
const spans: Array<{ start: number; end: number }> = [];
let rejected = 0;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const start = Date.now();
    if (!(await verify(String(req.headers["upstash-signature"] ?? ""), body))) {
      rejected++;
      res.writeHead(401).end();
      return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
    spans.push({ start, end: Date.now() });
    res.writeHead(200).end();
  });
});
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

const queue = QStashQueue.makeQueue(QStashQueue.makePublish(config));
const t0 = Date.now();
const { Effect } = await import("effect");
await Effect.runPromise(
  Effect.forEach(
    Array.from({ length: n }),
    () =>
      queue.enqueue({
        submissionId: SubmissionId.make(crypto.randomUUID()),
        attempt: Attempt.make(1),
      }),
    { concurrency: 20 },
  ),
);
while (spans.length + rejected < n) await new Promise((r) => setTimeout(r, 200));
const points = spans
  .flatMap((s) => [[s.start, 1] as const, [s.end, -1] as const])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let cur = 0;
let max = 0;
for (const [, d] of points) {
  cur += d;
  max = Math.max(max, cur);
}
console.log({
  n,
  parallelism,
  rejected,
  maxConcurrent: max,
  wallSeconds: (Date.now() - t0) / 1000,
  idealSeconds: (n * 5) / parallelism,
});
server.close();
process.exit(0);
