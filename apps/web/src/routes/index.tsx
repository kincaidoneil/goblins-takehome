import { SignInButton } from "@clerk/tanstack-react-start";
import { LandingPage, TEMPLATE_SUMMARIES } from "@goblins/ui/landing";
import landingCss from "@goblins/ui/landing.css?url";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { startDraftFromTemplate, startDraftFromUpload } from "../landing/setup";
import { toUploadResult } from "../landing/upload";

export const Route = createFileRoute("/")({
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
  return (
    <LandingPage
      templates={TEMPLATE_SUMMARIES}
      onFiles={async (files) => toUploadResult(await startDraftFromUpload(files))}
      onTemplate={async (templateId) => toUploadResult(await startDraftFromTemplate(templateId))}
      onStarted={(draftId) => void navigate({ to: "/setup/$draftId", params: { draftId } })}
      signIn={
        <SignInButton mode="modal">
          <button type="button" className="lp-signin">
            Sign in
          </button>
        </SignInButton>
      }
    />
  );
}
