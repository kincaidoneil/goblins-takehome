import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/play/$sessionId")({ component: Play });

/** The student flow (lobby, problems, summary) lands here. */
function Play() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl">You're in!</h1>
      <p className="mt-3 text-text-muted">Waiting for your teacher to start.</p>
    </main>
  );
}
