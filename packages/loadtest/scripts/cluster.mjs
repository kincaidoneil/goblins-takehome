// Runs the app's production server in N worker processes sharing one port, as a rough local
// stand-in for Vercel running many function instances.
import cluster from "node:cluster";

const workers = Number(process.env.WORKERS ?? "6");
if (cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork();
  // A run with fewer workers than it claims would mislabel its report, so one worker exiting
  // stops the whole target and the load test sees it fail.
  cluster.on("exit", (w, code, signal) => {
    console.error(`worker ${w.process.pid} exited (${signal ?? code}); stopping the target`);
    for (const other of Object.values(cluster.workers ?? {})) other?.kill();
    process.exit(1);
  });
} else {
  // Point SERVER_ENTRY at the build, e.g. apps/web/.output/server/index.mjs.
  await import(process.env.SERVER_ENTRY ?? "../../../apps/web/.output/server/index.mjs");
}
