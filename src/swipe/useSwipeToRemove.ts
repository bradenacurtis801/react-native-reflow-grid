import { useMemo, useRef, useState } from 'react';
import { Easing, withSpring, withTiming, type ReduceMotion, type SharedValue } from 'react-native-reanimated';

import { now, perfLog } from '../support/perfLog';
import { SwipeEngine, type SwipeView } from './swipeEngine';

/**
 * Swipe to remove (`onSwipe`): the engine, the cells' swipe offsets, and how many fingers are swiping.
 *
 * Each cell registers its offset in `swipes`, by item; the engine sets it as a finger moves, with no render. While any
 * finger is swiping (`swiping` is more than 0) the scroll view mustn't take it over.
 * Hand it the grid's `view` on every render, as the drag engine's is.
 */
export function useSwipeToRemove<T>(
  view: SwipeView<T>,
  move: { damping: number; stiffness: number; mass: number; reduceMotion: ReduceMotion },
) {
  const swipes = useRef(new Map<string, SharedValue<number>>());
  const [swiping, setSwiping] = useState(0);
  // What the engine's host animates with: the latest, though the host is made once.
  const latest = useRef(move);
  latest.current = move;
  const engine = useMemo(
    () =>
      new SwipeEngine<T>({
        now,
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        hasCell: (key) => swipes.current.has(key),
        setOffset: (key, offset) => swipes.current.get(key)?.set(offset),
        flyOff: (key, to, durationMs) =>
          swipes.current.get(key)?.set(withTiming(to, { duration: durationMs, easing: Easing.out(Easing.quad), reduceMotion: latest.current.reduceMotion })),
        springBack: (key) => swipes.current.get(key)?.set(withSpring(0, latest.current)),
        swipingChanged: (by) => setSwiping((n) => Math.max(0, n + by)),
        log: perfLog,
      }),
    [],
  );
  engine.view = view;
  return { engine, swipes, swiping };
}
