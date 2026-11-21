import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import type { Offset } from './dragEngine';
import type { ReflowResult, Region, Size } from './layout';
import { pageOf } from './pageIndicator';
import { perfLog, perfOn } from './perfLog';

/**
 * Cells within this many screens (of the grid's own width and height) beyond the
 * screen are kept mounted, so a scroll doesn't mount them at the edge: content
 * has this long to load before it's seen, at any screen size.
 */
const BUFFER_SCREENS = 1;
/** The least buffer (pt), for a small grid, and for before the grid's size is known. */
const MIN_BUFFER = 300;

function sameIndices(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Where the grid is scrolled to, and what that puts on screen.
 *
 * The offset is a ref, so a scroll doesn't render; a render comes only when the items on screen change.
 * The scroll views report their offsets on the UI thread (`onScrollUI`, `onScrollInnerUI`), which keeps its own copy
 * (`scrollX`, `scrollY`) for placing a lifted item as it's drawn, and hands them to the JS thread (`track`).
 */
export function useScroll(p: {
  axis: 'vertical' | 'horizontal' | 'both';
  ios: boolean;
  android: boolean;
  /** Android and web pad the scroll view by the insets; iOS insets it. */
  padded: boolean;
  insetX: { start: number; end: number };
  insetY: { start: number; end: number };
  crossStart: number;
  viewport: Size | undefined;
  placed: ReflowResult | undefined;
  /** The index of the item a finger has lifted, or -1: it's drawn wherever the finger is. */
  lifted: number;
  /** A drag is on (for the log). */
  dragging: boolean;
}) {
  const { axis, ios, android, padded, insetX, insetY, crossStart, viewport, placed, lifted, dragging } = p;
  const mainHorizontal = axis === 'horizontal';

  // iOS rests at minus the start inset (the header's space, drawn over). Android pads instead, and rests at 0.
  const offset = useRef<Offset>({ x: ios ? -insetX.start : 0, y: ios ? -insetY.start : 0 });
  // A change of axis is a new scroll view (`key` in the grid), resting at its own start: the old axis's offset would misplace every touch and window.
  const axisShown = useRef(axis);
  if (axisShown.current !== axis) {
    axisShown.current = axis;
    offset.current = { x: ios ? -insetX.start : 0, y: ios ? -insetY.start : 0 };
  }
  // The content's own origin, in the scroll's terms: Android's padding moves it in by the start inset.
  const contentOf = (o: Offset): Offset => ({ x: o.x - (padded ? insetX.start : 0), y: o.y - (padded ? insetY.start : 0) });
  // What's on screen, with the buffer, in the content's coordinates.
  const windowOf = (o: Offset): Region => {
    const c = contentOf(o);
    const v = viewport ?? { width: 0, height: 0 };
    const bx = Math.max(MIN_BUFFER, v.width * BUFFER_SCREENS);
    const by = Math.max(MIN_BUFFER, v.height * BUFFER_SCREENS);
    return { x0: c.x - bx, x1: c.x + v.width + bx, y0: c.y - by, y1: c.y + v.height + by };
  };
  const shown = useRef<number[] | undefined>(undefined);
  const [, showMore] = useState(0);
  const indicesAt = (o: Offset): number[] | undefined => (placed ? placed.indicesIn(windowOf(o)) : undefined);
  // The page on screen, for the dots. What's drawn is worked out from the scroll offset on each render, so it
  // can't disagree with where the grid is (an offset reset by a change of axis, say); this just brings the render.
  const [, setPage] = useState(0);
  // Where the scroll is, in pages, fractional mid-swipe: the dots follow it on the UI thread.
  const pageProgress = useSharedValue(0);
  /** The scroll is at `next`: bring a render if what's on screen has changed. */
  const track = (next: Offset) => {
    offset.current = next;
    const pg = placed?.pages;
    if (pg) {
      const along = pg.direction === 'horizontal' ? next.x : next.y;
      pageProgress.set(pg.stride > 0 ? along / pg.stride : 0);
      setPage(pageOf(pg, along));
    }
    if (!sameIndices(indicesAt(next), shown.current)) showMore((n) => n + 1);
  };
  const shownNow = indicesAt(offset.current);
  shown.current = shownNow;
  // The lifted item follows the finger, so it's drawn even when its slot has scrolled away.
  const indices = shownNow && lifted >= 0 && !shownNow.includes(lifted) ? [...shownNow, lifted].sort((a, b) => a - b) : shownNow;

  // The scroll offset as the UI thread has it, and the insets that turn a finger's place into the content's.
  const scrollX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  const innerOwnsX = useSharedValue(false);

  // Two axes. On iOS one scroll view holds both: its content is wider and taller than its frame, so one drag moves it diagonally.
  // Android has no two-axis scroll view, so there a horizontal one nests inside the vertical (a drag then belongs to one axis).
  const both = axis === 'both';
  const nested = both && android;
  // What the scroll views report, from the UI thread: by what the grid scrolls on. A sideways grid never scrolls across, so its y stays 0
  // (the header's space is its frame's padding, not an offset).
  const scrolled = (x: number, y: number) => {
    if (mainHorizontal) {
      track({ x, y: 0 });
    } else if (nested || !both) {
      // While dragging, the offset the finger was placed with (what the drag loop asked for) against the one the scroll view reports.
      if (perfOn() && dragging) {
        const diff = y - offset.current.y;
        if (Math.abs(diff) > 1) perfLog(`scroll offset: reported=${y.toFixed(1)} used=${offset.current.y.toFixed(1)} diff=${diff.toFixed(1)}`);
      }
      track({ x: offset.current.x, y });
    } else {
      track({ x, y });
    }
  };
  const scrolledInner = (x: number) => track({ x, y: mainHorizontal ? 0 : offset.current.y });
  // The handlers below outlive a render: they call the latest of these.
  const scrolledRef = useRef(scrolled);
  scrolledRef.current = scrolled;
  const scrolledInnerRef = useRef(scrolledInner);
  scrolledInnerRef.current = scrolledInner;
  const reportScroll = useCallback((x: number, y: number) => scrolledRef.current(x, y), []);
  const reportInner = useCallback((x: number) => scrolledInnerRef.current(x), []);
  const onScrollUI = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
    // Nested, the horizontal scroll view inside owns the horizontal offset.
    if (!innerOwnsX.get()) scrollX.set(e.contentOffset.x);
    runOnJS(reportScroll)(e.contentOffset.x, e.contentOffset.y);
  });
  const onScrollInnerUI = useAnimatedScrollHandler((e) => {
    scrollX.set(e.contentOffset.x);
    runOnJS(reportInner)(e.contentOffset.x);
  });
  useEffect(() => {
    shiftX.set(-(padded ? insetX.start : 0));
    shiftY.set(-(padded ? insetY.start : 0) - crossStart);
    innerOwnsX.set(nested);
  }, [padded, insetX.start, insetY.start, crossStart, nested, shiftX, shiftY, innerOwnsX]);

  return { offset, contentOf, windowOf, indices, track, pageProgress, scrollX, scrollY, shiftX, shiftY, onScrollUI, onScrollInnerUI, both, nested };
}
