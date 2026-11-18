/** How the dots that show which page is on screen look and move. All of it is optional. */
export interface PageIndicatorOptions {
  /** A dot for a page that isn't on screen. @default a light grey on a dark screen, a dark one on a light screen */
  color?: string;
  /** The dot for the page that is. @default white on a dark screen, black on a light one */
  activeColor?: string;
  /** The page on screen's dot's diameter; the others are smaller. @default 8 */
  size?: number;
  /** Between dots. @default 8 */
  spacing?: number;
  /**
   * The most dots shown at once. With more pages the row slides along with the
   * swipe when the page on screen reaches its end, the dots at its ends shrinking
   * to say there are more. @default 7
   */
  maxDots?: number;
  /**
   * Drag along the dots to scrub through the pages, as one drags a scroll bar:
   * a short drag across the row goes through them all, and a label says which
   * page you're on. @default true
   */
  scrub?: boolean;
}

/** The touch area of the dots reaches this far (pt) beyond them, so a fingertip can find them. */
export const DOTS_HIT = 14;

/** A dot of a page that isn't on screen is this fraction of the size of the one that is. */
export const INACTIVE_SCALE = 0.7;

/**
 * How much of its size a dot has, `d` dots in from the end of the row where there
 * are more pages beyond: the end one is small, and they grow to full size by the
 * third. (Continuous, so a row that is sliding changes smoothly.)
 */
export function edgeScale(d: number): number {
  'worklet';
  return d <= 0 ? 0.55 : d <= 1 ? 0.55 + 0.25 * d : d <= 2 ? 0.8 + 0.2 * (d - 1) : 1;
}

/** How many dots in from the end of the row the page on screen can get before the row slides. */
export function edgeMargin(shown: number): number {
  'worklet';
  return Math.min(2, Math.floor((shown - 1) / 2));
}

/**
 * Where the row starts (a page number, fractional while it slides) with the
 * scroll at page position `p`. The row stays where it is while the page on
 * screen is inside it, short of `margin` from its ends; at the end of it the
 * row is carried along.
 */
export function slideStart(start: number, p: number, shown: number, count: number, margin: number): number {
  'worklet';
  const lo = p - (shown - 1 - margin);
  const hi = p - margin;
  return Math.min(Math.max(Math.min(Math.max(start, lo), hi), 0), Math.max(count - shown, 0));
}

export interface DotLook {
  /** Its place in the row, in dots from the start of it (fractional while sliding). */
  x: number;
  /** Its size, as a fraction of full: smaller at an end of the row that has more pages beyond. */
  scale: number;
  /** Fades as it slides out of either end of the row. */
  alpha: number;
  /** 0 to 1: how much of the way the scroll is to this dot's page, from a page away to on it. */
  lit: number;
}

/**
 * What the dot for page `k` looks like with the scroll at page position `p`
 * (fractional, mid-swipe) and the row starting at `start`, of `shown` dots out
 * of `count`. Everything is continuous in `p` and `start`.
 */
export function dotLook(k: number, p: number, start: number, shown: number, count: number): DotLook {
  'worklet';
  const x = k - start;
  const before = Math.min(Math.max(start, 0), 1);
  const after = Math.min(Math.max(count - shown - start, 0), 1);
  const scale = Math.min(1 - before * (1 - edgeScale(x)), 1 - after * (1 - edgeScale(shown - 1 - x)));
  return {
    x,
    scale,
    alpha: Math.min(Math.max(1 + Math.min(x, shown - 1 - x), 0), 1),
    lit: Math.min(Math.max(1 - Math.abs(p - k), 0), 1),
  };
}

/**
 * How many pages a drag of one point along the dots goes through. The row's
 * length stands for all the pages, as a scroll bar's track does, so a short drag
 * covers a long way; with few pages, a drag of one dot's width is one page.
 */
export function pagesPerPoint(count: number, shown: number, pitch: number): number {
  return Math.max((count - 1) / (Math.max(shown - 1, 1) * pitch), 1 / pitch);
}

/** The page a drag of `distance` points along the dots (towards the later pages when positive) reaches from the page it began on. */
export function scrubPage(start: number, distance: number, count: number, shown: number, pitch: number): number {
  return Math.min(Math.max(Math.round(start + distance * pagesPerPoint(count, shown, pitch)), 0), Math.max(count - 1, 0));
}
