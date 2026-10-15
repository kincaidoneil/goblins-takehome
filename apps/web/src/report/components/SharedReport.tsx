/**
 * The view-only report behind a share link. It shows class-level results without names, then
 * pitches Goblins: the free plan to teachers, Goblins Max to school and district leaders.
 */
import { useMemo } from "react";
import { shareLinks } from "../goblins";
import { groupByRubricLine, type ProblemMistakes } from "../mistakes";
import { buildReport, type ReportInput } from "../model";
import { Distribution, ProblemTable, Struggles, SummaryStats } from "./sections";

export interface SharedMeta {
  readonly title: string;
  readonly course: string | null;
  readonly teacherName: string;
  readonly endedAt: string | null;
  /** The worksheet's license attribution, when it came from a template. */
  readonly attribution: string | null;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function SharedReport({
  meta,
  input,
  mistakes,
}: {
  readonly meta: SharedMeta;
  /** Already anonymized. */
  readonly input: ReportInput;
  readonly mistakes: ReadonlyArray<ProblemMistakes>;
}) {
  const report = useMemo(() => buildReport(input), [input]);
  return (
    <main className="min-h-dvh bg-bg pb-16">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="text-base font-[850] text-brand no-underline">
            Goblins Grader
          </a>
          <span className="text-sm text-text-muted">View-only class report</span>
        </div>
      </div>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-8 sm:px-6 sm:pt-12">
        <header className="flex flex-col gap-3 px-1">
          <p className="m-0 text-sm font-bold text-text-muted">
            Shared by {meta.teacherName}
            {meta.course !== null && ` · ${meta.course}`}
            {meta.endedAt !== null && ` · ${formatDate(meta.endedAt)}`}
          </p>
          <h1 className="text-[2rem] sm:text-[2.5rem]">{meta.title}</h1>
          <p className="m-0 max-w-2xl text-text">
            {report.studentCount} students worked through this worksheet on their own devices, and
            Goblins Grader graded every problem. Here’s how the class did. Student names are hidden.
          </p>
        </header>

        <SummaryStats report={report} />
        <Distribution report={report} names={false} />
        <ProblemTable report={report} />
        <Struggles report={report} mistakes={mistakes} names={false} fallback={groupByRubricLine} />
        <Pitch />
        {meta.attribution !== null && (
          <p className="m-0 px-1 text-xs text-text-subtle">Worksheet: {meta.attribution}</p>
        )}
      </div>
    </main>
  );
}

function Pitch() {
  return (
    <section aria-labelledby="pitch-title" className="flex flex-col gap-4 pt-6">
      <h2 id="pitch-title" className="px-1 text-xl">
        Want this for your classes?
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-[var(--gb-radius-xl)] bg-green-800 p-6 text-white shadow-brand">
          <span className="text-xs font-[850] tracking-wider text-lime-400 uppercase">
            For teachers
          </span>
          <h3 className="text-xl text-white!">Try Goblins, free for teachers</h3>
          <p className="m-0 text-sm text-green-100">
            Goblins gives every student feedback as they work through math practice, and shows you
            where the class is stuck. This report came from Goblins Grader, its free auto-grader:
            upload a worksheet you already have, students show their work on a whiteboard, and you
            get it graded.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3">
            <a
              href={shareLinks.teacherSignup}
              className="gb-button no-underline"
              data-variant="primary"
              data-size="lg"
            >
              Try Goblins free
            </a>
            <a href="/" className="text-sm font-bold text-white underline underline-offset-4">
              Grade a worksheet
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-[var(--gb-radius-xl)] border border-border bg-surface p-6 shadow-md">
          <span className="text-xs font-[850] tracking-wider text-brand uppercase">
            For school and district leaders
          </span>
          <h3 className="text-xl">Goblins Max for your school or district</h3>
          <p className="m-0 text-sm text-text">
            Once a teacher assigns work in Goblins, students keep coming back: in some cohorts, 82%
            are still practicing 90 days later. Goblins Max brings Goblins to every math classroom
            in your school or district.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3">
            <a
              href={shareLinks.schools}
              className="gb-button no-underline"
              data-variant="brand"
              data-size="lg"
            >
              Talk to the Goblins team
            </a>
            <a
              href={shareLinks.results}
              className="text-sm font-bold text-brand underline underline-offset-4"
            >
              See results from schools
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
