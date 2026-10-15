import { useState } from "react";
import type { ProblemFigure } from "./model";

/**
 * A problem's diagram, shown by cropping its worksheet page. The page image is scaled so the
 * crop's width fills the box and shifted to the crop's corner; the box takes the crop's shape in
 * page pixels once the image has loaded and its size is known.
 */
export function CroppedFigure({ figure }: { readonly figure: ProblemFigure }) {
  const { x, y, w, h } = figure.crop;
  const [pageAspect, setPageAspect] = useState<number | null>(null);
  return (
    <div
      role="img"
      aria-label={figure.alt}
      className="relative w-full overflow-hidden rounded-md border border-border bg-white"
      style={{ aspectRatio: pageAspect === null ? "4 / 3" : `${w * pageAspect} / ${h}` }}
    >
      <img
        src={figure.src}
        alt=""
        onLoad={(event) =>
          setPageAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
        }
        className="absolute top-0 max-w-none"
        style={{
          width: `${100 / w}%`,
          left: `${(-x / w) * 100}%`,
          // A percentage translate is relative to the image's own height: the page's.
          transform: `translateY(${-y * 100}%)`,
        }}
      />
    </div>
  );
}
