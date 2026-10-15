import type { Ref } from "react";
import type { TemplateSummary } from "./templates";

export interface TemplatePickerProps {
  templates: ReadonlyArray<TemplateSummary>;
  onPick: (templateId: string) => void;
  ref?: Ref<HTMLElement>;
}

/** "No worksheet handy?" A row of ready-made assignments. */
export function TemplatePicker({ templates, onPick, ref }: TemplatePickerProps) {
  return (
    <section ref={ref} className="lp-templates" aria-labelledby="lp-templates-title" tabIndex={-1}>
      <div className="lp-section-head">
        <h2 id="lp-templates-title">No worksheet handy?</h2>
        <p>Start from a real one. You can edit every problem and rubric before you launch.</p>
      </div>
      <ul className="lp-templates-grid">
        {templates.map((template) => (
          <li key={template.id}>
            <button type="button" className="lp-template" onClick={() => onPick(template.id)}>
              <span className="lp-template-thumb" data-topic={template.topic}>
                <TopicArt topic={template.topic} />
              </span>
              <span className="lp-template-body">
                <span className="lp-template-meta">
                  {template.grade} · {template.problemCount} problems
                </span>
                <span className="lp-template-title">{template.title}</span>
                <span className="lp-template-source">{template.source}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A worksheet page with one drawing that hints at the topic. */
function TopicArt({ topic }: { topic: TemplateSummary["topic"] }) {
  const ink = "var(--gb-green-700)";
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true">
      <rect x="28" y="10" width="104" height="100" rx="6" fill="#fff" />
      <path
        d="M40 24h50M40 34h36"
        stroke={ink}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
      {topic === "circles" && (
        <>
          <circle cx="80" cy="70" r="24" fill="none" stroke={ink} strokeWidth="3" />
          <path d="M80 70h24" stroke={ink} strokeWidth="3" strokeLinecap="round" />
          <circle cx="80" cy="70" r="3" fill={ink} />
        </>
      )}
      {topic === "equations" && (
        <text
          x="80"
          y="78"
          textAnchor="middle"
          fontSize="22"
          fontWeight="800"
          fill={ink}
          fontFamily="var(--gb-font-sans)"
        >
          3x + 5 = 20
        </text>
      )}
      {topic === "triangles" && (
        <>
          <path
            d="M52 92 L108 92 L52 50 Z"
            fill="none"
            stroke={ink}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M52 84h8v8" fill="none" stroke={ink} strokeWidth="2" />
        </>
      )}
      {topic === "fractions" && (
        <text
          x="80"
          y="80"
          textAnchor="middle"
          fontSize="24"
          fontWeight="800"
          fill={ink}
          fontFamily="var(--gb-font-sans)"
        >
          ⅔ + ¼
        </text>
      )}
    </svg>
  );
}
