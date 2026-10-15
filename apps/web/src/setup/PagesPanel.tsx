/** The original worksheet pages, beside the problems, so the teacher can check against them. */
import { useEffect, useRef } from "react";

export interface PagesPanelProps {
  readonly pages: ReadonlyArray<{ readonly pageNumber: number; readonly imageUrl: string }>;
  /** Pages of the problem the teacher is looking at, outlined. */
  readonly activePages: ReadonlyArray<number>;
  /** Scrolls to this page when it changes. */
  readonly focusPage: { readonly page: number; readonly at: number } | null;
  readonly onOpenPage: (pageNumber: number) => void;
}

export function PagesPanel({ pages, activePages, focusPage, onOpenPage }: PagesPanelProps) {
  const refs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (focusPage === null) return;
    refs.current.get(focusPage.page)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPage]);

  return (
    <section className="setup-pages" aria-label="Worksheet pages">
      {pages.map((page) => (
        <figure
          key={page.pageNumber}
          ref={(element) => {
            if (element === null) refs.current.delete(page.pageNumber);
            else refs.current.set(page.pageNumber, element);
          }}
          className="setup-page"
          data-active={activePages.includes(page.pageNumber) || undefined}
        >
          <button
            type="button"
            className="setup-page-button"
            onClick={() => onOpenPage(page.pageNumber)}
            aria-label={`Enlarge page ${page.pageNumber}`}
          >
            <img src={page.imageUrl} alt={`Worksheet page ${page.pageNumber}`} loading="lazy" />
          </button>
          <figcaption>Page {page.pageNumber}</figcaption>
        </figure>
      ))}
    </section>
  );
}
