/**
 * ESM stand-in for `use-sync-external-store/shim/with-selector`, aliased in vite.config.ts for the
 * same reason as the plain shim. Same algorithm as React's MIT-licensed implementation: memoize the
 * selection per snapshot so an unchanged selection keeps its identity.
 */
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<{ hasValue: false } | { hasValue: true; value: Selection }>({
    hasValue: false,
  });

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;
    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        const inst = instRef.current;
        if (isEqual !== undefined && inst.hasValue && isEqual(inst.value, nextSelection)) {
          memoizedSelection = inst.value;
          return inst.value;
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }
      if (Object.is(memoizedSnapshot, nextSnapshot)) return memoizedSelection;
      const nextSelection = selector(nextSnapshot);
      if (isEqual?.(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
    const serverSnapshot = getServerSnapshot ?? undefined;
    return [
      () => memoizedSelector(getSnapshot()),
      serverSnapshot === undefined ? undefined : () => memoizedSelector(serverSnapshot()),
    ] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    instRef.current = { hasValue: true, value };
  }, [value]);

  useDebugValue(value);
  return value;
}
