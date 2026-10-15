import { useEffect, useState } from "react";

/**
 * A one-line notice on screens that update live, shown only where Electric isn't running
 * (Vercel previews). Production and local development have it.
 */
export function LiveStatusBanner() {
  const [live, setLive] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/live")
      .then((response) => response.json())
      .then((body: unknown) => {
        if (cancelled) return;
        if (typeof body === "object" && body !== null && "live" in body && body.live === false) {
          setLive(false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (live) return null;
  return (
    <p className="bg-sun-100 px-4 py-1.5 text-center text-sm text-green-800">
      Live updates are off in this preview. Reload to see changes.
    </p>
  );
}
