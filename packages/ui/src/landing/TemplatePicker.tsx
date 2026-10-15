import type { Ref } from "react";
import { Badge } from "../components/Badge";
import type { TemplateSummary } from "./templates";

export interface TemplatePickerProps {
  templates: ReadonlyArray<TemplateSummary>;
  onPick: (templateId: string) => void;
  /** The template whose draft is being created; every card is disabled until it settles. */
  pendingId?: string | undefined;
  ref?: Ref<HTMLElement>;
}

/** "No worksheet handy?" A row of ready-made assignments. */
export function TemplatePicker({ templates, onPick, pendingId, ref }: TemplatePickerProps) {
  return (
    <section ref={ref} className="lp-templates" aria-labelledby="lp-templates-title" tabIndex={-1}>
      <div className="lp-section-head">
        <h2 id="lp-templates-title">No worksheet handy?</h2>
        <p>Start from a real one. You can edit every problem and rubric before you launch.</p>
      </div>
      <ul className="lp-templates-grid">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className="lp-template"
              disabled={pendingId !== undefined}
              aria-busy={pendingId === template.id}
              onClick={() => onPick(template.id)}
            >
              <span className="lp-template-thumb">
                {template.thumbnailUrl !== undefined && (
                  <img src={template.thumbnailUrl} alt="" loading="lazy" width={560} height={725} />
                )}
              </span>
              <span className="lp-template-body">
                <span className="lp-template-meta">
                  {template.course} · {template.problemCount} problems
                </span>
                <span className="lp-template-title">{template.title}</span>
                <span className="lp-template-description">{template.description}</span>
                <span className="lp-template-tags">
                  {template.tags.map((tag) => (
                    <Badge key={tag} appearance="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
                <span className="lp-template-source">
                  {pendingId === template.id ? "Starting…" : template.attribution}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <details className="lp-credits">
        <summary>Template sources and licenses</summary>
        <ul>
          {templates.map((template) => (
            <li key={template.id}>
              <strong>{template.title}.</strong>{" "}
              {template.sourceUrl === undefined ? (
                template.attribution
              ) : (
                <a href={template.sourceUrl}>{template.attribution}</a>
              )}{" "}
              <a href={template.licenseUrl}>License</a>. {template.changes}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
