import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReflowLayout } from 'react-native-reflow-grid';
import type { Hues } from './Backdrop';
import { SIDE, useMetrics } from './metrics';
import type { Tab } from './tabs';

/** How long (ms) the cards in the middle of the screen must stay the same before the backdrop takes their colours. */
const SETTLE = 250;

/**
 * The hues of the cards at the two sides of the middle of the screen, for the backdrop. The grid says how far it has scrolled
 * (`onScroll`, to give it); running the same layout on the same tabs says which cards are there then.
 */
export function useHues(layout: ReflowLayout<Tab>, shown: readonly Tab[]) {
  const { width, height, cardW, gridTop } = useMetrics();
  const [hues, setHues] = useState<Hues | null>(null);
  const scrolled = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const placed = useMemo(() => layout(shown, { width: width - SIDE * 2, height }), [layout, shown, width, height]);

  const look = useCallback(
    (y: number) => {
      const middle = y + height / 2 - gridTop;
      // The row's first and last cards (the middle of the screen can fall in a gap between two columns).
      const [first] = placed.indicesIn({ x0: cardW / 2, x1: cardW / 2 + 1, y0: middle, y1: middle + 1 });
      const lastX = width - SIDE * 2 - cardW / 2;
      const [last] = placed.indicesIn({ x0: lastX, x1: lastX + 1, y0: middle, y1: middle + 1 });
      // Between two rows, the hues stay as they were.
      if (first === undefined) return;
      const left = shown[first]!.hue;
      // A last row with one card has no neighbour: its other pool is across the colour wheel.
      const right = last !== undefined ? shown[last]!.hue : (left + 180) % 360;
      // They wait for the scroll to slow: colours that follow every card as it passes would only flicker.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHues((was) => (was && was[0] === left && was[1] === right ? was : [left, right])), SETTLE);
    },
    [placed, shown, width, cardW, height, gridTop],
  );
  const onScroll = useCallback(
    ({ y }: { y: number }) => {
      scrolled.current = y;
      look(y);
    },
    [look],
  );
  // Without a scroll (at the start, or when the tabs change under it), from where it was left.
  useEffect(() => {
    look(scrolled.current);
    return () => clearTimeout(timer.current);
  }, [look]);

  return { hues, onScroll };
}
