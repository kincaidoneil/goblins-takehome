import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountButton, useTeacherAuth } from "../../lib/auth";

/** The bar along the top of every teacher screen. */
export function TeacherHeader({ children }: { readonly children?: ReactNode }) {
  const { isSignedIn } = useTeacherAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-black text-brand text-lg">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-accent text-text-on-accent"
          >
            G
          </span>
          <span className="hidden sm:inline">Goblins Grader</span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
        {isSignedIn === true && (
          <>
            <Link
              to="/classes"
              className="shrink-0 font-bold text-brand text-sm no-underline hover:underline"
            >
              My classes
            </Link>
            <AccountButton />
          </>
        )}
      </div>
    </header>
  );
}
