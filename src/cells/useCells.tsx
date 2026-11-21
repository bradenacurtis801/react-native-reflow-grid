import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import type { ReduceMotion, SharedValue } from 'react-native-reanimated';

import { intersects, type Rect, type ReflowLayout, type ReflowResult, type Region } from '../layout';
import type { Leaving } from './leaving';
import { ReflowCell } from './ReflowCell';
import { SlotPool } from './slots';
import type { SwipeEngine } from '../swipe/swipeEngine';
import type { Finger, ItemInfo, ItemRenderInfo, Slot, TouchRegion } from '../types';

interface CellsInput<T> {
  data: readonly T[];
  /** What's shown: `data` in the order of a drag's preview. */
  items: readonly T[];
  layout: ReflowLayout<T>;
  /** The items laid out, once the grid has its size. */
  placed: ReflowResult | undefined;
  roomWidth: number | undefined;
  roomHeight: number | undefined;
  /** The items to have mounted: those on screen, with the buffer, and a lifted one. */
  indices: number[] | undefined;
  /** What's on screen, with the buffer, now. */
  windowNow: () => Region;
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, info: ItemRenderInfo) => ReactNode;
  renderPlaceholder?: (item: T, info: ItemRenderInfo) => ReactNode;
  settleDelay?: number;
  touchRegions?: (item: T, info: ItemInfo) => TouchRegion[];
  draggedKeys: ReadonlySet<string>;
  floating: boolean;
  finger: Finger;
  leaving: Leaving<T>[];
  /** What's leaving in this render, and whether `data` has just changed (see `useLeaving`). */
  leavingNow: Leaving<T>[];
  taking: boolean;
  setLeaving: Dispatch<SetStateAction<Leaving<T>[]>>;
  swipe: { engine: SwipeEngine<T>; swipes: MutableRefObject<Map<string, SharedValue<number>>> };
  swipeAxis: 'x' | 'y';
  reduceMotion: ReduceMotion;
  /** Each mounted cell's element on web, for the image a drag carries. */
  cellNodes: MutableRefObject<Map<string, unknown>>;
  /** Set here to the items on screen, with where they go and their touch regions: what a touch is hit against. */
  slots: MutableRefObject<Slot[]>;
}

/**
 * The cells on screen: the items in the window, the ones leaving, and the ones waiting to be reused.
 *
 * A cell is a slot (`SlotPool`): an item that scrolls out leaves its cell to one that scrolls in, which takes
 * it over where it stands, instead of a cell being unmounted and another mounted. A leaving item carries on in
 * the slot it was in. A leaving item that's off screen has nothing to animate, so it's gone at once.
 */
export function useCells<T>(p: CellsInput<T>) {
  const {
    data, items, layout, placed, roomWidth, roomHeight, indices, windowNow, keyExtractor, renderItem, renderPlaceholder, settleDelay, touchRegions,
    draggedKeys, floating, finger, leaving, leavingNow, taking, setLeaving, swipe, swipeAxis, reduceMotion, cellNodes, slots,
  } = p;

  // Every key the grid has shown before this render: an item not among them is new, and grows in.
  const knownKeys = useRef(new Set<string>());
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  useEffect(() => {
    knownKeys.current = new Set(data.map(keyExtractor));
  }, [data, keyExtractor]);

  // The last known slot of each item on screen, kept for a leaving one too: it
  // leaves from there. An item off screen has none, so it moves with no animation.
  const lastRects = useRef(new Map<string, Rect>());
  // After every render: the slots on screen now, and those of the items still leaving.
  useEffect(() => {
    const next = new Map<string, Rect>();
    if (placed && indices) for (const index of indices) next.set(keyExtractor(items[index]!, index), placed.rectOf(index));
    for (const l of leaving) {
      const rect = lastRects.current.get(l.key);
      if (rect) next.set(l.key, rect);
    }
    lastRects.current = next;
  });

  const gone = useCallback(
    (key: string) => {
      lastRects.current.delete(key);
      swipe.engine.swiped.delete(key);
      setLeaving((all) => all.filter((l) => l.key !== key));
    },
    [swipe.engine, setLeaving],
  );

  // A leaving item that's off screen has nothing to animate: it's gone now.
  useEffect(() => {
    const w = windowNow();
    for (const l of leaving) {
      const rect = lastRects.current.get(l.key);
      if (!rect || !intersects(rect, w)) gone(l.key);
    }
    // Only when a removal changes what's leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const cells: ReactNode[] = [];
  const slotList: Slot[] = [];
  const pool = useRef(new SlotPool());
  // Each slot's cell as last drawn: one waiting to be reused is drawn again as it was, so React leaves it be.
  const drawn = useRef(new Map<number, ReactNode>());
  // What the places of the waiting cells depend on: when it changes, they're stale.
  const shape = useRef({ layout, data, roomWidth, roomHeight });
  // The keys still in `data`: an item that's gone has no cell waiting for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveKeys = useMemo(() => new Set(data.map(keyExtractor)), [data]);
  // How many of the cells are an item shrinking away: they're mounted, but not counted as settled (`onMounted`).
  let leavingCount = 0;
  if (placed) {
    const w = windowNow();
    const wanted = (indices ?? []).map((index) => keyExtractor(items[index]!, index));
    // A leaving item is drawn while it's on screen.
    const leavingShown = leavingNow.filter((l) => {
      const rect = lastRects.current.get(l.key);
      return !!rect && intersects(rect, w);
    });
    leavingCount = leavingShown.length;
    const was = shape.current;
    const changed = was.layout !== layout || was.data !== data || was.roomWidth !== roomWidth || was.roomHeight !== roomHeight;
    shape.current = { layout, data, roomWidth, roomHeight };
    // While `data` is being taken in (the render that follows is the one drawn), nothing is let go of: a removed item's cell is about to be a leaving one.
    const { slots: slotOfWanted, stale: waiting } = pool.current.assign(
      wanted,
      new Set(leavingShown.map((l) => l.key)),
      taking ? () => true : (key) => liveKeys.has(key),
      changed,
    );
    const inUse = new Set<number>();
    (indices ?? []).forEach((index, n) => {
      const item = items[index]!;
      const key = wanted[n]!;
      const rect = placed.rectOf(index);
      const info: ItemInfo = { index, size: { width: rect.width, height: rect.height }, dragging: draggedKeys.has(key) };
      slotList.push({ key, index, rect, regions: touchRegions?.(item, info) ?? [] });
      const slot = slotOfWanted[n]!;
      const cell = (
        <ReflowCell
          key={`slot:${slot}`}
          id={key}
          item={item}
          index={index}
          renderItem={renderItem}
          renderPlaceholder={renderPlaceholder}
          settleDelay={settleDelay}
          rect={rect}
          start={lastRects.current.get(key)}
          appear={settled.current && !knownKeys.current.has(key)}
          dragging={info.dragging}
          floating={floating}
          finger={finger}
          cellNodes={cellNodes}
          swipes={swipe.swipes}
          swipeAxis={swipeAxis}
          onGone={gone}
          reduceMotion={reduceMotion}
        />
      );
      drawn.current.set(slot, cell);
      inUse.add(slot);
      cells.push(cell);
    });
    for (const l of leavingShown) {
      const rect = lastRects.current.get(l.key)!;
      const slot = pool.current.slotFor(l.key);
      const cell = (
        <ReflowCell
          key={slot === undefined ? `leave:${l.key}` : `slot:${slot}`}
          id={l.key}
          item={l.item}
          index={-1}
          renderItem={renderItem}
          renderPlaceholder={renderPlaceholder}
          settleDelay={settleDelay}
          leaving
          start={rect}
          exit={swipe.engine.swiped.get(l.key)}
          onGone={gone}
          cellNodes={cellNodes}
          swipes={swipe.swipes}
          swipeAxis={swipeAxis}
          reduceMotion={reduceMotion}
        />
      );
      if (slot !== undefined) {
        drawn.current.set(slot, cell);
        inUse.add(slot);
      }
      cells.push(cell);
    }
    // Cells waiting to be reused stay mounted, drawn as they were.
    for (const { slot } of waiting) {
      const cell = drawn.current.get(slot);
      if (cell) {
        cells.push(cell);
        inUse.add(slot);
      }
    }
    for (const slot of [...drawn.current.keys()]) if (!inUse.has(slot)) drawn.current.delete(slot);
  }
  slots.current = slotList;
  return { cells, leavingCount };
}
