/**
 * The report's one lime button: practice in Goblins for the students who need it. It opens a
 * handoff screen that shows what Goblins would create and says what is simulated.
 */
import { Avatar, Badge, Button, Card, Dialog, DialogClose } from "@goblins/ui";
import { useState } from "react";
import { type PracticePlan, practiceUrl, studentList } from "../goblins";
import type { ReportStudent } from "../model";

type Plan = Exclude<PracticePlan, { _tag: "NotYet" }>;

const MAX_FACES = 7;

function Faces({ students }: { readonly students: ReadonlyArray<ReportStudent> }) {
  const shown = students.slice(0, MAX_FACES);
  const more = students.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((s) => (
          <Avatar
            key={s.id}
            kind="creature"
            creatureId={s.avatarId}
            name={s.displayName}
            size="sm"
            className="rounded-full ring-2 ring-green-800"
          />
        ))}
      </div>
      {more > 0 && <span className="ml-2 text-sm font-bold text-lime-100">+{more}</span>}
    </div>
  );
}

const copy = (plan: Plan) =>
  plan._tag === "Remediation"
    ? {
        eyebrow: "Next step",
        title: `Give ${plan.students.length === 1 ? "this student" : `these ${plan.students.length} students`} practice on this in Goblins`,
        body: "Goblins gives each student feedback as they work, so they fix the mistake while it’s fresh. Free for teachers.",
        button: "Create practice in Goblins",
        assignment: `Practice: ${plan.skills.join(" · ")}`,
      }
    : {
        eyebrow: "Nice work, class",
        title: `Stretch all ${plan.students.length} students with extension practice in Goblins`,
        body: "Everyone handled this one. Goblins can take them further on the same topic, with feedback as they work. Free for teachers.",
        button: "Create extension practice",
        assignment: `Extension: ${plan.skills.join(" · ")}`,
      };

export function PracticeCta({ plan }: { readonly plan: PracticePlan }) {
  const [open, setOpen] = useState(false);
  if (plan._tag === "NotYet") {
    return (
      <Card tone="sunken" padding="lg">
        <p className="m-0 text-sm text-text-muted">
          Practice suggestions appear here once the first grades are in.
        </p>
      </Card>
    );
  }
  const text = copy(plan);
  return (
    <section
      aria-labelledby="practice-title"
      className="flex flex-col gap-5 rounded-[var(--gb-radius-xl)] bg-green-800 p-6 text-white shadow-brand"
      data-testid="practice-cta"
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-[850] tracking-wider text-lime-400 uppercase">
          {text.eyebrow}
        </span>
        <h2 id="practice-title" className="text-xl leading-snug text-white!">
          {text.title}
        </h2>
      </div>
      <Faces students={plan.students} />
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {plan.skills.map((skill) => (
          <li
            key={skill}
            className="rounded-full bg-white/12 px-3 py-1 text-sm font-bold text-white"
          >
            {skill}
          </li>
        ))}
      </ul>
      <p className="m-0 text-sm text-green-100">{text.body}</p>
      <Button size="lg" onClick={() => setOpen(true)}>
        {text.button}
      </Button>
      <Handoff plan={plan} assignment={text.assignment} open={open} onOpenChange={setOpen} />
    </section>
  );
}

function Handoff({
  plan,
  assignment,
  open,
  onOpenChange,
}: {
  readonly plan: Plan;
  readonly assignment: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyNames = async () => {
    await navigator.clipboard.writeText(studentList(plan.students));
    setCopied(true);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Here’s what Goblins will create"
      description="A Goblins assignment for these students, on the skills they missed, with real-time feedback on."
      actions={
        <>
          <DialogClose>
            <Button variant="ghost">Not now</Button>
          </DialogClose>
          <a
            href={practiceUrl(plan)}
            target="_blank"
            rel="noopener"
            className="gb-button no-underline"
            data-variant="primary"
            data-size="md"
          >
            Open Goblins
          </a>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Card tone="tint" padding="md" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-lg font-[850] text-brand">{assignment}</span>
            <Badge tone="accent">Real-time feedback on</Badge>
          </div>
          <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
            <dt className="font-bold text-text-muted">Skills</dt>
            <dd className="m-0">{plan.skills.join(", ")}</dd>
            {plan._tag === "Remediation" && (
              <>
                <dt className="font-bold text-text-muted">Based on</dt>
                <dd className="m-0">
                  {plan.problemLabels.length === 1 ? "Problem" : "Problems"}{" "}
                  {plan.problemLabels.join(" and ")} of this worksheet
                </dd>
              </>
            )}
            <dt className="font-bold text-text-muted">Students</dt>
            <dd className="m-0 flex flex-col gap-2">
              <span>
                {plan.students.map((s) => s.displayName).join(", ")} ({plan.students.length})
              </span>
              <button
                type="button"
                onClick={copyNames}
                className="self-start text-sm font-bold text-brand underline underline-offset-4"
              >
                {copied ? "Copied" : "Copy names"}
              </button>
            </dd>
            <dt className="font-bold text-text-muted">Cost</dt>
            <dd className="m-0">Free on Goblins’ teacher plan</dd>
          </dl>
        </Card>
        <p className="m-0 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-text-muted">
          <strong className="text-text">This step is a demo.</strong> Goblins has no public API for
          creating assignments yet, so “Open Goblins” goes to Goblins’ free teacher sign-up with
          these skills in the link. Student names stay here: use “Copy names” to add them. With an
          integration, this one click would create the assignment for these students.
        </p>
      </div>
    </Dialog>
  );
}
