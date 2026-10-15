import { type ReactNode, useEffect } from "react";

/**
 * A panel docked to the right of the dashboard. Not modal: the grid stays live and clickable
 * beside it, so the teacher can open another cell without closing this one. Escape closes it.
 */
export function SidePanel(props: {
  readonly label: string;
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label={props.label}
      className="fixed top-3 right-3 bottom-3 z-40 flex w-[min(640px,calc(100vw-24px))] animate-pop flex-col overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-border"
    >
      <header className="flex items-center gap-3 border-border border-b px-5 py-3">
        <div className="min-w-0 flex-1">{props.header}</div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full text-text-muted text-xl hover:bg-surface-sunken"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">{props.children}</div>
      <footer className="flex flex-wrap items-center justify-end gap-3 border-border border-t bg-surface-sunken px-5 py-3">
        {props.footer}
      </footer>
    </aside>
  );
}
