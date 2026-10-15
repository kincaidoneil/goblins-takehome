import { Button, CreatureArt, EmptyState, ToastProvider } from "@goblins/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import katexCss from "katex/dist/katex.min.css?url";
import { useEffect } from "react";
import type { Draft } from "../../server/setup/draft";
import { getDraft } from "../../server/setup/fns";
import { ExtractingView } from "../../setup/ExtractingView";
import { FailedView } from "../../setup/FailedView";
import { dashboardPath } from "../../setup/links";
import { SetupScreen } from "../../setup/SetupScreen";
import setupCss from "../../setup/setup.css?url";
import { templatePageUrls } from "../../setup/template-pages";

const Search = Schema.Struct({
  /** Set when returning from sign-in, to reopen the launch dialog. */
  launch: Schema.optional(Schema.Union(Schema.Literal("1"), Schema.Literal(1))),
  minutes: Schema.optional(Schema.Number),
});

export const Route = createFileRoute("/setup/$draftId")({
  validateSearch: Schema.standardSchemaV1(Search),
  loader: ({ params }) => getDraft({ data: { draftId: params.draftId } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?._tag === "Ok" && loaderData.value.draft.title !== ""
            ? `${loaderData.value.draft.title} · Goblins Grader`
            : "Set up your assignment · Goblins Grader",
      },
    ],
    links: [
      { rel: "stylesheet", href: katexCss },
      { rel: "stylesheet", href: setupCss },
    ],
  }),
  component: SetupRoute,
});

function SetupRoute() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const extracting = result._tag === "Ok" && result.value.draft.status._tag === "Extracting";

  // While the worksheet is read, check once a second. Setup has one writer, so polling a single
  // read is simpler than syncing the draft live.
  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => void router.invalidate(), 1000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  if (result._tag === "Err") {
    return (
      <div className="setup-centered">
        <EmptyState
          art={<CreatureArt id={12} size={96} title="" />}
          title="We can't find that assignment"
          description="It may have been started in another browser. Sign in there to launch it, or start a new one here."
          actions={
            <Button nativeButton={false} render={<a href="/" />}>
              Start a new assignment
            </Button>
          }
        />
      </div>
    );
  }

  const draft = withCurrentTemplatePages(result.value.draft);
  if (draft.launchedSessionId !== null) {
    return (
      <div className="setup-centered">
        <EmptyState
          art={<CreatureArt id={3} size={96} title="" />}
          title="This assignment is live"
          description="Its rubric is locked so every student is graded the same way."
          actions={
            <Button
              nativeButton={false}
              render={<a href={dashboardPath(draft.launchedSessionId)} />}
            >
              Open the dashboard
            </Button>
          }
        />
      </div>
    );
  }

  switch (draft.status._tag) {
    case "Extracting":
      return <ExtractingView pages={draft.pages} startedAt={draft.status.startedAt} />;
    case "Failed":
      return <FailedView reason={draft.status.reason} />;
    case "Ready":
      return (
        <ToastProvider>
          <SetupScreen
            key={draft.id}
            initial={draft}
            signedIn={result.value.signedIn}
            launchOnArrival={search.launch !== undefined}
            initialTimeLimit={search.minutes ?? null}
          />
        </ToastProvider>
      );
  }
}

/**
 * A template draft shows the template's pages from this build. That keeps old drafts working if a
 * page image changes, and it makes the browser bundle include the images the server points at.
 */
const withCurrentTemplatePages = (draft: Draft): Draft =>
  draft.templateId === null
    ? draft
    : {
        ...draft,
        pages: templatePageUrls(draft.templateId).map((imageUrl, index) => ({
          pageNumber: index + 1,
          imageUrl,
        })),
      };
