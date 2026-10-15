import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import { useMemo } from "react";
import { anonymize, SharedReport } from "../../report/components/SharedReport";
import { DEMO_ASSIGNMENT, DEMO_MISTAKES, demoClass } from "../../report/fixture";

const Search = Schema.Struct({
  case: Schema.optionalWith(Schema.Literal("struggled", "did-well"), {
    default: () => "struggled",
  }),
});

/** The shared view of the sample report. */
export const Route = createFileRoute("/share/demo")({
  validateSearch: Schema.standardSchemaV1(Search),
  head: () => ({
    meta: [
      { title: `${DEMO_ASSIGNMENT.title}: class report · Goblins Grader` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoShare,
});

function DemoShare() {
  const { case: demoCase } = Route.useSearch();
  const input = useMemo(() => anonymize(demoClass(demoCase)), [demoCase]);
  return (
    <SharedReport
      meta={{
        title: DEMO_ASSIGNMENT.title,
        course: DEMO_ASSIGNMENT.course,
        teacherName: DEMO_ASSIGNMENT.teacherName,
        endedAt: DEMO_ASSIGNMENT.endedAt,
        attribution: DEMO_ASSIGNMENT.attribution,
      }}
      input={input}
      mistakes={DEMO_MISTAKES}
    />
  );
}
