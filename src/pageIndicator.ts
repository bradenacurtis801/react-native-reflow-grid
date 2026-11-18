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

/** A finger that moves less than this (pt) along the dots between touching and lifting has tapped. */
export const TAP_SLOP = 10;
/** Dragging along the dots slower than this (pt per ms) is fine control: a page for every dot's width. */
export const SCRUB_SLOW = 0.15;
/** Faster than this (pt per ms) is coarse: a drag across the screen goes through all the pages. */
export const SCRUB_FAST = 1.2;
/** The length (pt) a coarse drag across stands for all the pages, however big the screen. */
export const SCRUB_TRACK = 400;

/**
 * How many pages a drag of one point goes through, at `speed` (pt per ms). Slow, it's
 * a page for every dot's width, so the finger follows the dots. Fast, it grows until a
 * drag of `track` points covers all `count` pages, as dragging a scroll bar does: so
 * a careful drag can stop on any page, and a flick still crosses a long list.
 * (With few pages the two are the same: the dots are all there is.)
 */
export function scrubGain(speed: number, count: number, pitch: number, track: number): number {
  const fine = 1 / pitch;
  const coarse = Math.max(fine, (count - 1) / Math.max(track, 1));
  const t = Math.min(Math.max((speed - SCRUB_SLOW) / (SCRUB_FAST - SCRUB_SLOW), 0), 1);
  return fine + (coarse - fine) * t;
}

/** Where a scrub is (a page, fractional) after the finger moved `delta` points in `dt` ms. */
export function scrubStep(position: number, delta: number, dt: number, count: number, pitch: number, track: number): number {
  const gain = scrubGain(Math.abs(delta) / Math.max(dt, 1), count, pitch, track);
  return Math.min(Math.max(position + delta * gain, 0), Math.max(count - 1, 0));
}

/**
 * The page of the dot touched `along` points from the start of the row (of dots
 * `pitch` apart), the row starting at page `start` (fractional while it slides).
 */
export function tapPage(along: number, start: number, count: number, pitch: number): number {
  return Math.min(Math.max(Math.round(start + along / pitch - 0.5), 0), Math.max(count - 1, 0));
}

const NAMED: Record<string, [number, number, number]> = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0], orange: [255, 165, 0], gray: [128, 128, 128], grey: [128, 128, 128] };

/** The red, green and blue (0 to 255) of a colour written as hex, `rgb()`/`rgba()`, or a basic name; `undefined` for any other. */
export function parseColor(color: string): [number, number, number] | undefined {
  const text = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) return [0, 1, 2].map((i) => parseInt(hex[i]! + hex[i]!, 16)) as [number, number, number];
  if (hex && (hex.length === 6 || hex.length === 8)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return NAMED[text];
}

/**
 * Black or white, whichever can be read on `background`; `undefined` when the
 * colour isn't one it understands (a name it doesn't know, `hsl()`, a platform colour).
 */
export function readableOn(background: string): '#000' | '#fff' | undefined {
  const rgb = parseColor(background);
  if (!rgb) return undefined;
  // The WCAG relative luminance: the light a colour gives, not how bright its numbers look.
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Black text has the better contrast against anything lighter than this.
  return luminance > 0.179 ? '#000' : '#fff';
}
