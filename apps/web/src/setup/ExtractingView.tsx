/**
 * Shown while the worksheet is read, which takes seconds to a minute. Shows the pages being read
 * and how long it has taken, so the wait never looks stuck.
 */
import { type CSSProperties, useEffect, useState } from "react";

export interface ExtractingViewProps {
  readonly pages: ReadonlyArray<{ readonly pageNumber: number; readonly imageUrl: string }>;
  readonly startedAt: string;
}

const STEPS = [
  { after: 0, label: "Reading the pages" },
  { after: 5, label: "Finding each problem" },
  { after: 20, label: "Writing answer keys" },
  { after: 40, label: "Drafting rubrics" },
] as const;

export function ExtractingView({ pages, startedAt }: ExtractingViewProps) {
  // Null until mounted: the server's clock would not match the browser's, and hydration would fail.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const current = STEPS.findLastIndex((step) => seconds >= step.after);

  return (
    <div className="setup-extracting">
      <div className="setup-extracting-pages" aria-hidden="true">
        {pages.slice(0, 4).map((page, index) => (
          <div
            key={page.pageNumber}
            className="setup-extracting-page"
            style={{ "--i": index } as CSSProperties}
          >
            <img src={page.imageUrl} alt="" />
            {index === Math.min(current, pages.length - 1, 3) && (
              <span className="setup-scanline" />
            )}
          </div>
        ))}
      </div>
      <h1 className="setup-extracting-title">Reading your worksheet</h1>
      <ol className="setup-extracting-steps" aria-live="polite">
        {STEPS.map((step, index) => (
          <li
            key={step.label}
            data-state={index < current ? "done" : index === current ? "active" : "todo"}
          >
            <span className="setup-step-dot" aria-hidden="true" />
            {step.label}
            {index === 0 && ` (${pages.length} ${pages.length === 1 ? "page" : "pages"})`}
          </li>
        ))}
      </ol>
      <p className="setup-extracting-time">
        <span className="tabular-nums">{seconds}s</span> · usually about a minute. You'll review
        everything before students see it.
      </p>
    </div>
  );
}
