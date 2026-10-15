import { cx } from "../cx";
import { CreatureArt } from "./creatures";

export interface WordmarkProps {
  /** "goblins" for students (and the projector they watch); "grader" for teachers and their reports. */
  product: "goblins" | "grader";
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Pip and the product name, optically centered on each other. */
export function Wordmark({ product, size = "md", className }: WordmarkProps) {
  return (
    <span className={cx("gb-wordmark", className)} data-size={size}>
      <span className="gb-wordmark-mark" aria-hidden="true">
        <CreatureArt id={0} title="" />
      </span>
      <span className="gb-wordmark-text">
        Goblins
        {product === "grader" && <span className="gb-wordmark-sub"> Grader</span>}
      </span>
    </span>
  );
}
