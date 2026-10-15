import { templates } from "@goblins/templates";
import { Badge, Button, Card } from "@goblins/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TeacherHeader } from "../components/teacher/TeacherHeader";
import { startFromTemplate } from "../server/fns/assignments";

export const Route = createFileRoute("/new")({
  head: () => ({ meta: [{ title: "Pick a worksheet · Goblins Auto-Grader" }] }),
  component: NewAssignment,
});

const FEATURE_LABELS = {
  diagrams: "Diagrams",
  "dependent-parts": "Parts that build on each other",
  "multi-page-problem": "Multi-page problem",
  "skills-practice": "Skills practice",
} as const;

/** The template picker. The landing page's drop zone is the other way in. */
function NewAssignment() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  const start = async (templateId: string) => {
    setPending(templateId);
    const result = await startFromTemplate({ data: { templateId } });
    if (result._tag === "Ok") {
      await navigate({
        to: "/assignments/$assignmentId",
        params: { assignmentId: result.value.assignmentId },
      });
      return;
    }
    setPending(null);
  };

  return (
    <div className="min-h-dvh bg-bg">
      <TeacherHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl">Start from a worksheet</h1>
        <p className="mt-2 max-w-2xl text-text-muted">
          Real practice sets from Illustrative Mathematics, with answer keys checked by hand. You'll
          review every problem and rubric before students see anything.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <span>{template.course}</span>
                  <span aria-hidden="true">·</span>
                  <span>{template.topic}</span>
                </div>
                <h2 className="text-lg">{template.title}</h2>
                <p className="text-text-muted">{template.description}</p>
                <div className="flex flex-wrap gap-2">
                  {template.features.map((feature) => (
                    <Badge key={feature} appearance="outline" tone="brand">
                      {FEATURE_LABELS[feature]}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-text-subtle">{template.source.attribution}</p>
                <div className="mt-auto pt-2">
                  <Button
                    variant="brand"
                    onClick={() => start(template.id)}
                    disabled={pending !== null}
                  >
                    {pending === template.id ? "Setting up…" : "Use this worksheet"}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
