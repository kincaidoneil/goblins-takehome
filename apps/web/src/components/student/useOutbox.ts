import { useEffect, useRef, useState } from "react";
import { type SubmitError, submit } from "../../server/fns/student";
import { clearBoard, loadOutbox, type OutboxItem, saveOutbox } from "./storage";

const MAX_BACKOFF_MS = 30_000;

export interface OutboxHandlers {
  /** The server has the submission. */
  onSent: (problemId: string) => void;
  /** The server refused it; the item is dropped. */
  onRejected: (problemId: string, error: SubmitError) => void;
}

/**
 * Submissions waiting to reach the server, kept in localStorage. Sends one at a time. A network
 * failure keeps the item and retries with backoff, and right away when the browser comes back
 * online. Retrying is safe because the server's submit is idempotent.
 */
export function useOutbox(sessionId: string, handlers: OutboxHandlers) {
  const [items, setItems] = useState<ReadonlyArray<OutboxItem>>(() => loadOutbox(sessionId));
  const [sending, setSending] = useState(false);
  /** Failed attempts in a row. Above zero means we're waiting on the network. */
  const [failures, setFailures] = useState(0);
  /** Bumped by the `online` event to retry without waiting out the backoff. */
  const [wake, setWake] = useState(0);
  const skipBackoff = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => saveOutbox(sessionId, items), [sessionId, items]);

  useEffect(() => {
    const onOnline = () => {
      skipBackoff.current = true;
      setWake((n) => n + 1);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `wake` restarts the wait on reconnect
  useEffect(() => {
    const head = items[0];
    if (head === undefined || sending) return;
    const delay =
      failures === 0 || skipBackoff.current ? 0 : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures);
    const timer = window.setTimeout(async () => {
      skipBackoff.current = false;
      setSending(true);
      const drop = () =>
        setItems((current) => current.filter((i) => i.problemId !== head.problemId));
      try {
        const result = await submit({ data: { sessionId, ...head } });
        setFailures(0);
        if (result._tag === "Ok") {
          drop();
          clearBoard(sessionId, head.problemId);
          handlersRef.current.onSent(head.problemId);
        } else if (result.error._tag === "SessionNotLive" || result.error._tag === "NotJoined") {
          // Nothing else in the queue can be accepted either.
          setItems([]);
          handlersRef.current.onRejected(head.problemId, result.error);
        } else {
          drop();
          handlersRef.current.onRejected(head.problemId, result.error);
        }
      } catch {
        // Offline, or the server failed unexpectedly. Keep the work and try again.
        setFailures((n) => n + 1);
      } finally {
        setSending(false);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [items, sending, failures, wake, sessionId]);

  return {
    items,
    /** True after a send failed, until one succeeds. */
    waitingForNetwork: failures > 0 && items.length > 0,
    add: (item: OutboxItem) =>
      setItems((current) => [...current.filter((i) => i.problemId !== item.problemId), item]),
  };
}
