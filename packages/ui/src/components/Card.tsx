import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `raised` is white with a shadow; `sunken` sits into the page; `tint` is pale green. */
  tone?: "raised" | "sunken" | "tint";
  padding?: "sm" | "md" | "lg";
}

export function Card({ tone = "raised", padding = "md", className, ...props }: CardProps) {
  return (
    <div {...props} className={cx("gb-card", className)} data-tone={tone} data-padding={padding} />
  );
}
