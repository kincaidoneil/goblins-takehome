/**
 * The report's sections, shared by the teacher's report and the view-only shared page. Each
 * takes `names`: the shared page passes false and never receives names in the first place.
 */
import { Avatar, Badge, Card, Tooltip } from "@goblins/ui";
import type { ReactNode } from "react";
import { type ProblemMistakes, type ShownGroup, showGroups } from "../mistakes";
import {
  type Bucket,
  type ClassReport,
  minutesSaved,
  type ProblemStats,
  percent,
  type ReportStudent,
} from "../model";
import { problemExcerpt, problemLines } from "../text";

export function Section({
  title,
  description,
  children,
  id,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly id?: string;
}) {
  return (
    <Card padding="lg" className="flex flex-col gap-5" id={id}>
      <header className="flex flex-col gap-1">
        <h2 className="text-xl">{title}</h2>
        {description !== undefined && <div className="text-sm text-text-muted">{description}</div>}
      </header>
      {children}
    </Card>
  );
}

const hoursAndMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
};

function Stat({
  value,
  label,
  detail,
}: {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="order-2 text-sm font-bold text-text">{label}</dt>
      <dd className="order-1 m-0 text-[2rem] leading-none whitespace-nowrap font-[850] tracking-tight text-brand tabular-nums">
        {value}
      </dd>
      {detail !== undefined && <dd className="order-3 m-0 text-xs text-text-muted">{detail}</dd>}
    </div>
  );
}

export function SummaryStats({ report }: { readonly report: ClassReport }) {
  const saved = minutesSaved(report);
  return (
    <Card padding="lg">
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat
          value={`${report.finished}/${report.studentCount}`}
          label="finished every problem"
          detail={`${report.submissions} problems submitted`}
        />
        <Stat
          value={report.classAverage === null ? "–" : percent(report.classAverage)}
          label="class average"
          detail="on graded work"
        />
        <Stat
          value={String(report.weak.length)}
          label={report.weak.length === 1 ? "problem to revisit" : "problems to revisit"}
          detail={report.weak.length === 0 ? "every problem went well" : "class average below 75%"}
        />
        <Stat
          value={hoursAndMinutes(saved)}
          label="of grading done for you"
          detail="at about 30 seconds a problem"
        />
      </dl>
    </Card>
  );
}

const BAND_BG = {
  full: "bg-[var(--gb-score-full-bg)]",
  partial: "bg-[var(--gb-score-partial-bg)]",
  low: "bg-[var(--gb-score-low-bg)]",
} as const;

function StudentMark({
  student,
  score,
  names,
}: {
  readonly student: ReportStudent;
  readonly score: number | null;
  readonly names: boolean;
}) {
  if (!names) {
    return <span className="block size-6 rounded-full bg-green-700/70" aria-hidden="true" />;
  }
  const label = `${student.displayName}${score === null ? "" : `: ${percent(score)}`}`;
  return (
    <Tooltip content={label}>
      <button type="button" className="block rounded-full" aria-label={label}>
        <Avatar
          kind="creature"
          creatureId={student.avatarId}
          name={student.displayName}
          size="sm"
        />
      </button>
    </Tooltip>
  );
}

/** One column per score range, with a mark for each student. */
export function Distribution({
  report,
  names,
}: {
  readonly report: ClassReport;
  readonly names: boolean;
}) {
  const columns = [...report.distribution].reverse();
  const unscored = report.students.filter((s) => s.score === null).length;
  return (
    <Section
      title="How the class scored"
      description={
        <>
          Each {names ? "creature" : "dot"} is one student’s score on the work graded so far.
          {unscored > 0 &&
            ` ${unscored} student${unscored === 1 ? " has" : "s have"} no graded work yet.`}
        </>
      }
    >
      <ul
        className="m-0 grid list-none gap-2 p-0 sm:grid-cols-5 sm:items-end sm:gap-4"
        aria-label="Students by score"
      >
        {columns.map((bucket) => (
          <DistributionColumn key={bucket.label} bucket={bucket} names={names} />
        ))}
      </ul>
    </Section>
  );
}

function DistributionColumn({
  bucket,
  names,
}: {
  readonly bucket: Bucket;
  readonly names: boolean;
}) {
  const count = bucket.students.length;
  // A column per range on wide screens; a row per range on phones.
  return (
    <li
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 sm:flex sm:min-w-0 sm:flex-col sm:items-stretch sm:gap-2"
      aria-label={`${bucket.label}: ${count} ${count === 1 ? "student" : "students"}`}
    >
      <span className="hidden text-center text-sm font-bold text-text tabular-nums sm:block">
        {count}
      </span>
      <span className="flex flex-col text-xs font-bold whitespace-nowrap text-text-muted sm:order-last sm:text-center">
        {bucket.label}
        <span className="text-sm text-text tabular-nums sm:hidden">{count}</span>
      </span>
      <div
        className={`flex min-h-9 flex-wrap content-start gap-1 rounded-lg p-1.5 sm:min-h-12 sm:flex-wrap-reverse sm:justify-center ${BAND_BG[bucket.band]}`}
      >
        {bucket.students.map((s) => (
          <StudentMark key={s.student.id} student={s.student} score={s.score} names={names} />
        ))}
      </div>
    </li>
  );
}

/** Counts of each outcome on one problem, as one bar. */
export function OutcomeBar({ stats }: { readonly stats: ProblemStats }) {
  const parts = [
    { key: "full", n: stats.full, className: BAND_BG.full, label: "full credit" },
    { key: "partial", n: stats.partial, className: BAND_BG.partial, label: "partial credit" },
    { key: "low", n: stats.low, className: BAND_BG.low, label: "under half credit" },
    {
      key: "pending",
      n: stats.grading + stats.waitingOnTeacher,
      className: "bg-[var(--gb-score-needs-bg)]",
      label: "not final yet",
    },
    {
      key: "none",
      n: stats.notSubmitted,
      className: "bg-surface-sunken",
      label: "not submitted",
    },
  ].filter((p) => p.n > 0);
  const total = parts.reduce((sum, p) => sum + p.n, 0);
  const summary = parts.map((p) => `${p.n} ${p.label}`).join(", ");
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label={summary}>
      {parts.map((p) => (
        <span
          key={p.key}
          className={`${p.className} h-full border-r-2 border-surface last:border-r-0`}
          style={{ width: `${(p.n / Math.max(1, total)) * 100}%` }}
          title={`${p.n} ${p.label}`}
        />
      ))}
    </div>
  );
}

export function Legend() {
  const items = [
    ["bg-[var(--gb-score-full-bg)]", "Full credit"],
    ["bg-[var(--gb-score-partial-bg)]", "Partial"],
    ["bg-[var(--gb-score-low-bg)]", "Under half"],
    ["bg-[var(--gb-score-needs-bg)]", "Not final yet"],
    ["bg-surface-sunken", "Not submitted"],
  ] as const;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-text-muted">
      {items.map(([className, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${className}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

const averageText = (stats: ProblemStats) =>
  stats.average === null ? "–" : percent(stats.average);

export function ProblemTable({ report }: { readonly report: ClassReport }) {
  const weak = new Set(report.weak.map((w) => w.problem.id));
  return (
    <Section title="Problem by problem" description={<Legend />}>
      <ol className="m-0 flex list-none flex-col p-0">
        {report.problems.map((stats) => (
          <li
            key={stats.problem.id}
            className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-2 border-t border-border py-3 first:border-t-0 first:pt-0 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,14rem)_3.5rem]"
          >
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-sm font-[850] text-brand">
              {stats.problem.label}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="line-clamp-2 text-sm sm:line-clamp-1">
                {problemExcerpt(stats.problem.text, 70)}
              </span>
              {weak.has(stats.problem.id) && (
                <a href={`#problem-${stats.problem.id}`} className="shrink-0 no-underline">
                  <Badge tone="warning">Revisit</Badge>
                </a>
              )}
            </span>
            <span className="col-span-3 col-start-1 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
              <OutcomeBar stats={stats} />
            </span>
            <span className="text-right text-base font-[850] text-text tabular-nums sm:col-start-4">
              {averageText(stats)}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function StudentChips({
  students,
  names,
}: {
  readonly students: ReadonlyArray<ReportStudent>;
  readonly names: boolean;
}) {
  if (!names) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {students.map((s) => (
        <li
          key={s.id}
          className="flex items-center gap-1.5 rounded-full bg-surface-sunken py-0.5 pr-2.5 pl-0.5 text-sm font-bold"
        >
          <Avatar kind="creature" creatureId={s.avatarId} size="xs" name={s.displayName} />
          {s.displayName}
        </li>
      ))}
    </ul>
  );
}

function MistakeRow({ group, names }: { readonly group: ShownGroup; readonly names: boolean }) {
  const n = group.students.length;
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <span className="row-span-2 flex flex-col items-center leading-none">
        <span className="text-2xl font-[850] text-brand tabular-nums">{n}</span>
        <span className="text-xs text-text-muted">{n === 1 ? "student" : "students"}</span>
      </span>
      <p className="m-0 font-bold text-text">{group.description}</p>
      <StudentChips students={group.students} names={names} />
    </li>
  );
}

function StruggleCard({
  stats,
  mistakes,
  names,
}: {
  readonly stats: ProblemStats;
  readonly mistakes: ProblemMistakes;
  readonly names: boolean;
}) {
  const groups = showGroups(stats, mistakes);
  const scored = stats.full + stats.partial + stats.low;
  const pending = stats.pendingStudents;
  return (
    <Card
      padding="lg"
      id={`problem-${stats.problem.id}`}
      className="flex scroll-mt-6 flex-col gap-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-text-muted">Problem {stats.problem.label}</span>
          <h3 className="text-lg">{mistakes.skill}</h3>
        </div>
        <div className="text-right">
          <span className="block text-2xl leading-none font-[850] text-text tabular-nums">
            {averageText(stats)}
          </span>
          <span className="text-xs text-text-muted">
            {stats.misses.length} of {scored} lost points
          </span>
        </div>
      </header>
      <blockquote className="m-0 flex flex-col gap-1 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-text-muted">
        {problemLines(stats.problem.text).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </blockquote>
      <OutcomeBar stats={stats} />
      <div className="flex flex-col gap-3">
        <h4 className="text-base">Common mistakes</h4>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {groups.map((group) => (
            <MistakeRow key={group.description} group={group} names={names} />
          ))}
        </ul>
      </div>
      {pending.length > 0 && (
        <p className="m-0 rounded-lg bg-[var(--gb-score-needs-bg)] px-4 py-2.5 text-sm text-[var(--gb-score-needs-fg)]">
          {pending.length === 1 ? "1 grade" : `${pending.length} grades`} on this problem{" "}
          {pending.length === 1 ? "isn’t" : "aren’t"} final yet
          {names ? ` (${pending.map((s) => s.displayName).join(", ")})` : ""}. They’ll appear here
          once they’re graded.
        </p>
      )}
      <p className="m-0 text-xs text-text-subtle">
        {mistakes.source === "model"
          ? "Mistakes grouped by AI from the grader’s reason for each score."
          : "Grouped by the rubric line students missed."}
      </p>
    </Card>
  );
}

export function Struggles({
  report,
  mistakes,
  names,
  fallback,
}: {
  readonly report: ClassReport;
  readonly mistakes: ReadonlyArray<ProblemMistakes>;
  readonly names: boolean;
  /** Mistakes for a weak problem with no grouping yet. */
  readonly fallback: (stats: ProblemStats) => ProblemMistakes;
}) {
  if (report.weak.length === 0) return null;
  const byProblem = new Map(mistakes.map((m) => [m.problemId, m]));
  return (
    <section className="flex flex-col gap-4" aria-labelledby="struggles-title">
      <header className="flex flex-col gap-1 px-1">
        <h2 id="struggles-title" className="text-xl">
          Where students struggled
        </h2>
        <p className="m-0 text-sm text-text-muted">
          The {report.weak.length === 1 ? "problem" : `${report.weak.length} problems`} with the
          lowest class average, and the mistakes behind {report.weak.length === 1 ? "it" : "them"}.
        </p>
      </header>
      {report.weak.map((stats) => (
        <StruggleCard
          key={stats.problem.id}
          stats={stats}
          mistakes={byProblem.get(stats.problem.id) ?? fallback(stats)}
          names={names}
        />
      ))}
    </section>
  );
}
