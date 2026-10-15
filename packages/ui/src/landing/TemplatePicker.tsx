import type { Ref } from "react";
import { Badge } from "../components/Badge";
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
                <span className="lp-template-source">{template.source}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
