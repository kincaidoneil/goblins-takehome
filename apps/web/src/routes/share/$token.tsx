import { EmptyState } from "@goblins/ui";
import { createFileRoute } from "@tanstack/react-router";
import { SharedReport } from "../../report/components/SharedReport";
import { getSharedReport } from "../../server/report/fns";

/** A view-only class report. Names are removed on the server before this page gets the data. */
export const Route = createFileRoute("/share/$token")({
  loader: ({ params }) => getSharedReport({ data: { token: params.token } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?._tag === "Ok"
            ? `${loaderData.value.header.title}: class report · Goblins Grader`
            : "Class report · Goblins Grader",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const result = Route.useLoaderData();
  if (result._tag === "Err") {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4">
        <EmptyState
          title="This report link doesn’t work"
          description="Check that you copied the whole link, or ask the teacher who shared it for a new one."
        />
      </main>
    );
  }
  const { header, input, mistakes } = result.value;
  return (
    <SharedReport
      meta={{
        title: header.title,
        course: null,
        teacherName: header.teacherName,
        endedAt: header.endedAt,
        attribution: null,
      }}
      input={input}
      mistakes={mistakes}
    />
  );
}
