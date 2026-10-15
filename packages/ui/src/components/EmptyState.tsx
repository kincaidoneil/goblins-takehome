import type { ReactNode } from "react";
import { cx } from "../cx";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** An illustration or avatar shown above the title. */
  art?: ReactNode;
  /** One or two buttons. */
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, art, actions, className }: EmptyStateProps) {
  return (
    <div className={cx("gb-empty", className)}>
      {art !== undefined && <div className="gb-empty-art">{art}</div>}
      <h3 className="gb-empty-title">{title}</h3>
      {description !== undefined && <p className="gb-empty-description">{description}</p>}
      {actions !== undefined && <div className="gb-empty-actions">{actions}</div>}
    </div>
  );
}
