import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type BadgeTone = "neutral" | "brand" | "accent" | "success" | "warning" | "info" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** `outline` matches the small standards tags on goblins.com. */
  appearance?: "soft" | "outline";
}

export function Badge({ tone = "neutral", appearance = "soft", className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cx("gb-badge", className)}
      data-tone={tone}
      data-appearance={appearance}
    />
  );
}
