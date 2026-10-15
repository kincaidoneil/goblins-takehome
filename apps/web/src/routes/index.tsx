import { LandingPage, TEMPLATE_SUMMARIES } from "@goblins/ui/landing";
import landingCss from "@goblins/ui/landing.css?url";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect } from "react";
import { startDraftFromTemplate, startDraftFromUpload } from "../landing/setup";
import { toUploadResult } from "../landing/upload";
import { AccountButton, clerkEnabled, SignInTrigger, useTeacherAuth } from "../lib/auth";

/** `?new=1` keeps a signed-in teacher here to start an assignment instead of going to /classes. */
const LandingSearch = Schema.standardSchemaV1(
  Schema.Struct({ new: Schema.optional(Schema.Literal(1, "1")) }),
);

export const Route = createFileRoute("/")({
  validateSearch: LandingSearch,
  head: () => ({
    meta: [
      { title: "Goblins Grader · Grade your next test for you" },
      {
        name: "description",
        content:
          "Drop in the worksheet you were going to hand out anyway. Students show their work, and you get a graded class. Free for teachers.",
      },
    ],
    links: [{ rel: "stylesheet", href: landingCss }],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { isSignedIn } = useTeacherAuth();
  const { new: startingNew } = Route.useSearch();
  // A returning signed-in teacher goes to their classes. Local sign-in mode (no Clerk) counts every
  // visitor as signed in, so it stays on the landing page.
  useEffect(() => {
    if (clerkEnabled && isSignedIn === true && startingNew === undefined) {
      void navigate({ to: "/classes", replace: true });
    }
  }, [isSignedIn, startingNew, navigate]);
  return (
    <LandingPage
      templates={TEMPLATE_SUMMARIES}
      onFiles={async (files) => toUploadResult(await startDraftFromUpload(files))}
      onTemplate={async (templateId) => toUploadResult(await startDraftFromTemplate(templateId))}
      onStarted={(draftId) => void navigate({ to: "/setup/$draftId", params: { draftId } })}
      signIn={<HeaderAccount isSignedIn={isSignedIn} />}
    />
  );
}

/**
 * Signed in: a link to the teacher's classes and the account menu. Signed out: Clerk's sign-in.
 * While Clerk loads, nothing, so a signed-in teacher can't click "Sign in" (Clerk refuses it).
 */
function HeaderAccount({ isSignedIn }: { readonly isSignedIn: boolean | undefined }) {
  if (isSignedIn === undefined) return <span />;
  if (isSignedIn) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Link to="/classes" className="lp-signin">
          My classes
        </Link>
        <AccountButton />
      </span>
    );
  }
  return (
    <SignInTrigger redirectUrl="/classes">
      <button type="button" className="lp-signin">
        Sign in
      </button>
    </SignInTrigger>
  );
}
