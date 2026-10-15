import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../cx";
import { Button } from "./Button";

export interface WorksheetPage {
  pageNumber: number;
  /** Absolute, app-relative or `data:` URL of the full-resolution page image. */
  imageUrl: string;
}

export interface WorksheetViewerProps {
  pages: ReadonlyArray<WorksheetPage>;
  /**
   * The page to show. Changing it jumps there (e.g. a problem card's "Page 2" button); the
   * viewer's own page buttons still work in between.
   */
  page?: number;
  onPageChange?: (pageNumber: number) => void;
  /** Pages to mark in the page buttons, e.g. the active problem's pages. */
  highlightPages?: ReadonlyArray<number>;
  /** Fills its parent's height; give the parent one. */
  className?: string;
}

/** 1 is fit-width. */
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const STEP = 1.5;
/** US Letter, until the image loads. */
const DEFAULT_RATIO = 11 / 8.5;

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };
const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const relativeTo = (el: HTMLElement | null, e: { clientX: number; clientY: number }): Point => {
  const rect = el?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
};

/**
 * A worksheet page at full resolution with zoom and pan: pinch and two-finger pan on touch,
 * Ctrl/Cmd+scroll and drag on desktop, double-tap or double-click to zoom in, and +, − and
 * "Fit width" buttons. Opens at fit-width.
 */
export function WorksheetViewer({
  pages,
  page,
  onPageChange,
  highlightPages = [],
  className,
}: WorksheetViewerProps) {
  const [current, setCurrent] = useState(() => page ?? pages[0]?.pageNumber ?? 1);
  useEffect(() => {
    if (page !== undefined) setCurrent(page);
  }, [page]);
  const shown = pages.find((p) => p.pageNumber === current) ?? pages[0];

  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [view, setView] = useState<View>(FIT);
  // Gesture handlers read the latest view and size without re-binding.
  const latest = useRef({ view, size, ratio });
  latest.current = { view, size, ratio };

  useEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      setView(FIT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Each page opens at fit-width.
  const shownUrl = shown?.imageUrl;
  useEffect(() => {
    if (shownUrl !== undefined) setView(FIT);
  }, [shownUrl]);

  /** Keeps the page covering the viewport: no panning past its edges. */
  const clamp = useCallback((next: View): View => {
    const { size: s, ratio: r } = latest.current;
    const scale = clampNum(next.scale, MIN_SCALE, MAX_SCALE);
    const width = s.width * scale;
    const height = width * r;
    return {
      scale,
      x: clampNum(next.x, Math.min(0, s.width - width), 0),
      y: clampNum(next.y, Math.min(0, s.height - height), 0),
    };
  }, []);

  const apply = useCallback(
    (next: View) => {
      const clamped = clamp(next);
      latest.current.view = clamped;
      setView(clamped);
    },
    [clamp],
  );

  /** Zooms to `scale`, keeping the page point under `at` (viewport coordinates) still. */
  const zoomTo = useCallback(
    (scale: number, at: Point, from: View = latest.current.view) => {
      const next = clampNum(scale, MIN_SCALE, MAX_SCALE);
      const k = next / from.scale;
      apply({ scale: next, x: at.x - (at.x - from.x) * k, y: at.y - (at.y - from.y) * k });
    },
    [apply],
  );

  const center = (): Point => ({
    x: latest.current.size.width / 2,
    y: latest.current.size.height / 2,
  });
  const local = (e: { clientX: number; clientY: number }) => relativeTo(viewport.current, e);

  /** Double-tap or double-click: zoom in on the point, or back to fit-width if zoomed in. */
  const toggleAt = (at: Point) => {
    if (latest.current.view.scale < 2) zoomTo(2.5, at);
    else apply(FIT);
  };

  // Ctrl/Cmd+scroll (and trackpad pinch, which browsers report as Ctrl+wheel) zooms; plain scroll
  // pans. Bound natively because React's wheel listener is passive and can't stop page scroll.
  useEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      const { view: v, size: s, ratio: r } = latest.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(v.scale * Math.exp(-e.deltaY * 0.005), relativeTo(el, e));
        return;
      }
      const overflows = s.width * v.scale > s.width + 1 || s.width * v.scale * r > s.height + 1;
      if (!overflows) return;
      e.preventDefault();
      apply({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, zoomTo]);

  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; mid: Point; view: View } | null>(null);
  const tap = useRef<{ start: Point; moved: boolean }>({ start: { x: 0, y: 0 }, moved: false });
  const lastTap = useRef<{ at: Point; time: number } | null>(null);

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (a === undefined || b === undefined) return;
    pinch.current = { distance: distance(a, b), mid: midpoint(a, b), view: latest.current.view };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    if (pointers.current.size === 1) tap.current = { start: at, moved: false };
    if (pointers.current.size === 2) startPinch();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (before === undefined) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    if (distance(at, tap.current.start) > 8) tap.current.moved = true;
    const start = pinch.current;
    if (pointers.current.size >= 2 && start !== null) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      // Zoom about where the pinch started, then follow the fingers' midpoint.
      const scale = clampNum(
        (start.view.scale * distance(a, b)) / start.distance,
        MIN_SCALE,
        MAX_SCALE,
      );
      const k = scale / start.view.scale;
      const mid = midpoint(a, b);
      apply({
        scale,
        x: mid.x - (start.mid.x - start.view.x) * k,
        y: mid.y - (start.mid.y - start.view.y) * k,
      });
      return;
    }
    const v = latest.current.view;
    apply({ ...v, x: v.x + at.x - before.x, y: v.y + at.y - before.y });
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 2) startPinch();
    else pinch.current = null;
    // Double-tap on touch; mouse uses onDoubleClick.
    if (e.pointerType !== "touch" || pointers.current.size > 0 || tap.current.moved) return;
    const at = local(e);
    const previous = lastTap.current;
    if (previous !== null && e.timeStamp - previous.time < 300 && distance(at, previous.at) < 40) {
      lastTap.current = null;
      toggleAt(at);
    } else {
      lastTap.current = { at, time: e.timeStamp };
    }
  };

  const go = (pageNumber: number) => {
    setCurrent(pageNumber);
    onPageChange?.(pageNumber);
  };

  if (shown === undefined) return null;
  const percent = Math.round(view.scale * 100);

  return (
    <div className={cx("gb-wsv", className)}>
      {pages.length > 1 && (
        <fieldset className="gb-wsv-pages" aria-label="Pages">
          {pages.map((p) => (
            <button
              key={p.pageNumber}
              type="button"
              className="gb-wsv-page"
              aria-label={`Page ${p.pageNumber}`}
              aria-current={p.pageNumber === shown.pageNumber ? "page" : undefined}
              data-highlighted={highlightPages.includes(p.pageNumber) || undefined}
              onClick={() => go(p.pageNumber)}
            >
              {p.pageNumber}
            </button>
          ))}
        </fieldset>
      )}
      <div className="gb-wsv-stage">
        <div
          ref={viewport}
          className="gb-wsv-view"
          role="img"
          aria-label={`Worksheet page ${shown.pageNumber}`}
          data-scale={view.scale.toFixed(2)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={(e) => toggleAt(local(e))}
        >
          {/* Sized by width, not a CSS scale, so the browser draws the full-resolution image sharp. */}
          <img
            src={shown.imageUrl}
            alt=""
            draggable={false}
            className="gb-wsv-img"
            style={{
              width: size.width * view.scale || "100%",
              transform: `translate(${view.x}px, ${view.y}px)`,
            }}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0) setRatio(img.naturalHeight / img.naturalWidth);
            }}
          />
        </div>
        <fieldset className="gb-wsv-zoom" aria-label="Zoom">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom out"
            disabled={view.scale <= MIN_SCALE}
            onClick={() => zoomTo(view.scale / STEP, center())}
          >
            −
          </Button>
          <output className="gb-wsv-percent" aria-live="polite" aria-label="Zoom level">
            {percent}%
          </output>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom in"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => zoomTo(view.scale * STEP, center())}
          >
            +
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={view.scale === 1 && view.x === 0 && view.y === 0}
            onClick={() => apply(FIT)}
          >
            Fit width
          </Button>
        </fieldset>
      </div>
    </div>
  );
}
