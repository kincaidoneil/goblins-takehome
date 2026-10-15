/**
 * The teacher's class report: summary, how the class scored, problem by problem, where students
 * struggled, and the Goblins practice CTA. It is a pure view of its input, so the live route
 * re-renders it as pending grades resolve.
 */
import { TooltipProvider } from "@goblins/ui";
import { type ReactNode, useMemo } from "react";
import { practicePlan } from "../goblins";
import { groupByRubricLine, type ProblemMistakes } from "../mistakes";
import { buildReport, type ReportInput } from "../model";
import { PracticeCta } from "./PracticeCta";
import { ShareCard } from "./ShareCard";
import { Distribution, ProblemTable, Struggles, SummaryStats } from "./sections";

export interface ReportMeta {
  readonly title: string;
  readonly course: string | null;
  readonly topic: string;
  /** ISO time the session ended, or null while it is still live. */
  readonly endedAt: string | null;
}

const formatEnded = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function TeacherReport({
  meta,
  input,
  mistakes,
  dashboardHref,
  createShareLink,
  notice,
}: {
  readonly meta: ReportMeta;
  readonly input: ReportInput;
  readonly mistakes: ReadonlyArray<ProblemMistakes>;
  /** Where the teacher checks pending grades. */
  readonly dashboardHref: string | null;
  readonly createShareLink: () => Promise<string | null>;
  /** A line above the report, such as the sample report's explanation. */
  readonly notice?: ReactNode;
}) {
  const report = useMemo(() => buildReport(input), [input]);
  const plan = practicePlan(report, mistakes, meta.topic);
  const pending = report.grading + report.waitingOnTeacher;

  return (
    <TooltipProvider>
      <main className="min-h-dvh bg-bg px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {notice}
          <header className="flex flex-col gap-2 px-1">
            <p className="m-0 text-sm font-bold text-text-muted">
              Class report
              {meta.course !== null && ` · ${meta.course}`}
              {meta.endedAt !== null && ` · Ended ${formatEnded(meta.endedAt)}`}
            </p>
            <h1 className="text-[2rem] sm:text-[2.5rem]">{meta.title}</h1>
          </header>

          {pending > 0 && (
            <div
              className="flex flex-col gap-3 rounded-[var(--gb-radius-lg)] bg-[var(--gb-score-needs-bg)] px-5 py-4 text-[var(--gb-score-needs-fg)] sm:flex-row sm:items-center sm:justify-between"
              role="status"
              data-testid="pending-banner"
            >
              <p className="m-0 text-sm">
                <strong>
                  {pending} {pending === 1 ? "grade isn’t" : "grades aren’t"} final yet.
                </strong>{" "}
                {report.waitingOnTeacher > 0 &&
                  `${report.waitingOnTeacher} ${report.waitingOnTeacher === 1 ? "is" : "are"} waiting on you${report.grading > 0 ? ", and " : ". "}`}
                {report.grading > 0 &&
                  `${report.grading} ${report.grading === 1 ? "is" : "are"} still being graded. `}
                This report updates as they come in.
              </p>
              {dashboardHref !== null && report.waitingOnTeacher > 0 && (
                <a
                  href={dashboardHref}
                  className="shrink-0 text-sm font-[850] text-[var(--gb-score-needs-fg)] underline underline-offset-4"
                >
                  Check them
                </a>
              )}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <SummaryStats report={report} />
            <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start lg:sticky lg:top-6">
              <PracticeCta plan={plan} />
              <ShareCard title={meta.title} createLink={createShareLink} />
            </aside>
            <Distribution report={report} names />
            <ProblemTable report={report} />
            <Struggles report={report} mistakes={mistakes} names fallback={groupByRubricLine} />
          </div>
        </div>
      </main>
    </TooltipProvider>
  );
}
