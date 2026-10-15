import { type ReactNode, useState } from "react";

/** The figure's box on the page, as fractions of the page's width and height from the top left. */
export interface FigureCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProblemFigure {
  /** The worksheet page image the figure is on. */
  src: string;
  /** What the figure shows, e.g. the grader's diagram description. */
  alt: string;
  /** Shows only this part of the page. */
  crop: FigureCrop;
  /** Makes the figure a button, e.g. to open the worksheet zoomed to it. */
  onOpen?: () => void;
}

export interface ProblemPanelProps {
  /** As printed, e.g. "3" or "2b". */
  label: string;
  total: number;
  /** Omitted when the app doesn't show point values to students. */
  points?: number;
  /** The problem text. */
  children: ReactNode;
  /** Shown under the text when the problem has a diagram, so students don't need "See worksheet". */
  figure?: ProblemFigure;
  /** A small control at the right of the header, e.g. the app's "See worksheet" button. */
  action?: ReactNode;
}

/** The problem beside the whiteboard. Text first, then its diagram if it has one. */
export function ProblemPanel({
  label,
  total,
  points,
  children,
  figure,
  action,
}: ProblemPanelProps) {
  return (
    <div className="gb-problem" data-has-figure={figure !== undefined || undefined}>
      <div className="gb-problem-head">
        <h2 className="gb-problem-label">
          Problem {label} of {total}
        </h2>
        {points !== undefined && (
          <span>
            {points} {points === 1 ? "point" : "points"}
          </span>
        )}
        {action}
      </div>
      <div className="gb-problem-text">{children}</div>
      {figure !== undefined && <CroppedFigure figure={figure} />}
    </div>
  );
}

/** US Letter, until the page image loads. */
const LETTER = 8.5 / 11;

/**
 * A problem's figure, cropped from its worksheet page: the box keeps the crop's shape and the page
 * is offset inside it. As wide as its container, up to 260px tall (160px on phones). With `onOpen`
 * it is a button with a Zoom hint.
 */
export function CroppedFigure({ figure }: { figure: ProblemFigure }) {
  const [pageRatio, setPageRatio] = useState(LETTER);
  const { x, y, w, h } = figure.crop;
  const aspect = (w / h) * pageRatio;
  const crop = (zoomHint: boolean) => (
    <span
      className="gb-problem-figure-crop"
      style={{
        aspectRatio: aspect,
        width: `min(100%, var(--gb-figure-max-height) * ${aspect})`,
      }}
    >
      <img
        src={figure.src}
        alt={figure.alt}
        style={{ width: `${100 / w}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalHeight > 0) setPageRatio(img.naturalWidth / img.naturalHeight);
        }}
      />
      {zoomHint && (
        <span className="gb-problem-figure-zoom">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.4 10.4 14 14M5 7h4M7 5v4" />
          </svg>
          Zoom
        </span>
      )}
    </span>
  );
  if (figure.onOpen === undefined) return <div className="gb-problem-figure">{crop(false)}</div>;
  return (
    <button type="button" className="gb-problem-figure" onClick={figure.onOpen}>
      {crop(true)}
    </button>
  );
}
