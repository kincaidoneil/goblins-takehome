import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-3xl">Grade your next test for you</h1>
      <p className="mt-4 text-text-muted">The landing page stream owns this route.</p>
    </main>
  );
}
