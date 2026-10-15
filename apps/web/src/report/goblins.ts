/**
 * The handoff to Goblins. Goblins has no public API for creating assignments, so the report
 * opens Goblins' free teacher sign-up with the practice plan in the link, and the handoff
 * screen says plainly what an integration would do in one click.
 *
 * Student names never go in the link: a URL ends up in browser history, server logs and
 * analytics. With an integration, the roster would go server to server.
 */
import type { ProblemMistakes } from "./mistakes";
import type { ClassReport, ReportStudent } from "./model";

export const GOBLINS_SIGNUP_URL = "https://app.goblinsapp.com/onboard";
/** Goblins' home page, where "Book a Demo" lives. Goblins has no public contact page. */
export const GOBLINS_SCHOOLS_URL = "https://goblins.com/";
/** Goblins' published results from schools. */
export const GOBLINS_RESULTS_URL = "https://goblins.com/evidence";

export type PracticePlan =
  /** Some problems were weak: practice their skills, for the students who missed them. */
  | {
      readonly _tag: "Remediation";
      readonly students: ReadonlyArray<ReportStudent>;
      readonly skills: ReadonlyArray<string>;
      readonly problemLabels: ReadonlyArray<string>;
    }
  /** No weak problems: harder practice on the same topic for everyone who took part. */
  | {
      readonly _tag: "Extension";
      readonly students: ReadonlyArray<ReportStudent>;
      readonly skills: ReadonlyArray<string>;
    }
  /** Nothing scored yet, so there is nothing to base practice on. */
  | { readonly _tag: "NotYet" };

export function practicePlan(
  report: ClassReport,
  mistakes: ReadonlyArray<ProblemMistakes>,
  topic: string,
): PracticePlan {
  if (report.classAverage === null) return { _tag: "NotYet" };
  if (report.weak.length === 0) {
    return {
      _tag: "Extension",
      students: report.students.filter((s) => s.submitted > 0).map((s) => s.student),
      skills: [topic],
    };
  }
  const students = new Map<string, ReportStudent>();
  for (const stats of report.weak) {
    for (const miss of stats.misses) students.set(miss.student.id, miss.student);
  }
  const skillOf = new Map(mistakes.map((m) => [m.problemId, m.skill]));
  const skills = report.weak.map((w) => skillOf.get(w.problem.id) ?? `Problem ${w.problem.label}`);
  return {
    _tag: "Remediation",
    // Keep the class order, which is the order the teacher knows.
    students: report.students.map((s) => s.student).filter((s) => students.has(s.id)),
    skills: [...new Set(skills)],
    problemLabels: report.weak.map((w) => w.problem.label),
  };
}

const withParams = (base: string, params: Record<string, string>): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

/** Goblins' sign-up, carrying the skills and how many students, never who. */
export function practiceUrl(plan: Exclude<PracticePlan, { _tag: "NotYet" }>): string {
  return withParams(GOBLINS_SIGNUP_URL, {
    utm_source: "goblins-grader",
    utm_medium: "report",
    utm_campaign: plan._tag === "Remediation" ? "practice" : "extension",
    practice: plan._tag === "Remediation" ? "remediation" : "extension",
    skills: plan.skills.join("|"),
    students: String(plan.students.length),
    feedback: "on",
  });
}

/** Links from the shared page, tagged by who they are for. */
export const shareLinks = {
  teacherSignup: withParams(GOBLINS_SIGNUP_URL, {
    utm_source: "goblins-grader",
    utm_medium: "shared-report",
    utm_campaign: "teacher",
  }),
  schools: withParams(GOBLINS_SCHOOLS_URL, {
    utm_source: "goblins-grader",
    utm_medium: "shared-report",
    utm_campaign: "goblins-max",
  }),
  results: withParams(GOBLINS_RESULTS_URL, {
    utm_source: "goblins-grader",
    utm_medium: "shared-report",
    utm_campaign: "goblins-max",
  }),
} as const;

/** One name per line, for pasting into Goblins. */
export const studentList = (students: ReadonlyArray<ReportStudent>): string =>
  students.map((s) => s.displayName).join("\n");
