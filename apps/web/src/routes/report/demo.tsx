import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import { useMemo } from "react";
import { TeacherReport } from "../../report/components/TeacherReport";
import { DEMO_ASSIGNMENT, DEMO_MISTAKES, demoClass } from "../../report/fixture";

const Search = Schema.Struct({
  case: Schema.optionalWith(Schema.Literal("struggled", "did-well"), {
    default: () => "struggled",
  }),
});

/** A sample report on a made-up class, so anyone can see the payoff without running a class. */
export const Route = createFileRoute("/report/demo")({
  validateSearch: Schema.standardSchemaV1(Search),
  head: () => ({ meta: [{ title: `Sample report: ${DEMO_ASSIGNMENT.title} · Goblins Grader` }] }),
  component: DemoReport,
});

function DemoReport() {
  const { case: demoCase } = Route.useSearch();
  const input = useMemo(() => demoClass(demoCase), [demoCase]);
  const shareUrl = () =>
    Promise.resolve(new URL(`/share/demo?case=${demoCase}`, window.location.origin).toString());
  return (
    <TeacherReport
      meta={{
        title: DEMO_ASSIGNMENT.title,
        course: DEMO_ASSIGNMENT.course,
        topic: DEMO_ASSIGNMENT.topic,
        endedAt: DEMO_ASSIGNMENT.endedAt,
      }}
      input={input}
      mistakes={DEMO_MISTAKES}
      dashboardHref={null}
      createShareLink={shareUrl}
      notice={
        <p className="m-0 rounded-[var(--gb-radius-lg)] border border-dashed border-border-strong px-4 py-3 text-sm text-text-muted">
          <strong className="text-text">Sample report.</strong> A made-up Grade 8 class of 28 on an
          Illustrative Mathematics worksheet. Your report looks like this when you end a session.
        </p>
      }
    />
  );
}
