import { useEffect, useState } from "react";
import type { SessionRow } from "../../../lib/sync";

/** The current time, updated every `intervalMs`. */
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

export type SessionClock =
  | { readonly _tag: "Lobby" }
  | { readonly _tag: "Running"; readonly elapsedMs: number }
  | { readonly _tag: "Counting"; readonly remainingMs: number; readonly totalMs: number }
  | { readonly _tag: "TimeUp" }
  | { readonly _tag: "Ended" };

/** Where the session is in time. A time limit counts down from `startedAt`; without one, it counts up. */
export const sessionClock = (session: SessionRow, now: number): SessionClock => {
  if (session.status === "ended") return { _tag: "Ended" };
  if (session.status === "lobby" || session.startedAt === null) return { _tag: "Lobby" };
  const elapsedMs = Math.max(0, now - Date.parse(session.startedAt));
  if (session.timeLimitMinutes === null) return { _tag: "Running", elapsedMs };
  const totalMs = session.timeLimitMinutes * 60_000;
  const remainingMs = totalMs - elapsedMs;
  return remainingMs > 0 ? { _tag: "Counting", remainingMs, totalMs } : { _tag: "TimeUp" };
};

/** 12:05, or 1:02:05 past an hour. */
export const formatDuration = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** Counting down rounds up, so "0:00" appears only when time is up. */
export const formatRemaining = (ms: number) => formatDuration(Math.ceil(ms / 1000) * 1000);

/** "123 456": easier to read aloud and off a projector. */
export const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
