import { useEffect, type MutableRefObject, type RefObject } from 'react';
import { Platform, View, type ScrollView, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { DragEngine, Offset } from './dragEngine';
import type { ReflowResult, Size } from './layout';
import { PageDots } from './PageDots';
import { DOTS_HIT, pageOf, type PageIndicatorOptions } from './pageIndicator';

/** The page dots sit this far (pt) in from the edge of the grid, where a scroll indicator would. */
const DOTS_INSET = 6;

/** Where a page starts, for the browser's scroll snap to land on. */
function PageMarker({ at, stride, horizontal }: { at: number; stride: number; horizontal: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={
        {
          position: 'absolute',
          left: horizontal ? at : 0,
          top: horizontal ? 0 : at,
          width: horizontal ? stride : 1,
          height: horizontal ? 1 : stride,
          scrollSnapAlign: 'start',
        } as ViewStyle
      }
    />
  );
}

/**
 * A paged layout (`pagedLayout`) snaps to its pages and shows dots for them.
 *
 * Native has `pagingEnabled`. On web it's CSS scroll snap, with a marker at the start of each page: `pagingEnabled`
 * there would replace the style of the content view. The dots stand in for the scroll indicator along the pages, in the
 * same place; tapping one goes to its page, and scrubbing along them goes through the pages.
 */
export function usePaging<T>(p: {
  placed: ReflowResult | undefined;
  pageIndicator: boolean | PageIndicatorOptions;
  /** A page turn during a drag is under way (web animates it itself). */
  turning: boolean;
  axis: 'vertical' | 'horizontal' | 'both';
  offset: MutableRefObject<Offset>;
  scrollRef: RefObject<ScrollView | null>;
  /** Tells the grid the scroll is at an offset (see `useScroll`). */
  track: (to: Offset) => void;
  /** Where the scroll is, in pages, fractional mid-swipe. */
  pageProgress: SharedValue<number>;
  engine: DragEngine<T>;
  crossEnd: number;
  viewport: Size | undefined;
}) {
  const { placed, pageIndicator, turning, axis, offset, scrollRef, track, pageProgress, engine, crossEnd, viewport } = p;
  const pages = placed?.pages;
  const web = Platform.OS === 'web';
  const snapStyle = pages && web && !turning ? ({ scrollSnapType: pages.direction === 'horizontal' ? 'x mandatory' : 'y mandatory' } as ViewStyle) : undefined;
  const markers =
    pages && web
      ? Array.from({ length: pages.count }, (_, page) => (
          <PageMarker key={`page${page}`} at={page * pages.stride} stride={pages.stride} horizontal={pages.direction === 'horizontal'} />
        ))
      : null;

  const dots = pages && pageIndicator !== false ? pages : undefined;
  // A new layout or axis can leave the scroll somewhere no scroll event has reported: say where it is.
  useEffect(() => {
    if (pages && pages.stride > 0) pageProgress.set((pages.direction === 'horizontal' ? offset.current.x : offset.current.y) / pages.stride);
  }, [pages?.direction, pages?.stride, pages?.count, axis]); // eslint-disable-line react-hooks/exhaustive-deps
  const dotOptions = typeof pageIndicator === 'object' ? pageIndicator : {};
  // The dots are drawn on a bigger touch area; the dots themselves stay where a scroll indicator would be.
  const hit = dotOptions.scrub === false ? 0 : DOTS_HIT;
  const dotsStyle: ViewStyle | undefined = dots
    ? dots.direction === 'horizontal'
      ? { position: 'absolute', left: 0, right: 0, bottom: crossEnd + DOTS_INSET - hit, alignItems: 'center' }
      : { position: 'absolute', top: 0, bottom: 0, right: DOTS_INSET - hit, justifyContent: 'center' }
    : undefined;

  /** Scrubbing the dots: to a page, at once. */
  const scrubTo = (page: number) => {
    const pg = placed?.pages;
    if (!pg) return;
    const along = Math.min(Math.max(page, 0), pg.count - 1) * pg.stride;
    const to = pg.direction === 'horizontal' ? { x: along, y: offset.current.y } : { x: offset.current.x, y: along };
    scrollRef.current?.scrollTo({ ...to, animated: false });
    track(to);
    engine.haptic('scrub');
  };
  /** Tapping a dot: to its page, with the scroll's own animation when it's next door, at once when it's further. */
  const jumpTo = (page: number) => {
    const pg = placed?.pages;
    if (!pg) return;
    const horizontal = pg.direction === 'horizontal';
    const target = Math.min(Math.max(page, 0), pg.count - 1);
    const here = pageOf(pg, horizontal ? offset.current.x : offset.current.y);
    if (target === here) return;
    const along = target * pg.stride;
    const to = horizontal ? { x: along, y: offset.current.y } : { x: offset.current.x, y: along };
    const next = Math.abs(target - here) <= 1;
    scrollRef.current?.scrollTo({ ...to, animated: next });
    // An animated scroll reports its own way there; one that is at once is told.
    if (!next) track(to);
    engine.haptic('scrub');
  };

  const dotsElement = dots ? (
    <View pointerEvents="box-none" style={dotsStyle}>
      <PageDots
        count={dots.count}
        current={pageOf(dots, dots.direction === 'horizontal' ? offset.current.x : offset.current.y)}
        progress={pageProgress}
        horizontal={dots.direction === 'horizontal'}
        options={dotOptions}
        track={(dots.direction === 'horizontal' ? viewport?.width : viewport?.height) ?? 0}
        onScrub={scrubTo}
        onJump={jumpTo}
      />
    </View>
  ) : null;

  return { pages, web, snapStyle, markers, dots, dotsElement };
}
