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
  { after: 4, label: "Finding each problem" },
  { after: 10, label: "Writing answer keys" },
  { after: 16, label: "Drafting rubrics" },
] as const;

export function ExtractingView({ pages, startedAt }: ExtractingViewProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
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
        <span className="tabular-nums">{seconds}s</span> · usually under a minute. You can review
        everything before students see it.
      </p>
    </div>
  );
}
