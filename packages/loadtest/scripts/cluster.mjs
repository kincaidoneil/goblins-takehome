// Runs the app's production server in N worker processes sharing one port, as a rough local
// stand-in for Vercel running many function instances.
import cluster from "node:cluster";

const workers = Number(process.env.WORKERS ?? "6");
if (cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (w, code) => console.log(`worker ${w.process.pid} exited ${code}`));
} else {
  // Point SERVER_ENTRY at the build, e.g. apps/web/.output/server/index.mjs.
  await import(process.env.SERVER_ENTRY ?? "../../../apps/web/.output/server/index.mjs");
}
