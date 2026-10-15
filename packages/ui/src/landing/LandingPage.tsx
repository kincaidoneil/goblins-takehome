import { useRef } from "react";
import { CreatureArt } from "../components/creatures";
import { ScoreChip } from "../components/ScoreChip";
import { DropZone, type DropZoneState } from "./DropZone";
import { GradedWorksheet } from "./GradedWorksheet";
import { TemplatePicker } from "./TemplatePicker";
import type { TemplateSummary } from "./templates";
import type { UploadResult } from "./upload";

export interface LandingPageProps {
  templates: ReadonlyArray<TemplateSummary>;
  /** The setup flow's entry point for an uploaded worksheet. */
  onFiles: (files: ReadonlyArray<File>) => Promise<UploadResult>;
  /** The setup flow's entry point for a template. */
  onTemplate: (templateId: string) => void;
  /** Navigates to the new draft's setup screen. */
  onStarted: (draftId: string) => void;
  signInHref: string;
  /** For stories: the drop zone's starting state. */
  dropZoneState?: DropZoneState;
}

const STEPS = [
  {
    title: "Drop in your worksheet",
    body: "We turn it into problems, answer keys and rubrics in plain words. Fix anything by typing or by asking.",
  },
  {
    title: "Students show their work",
    body: "They join with a code on the board and work each problem on a whiteboard. No accounts.",
  },
  {
    title: "Get a graded class",
    body: "Scores fill in as they go. You check only the few the grader flags, and get a report of where the class struggled.",
  },
] as const;

export function LandingPage({
  templates,
  onFiles,
  onTemplate,
  onStarted,
  signInHref,
  dropZoneState,
}: LandingPageProps) {
  const templatesRef = useRef<HTMLElement>(null);
  const showTemplates = () => {
    templatesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    templatesRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="lp">
      <header className="lp-header">
        <a className="lp-wordmark" href="/">
          <CreatureArt id={0} size={36} title="" />
          <span>
            Goblins <span className="lp-wordmark-sub">Grader</span>
          </span>
        </a>
        <a className="lp-signin" href={signInHref}>
          Sign in
        </a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Free for teachers</p>
            <h1 className="lp-title">Grade your next test for you.</h1>
            <p className="lp-lede">
              Drop in the worksheet you were going to hand out anyway. Students show their work, and
              you get a graded class without grading a thing.
            </p>
            <div className="lp-proof" aria-hidden="true">
              <div className="lp-proof-chips">
                <ScoreChip status={{ state: "graded", points: 2, maxPoints: 2 }} size="sm" />
                <ScoreChip status={{ state: "graded", points: 1, maxPoints: 2 }} size="sm" />
                <ScoreChip status={{ state: "needs-teacher" }} size="sm" />
              </div>
              <div className="lp-proof-text">
                <strong>28 of 30 graded</strong>2 flagged for you to check
              </div>
            </div>
            <DropZone
              onFiles={onFiles}
              onStarted={onStarted}
              onShowTemplates={showTemplates}
              {...(dropZoneState === undefined ? {} : { initialState: dropZoneState })}
            />
          </div>
          <div className="lp-hero-visual">
            <GradedWorksheet />
          </div>
        </section>

        <section className="lp-steps" aria-labelledby="lp-steps-title">
          <div className="lp-section-head">
            <h2 id="lp-steps-title">Hours of grading, done while they work</h2>
          </div>
          <ol className="lp-steps-list">
            {STEPS.map((step, i) => (
              <li key={step.title} className="lp-step">
                <span className="lp-step-number">{i + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <TemplatePicker ref={templatesRef} templates={templates} onPick={onTemplate} />
      </main>

      <footer className="lp-footer">
        <p>
          Made by <a href="https://goblins.com">Goblins</a>, the math tutor that gives every student
          1-on-1 help as they work.
        </p>
      </footer>
    </div>
  );
}
