import { memo, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type ReduceMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import type { Rect, Size } from '../layout';
import { DRAGGED_OPACITY, ENTER_SCALE, LEAVE_MS, LEAVE_SCALE, LIFT_SCALE, MOVE } from './motion';
import { placeAtOnce } from './placeBatch';
import { perfLog } from '../support/perfLog';
import { SWIPE_EXIT_MS, type SwipeDirection } from '../swipe/swipe';
import type { Finger, ItemRenderInfo } from '../types';

export interface CellProps<T> {
  id: string;
  item: T;
  /** Its place in what's shown; -1 once it's leaving. */
  index: number;
  renderItem: (item: T, info: ItemRenderInfo) => ReactNode;
  /** Where it goes — absent once it's leaving: it stays where it is. */
  rect?: Rect;
  /** Where it starts from when it's mounted: its last slot, so a move that was under way carries on. */
  start?: Rect;
  leaving?: boolean;
  /** Added after the rest were shown: grows in. */
  appear?: boolean;
  /** Being dragged: dims, to mark the slot it will land in, or, `floating`, is lifted and follows the finger. */
  dragging?: boolean;
  floating?: boolean;
  finger?: Finger;
  /** Where the cell registers its element (web), for the image a drag carries. */
  cellNodes: { current: Map<string, unknown> };
  /** Where the cell registers how far it's swiped, by item: the grid sets it as a finger swipes the item away. */
  swipes: { current: Map<string, SharedValue<number>> };
  /** The axis a swipe moves it along. */
  swipeAxis: 'x' | 'y';
  /** Leaving because it was swiped away, the way it went: it carries on that way and fades, and doesn't shrink. */
  exit?: SwipeDirection;
  onGone: (id: string) => void;
  reduceMotion: ReduceMotion;
}

/** The spring that moves a cell, with whether it follows the device's reduce-motion setting. */
type Move = typeof MOVE & { reduceMotion: ReduceMotion };

/** The animated values that place and dress one cell. All of them are read on the UI thread. */
export interface CellValues {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  scale: SharedValue<number>;
  opacity: SharedValue<number>;
  /** Dims the slot of an item being dragged. */
  dim: SharedValue<number>;
  /** 1 while a finger has lifted it and it follows the finger. */
  lifted: SharedValue<number>;
  /** How far a swipe has taken it from its slot, along the swipe's axis. */
  swipe: SharedValue<number>;
}

function useCellValues(from: Rect | undefined, appear: boolean): CellValues {
  const x = useSharedValue(from?.x ?? 0);
  const y = useSharedValue(from?.y ?? 0);
  const w = useSharedValue(from?.width ?? 0);
  const h = useSharedValue(from?.height ?? 0);
  const scale = useSharedValue(appear ? ENTER_SCALE : 1);
  const opacity = useSharedValue(appear ? 0 : 1);
  const dim = useSharedValue(1);
  const lifted = useSharedValue(0);
  const swipe = useSharedValue(0);
  return { x, y, w, h, scale, opacity, dim, lifted, swipe };
}

/** The finger's values, under the names a lifted item reads them by. A cell given no finger follows none. */
interface FingerValues {
  fx: SharedValue<number>;
  fy: SharedValue<number>;
  gx: SharedValue<number>;
  gy: SharedValue<number>;
  sx: SharedValue<number>;
  sy: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
}

function useFingerValues(finger: Finger | undefined): FingerValues {
  const none = useSharedValue(0);
  return {
    fx: finger?.x ?? none,
    fy: finger?.y ?? none,
    gx: finger?.gx ?? none,
    gy: finger?.gy ?? none,
    sx: finger?.sx ?? none,
    sy: finger?.sy ?? none,
    ox: finger?.ox ?? none,
    oy: finger?.oy ?? none,
  };
}

/** The grid sets how far a swipe has taken the item through the registry: by item, so a cell reused for another item is found under the new one. */
function useSwipeRegistration(id: string, swipe: SharedValue<number>, swipes: CellProps<unknown>['swipes']) {
  useEffect(() => {
    swipes.current.set(id, swipe);
    return () => {
      if (swipes.current.get(id) === swipe) swipes.current.delete(id);
    };
  }, [id, swipe, swipes]);
}

/**
 * Where the cell goes. A new place is glided to, from where the cell is. A cell reused for another item
 * (`SlotPool`) is at its place at once, not gliding there from the other item's. A lifted cell follows
 * the finger at its own size, and isn't moved: the slots it passes over aren't where it's going until it's dropped.
 */
function usePlacement(p: {
  id: string;
  rect: Rect | undefined;
  from: Rect | undefined;
  leaving: boolean;
  appear: boolean;
  dragging: boolean;
  floating: boolean;
  v: CellValues;
  wasLifted: MutableRefObject<boolean>;
  move: Move;
}) {
  const { id, rect, from, leaving, appear, dragging, floating, v, wasLifted, move } = p;
  // The first placement isn't a move.
  const placed = useRef(false);
  // The item this cell shows: it changes when the cell is reused for another.
  const shownId = useRef(id);
  useEffect(() => {
    if (leaving || !rect) return;
    if (dragging && floating) {
      perfLog(`lifted ${id}: slot is now ${rect.width.toFixed(0)}×${rect.height.toFixed(0)} at (${rect.x.toFixed(0)}, ${rect.y.toFixed(0)})`);
      return;
    }
    if (shownId.current !== id) {
      shownId.current = id;
      placed.current = true;
      wasLifted.current = false;
      const dim = dragging && !floating ? DRAGGED_OPACITY : 1;
      if (appear) {
        v.swipe.set(0);
        v.x.set(rect.x);
        v.y.set(rect.y);
        v.w.set(rect.width);
        v.h.set(rect.height);
        v.lifted.set(0);
        v.dim.set(dim);
        v.scale.set(ENTER_SCALE);
        v.opacity.set(0);
        v.scale.set(withSpring(1, move));
        v.opacity.set(withTiming(1, { duration: LEAVE_MS, reduceMotion: move.reduceMotion }));
      } else {
        placeAtOnce({ v, x: rect.x, y: rect.y, w: rect.width, h: rect.height, dim });
      }
      return;
    }
    const first = !placed.current;
    placed.current = true;
    // Mounted where it already belongs: nothing to animate.
    if (first && from && from.x === rect.x && from.y === rect.y && from.width === rect.width && from.height === rect.height) return;
    v.x.set(withSpring(rect.x, move));
    v.y.set(withSpring(rect.y, move));
    v.w.set(withSpring(rect.width, move));
    v.h.set(withSpring(rect.height, move));
  }, [id, leaving, rect?.x, rect?.y, rect?.width, rect?.height]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A leaving cell fades, and shrinks, or, swiped away, carries on off the edge and fades at the end; a returning one grows back. `onGone` once it's out of sight. */
function useLeaving(p: { id: string; leaving: boolean; exit: SwipeDirection | undefined; v: CellValues; move: Move; onGone: (id: string) => void }) {
  const { id, leaving, exit, v, move, onGone } = p;
  const { reduceMotion } = move;
  useEffect(() => {
    if (leaving) {
      if (exit) {
        // Swiped away, it's flying off the edge: it doesn't shrink, and it fades only at the end, when it's gone from sight.
        v.opacity.set(withTiming(0, { duration: SWIPE_EXIT_MS, easing: Easing.in(Easing.cubic), reduceMotion }, (done) => done && runOnJS(onGone)(id)));
      } else {
        v.scale.set(withTiming(LEAVE_SCALE, { duration: LEAVE_MS, reduceMotion }));
        v.opacity.set(withTiming(0, { duration: LEAVE_MS, reduceMotion }, (done) => done && runOnJS(onGone)(id)));
      }
    } else {
      // Back in the list (or just added): full size again, from wherever it was.
      v.scale.set(withSpring(1, move));
      v.opacity.set(withTiming(1, { duration: LEAVE_MS, reduceMotion }));
    }
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The slot of an item being dragged dims, to mark where it will land. */
function useDim(p: { dragging: boolean; floating: boolean; v: CellValues; reduceMotion: ReduceMotion }) {
  const { dragging, floating, v, reduceMotion } = p;
  useEffect(() => {
    v.dim.set(withTiming(dragging && !floating ? DRAGGED_OPACITY : 1, { duration: LEAVE_MS, reduceMotion }));
  }, [dragging, floating]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Lifted: it follows the finger, and grows a little. Dropped: it settles into its slot from where the finger left it. */
function useLift(p: {
  dragging: boolean;
  floating: boolean;
  rect: Rect | undefined;
  v: CellValues;
  f: FingerValues;
  wasLifted: MutableRefObject<boolean>;
  move: Move;
}) {
  const { dragging, floating, rect, v, f, wasLifted, move } = p;
  useEffect(() => {
    if (dragging && floating) {
      wasLifted.current = true;
      v.lifted.set(1);
      v.scale.set(withSpring(LIFT_SCALE, move));
    } else if (wasLifted.current) {
      wasLifted.current = false;
      v.x.set(f.fx.get() + f.sx.get() + f.ox.get() - f.gx.get());
      v.y.set(f.fy.get() + f.sy.get() + f.oy.get() - f.gy.get());
      v.lifted.set(0);
      if (rect) {
        v.x.set(withSpring(rect.x, move));
        v.y.set(withSpring(rect.y, move));
        v.w.set(withSpring(rect.width, move));
        v.h.set(withSpring(rect.height, move));
      }
      v.scale.set(withSpring(1, move));
    }
  }, [dragging, floating]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Where and how the cell is drawn, from its values, on the UI thread. A lifted cell is where the finger
 * holds it: the finger's place in the grid's frame plus the scroll offset as the UI thread has it. A swiped one stays whole and above the others.
 */
function useCellStyle(v: CellValues, f: FingerValues, swipeAxis: 'x' | 'y') {
  const { x, y, w, h, scale, opacity, dim, lifted, swipe } = v;
  const { fx, fy, gx, gy, sx, sy, ox, oy } = f;
  return useAnimatedStyle(() => {
    const up = lifted.get() === 1;
    const away = swipe.get();
    return {
      width: w.get(),
      height: h.get(),
      opacity: opacity.get() * dim.get(),
      zIndex: up ? 100 : away !== 0 ? 50 : 0,
      transform: [
        { translateX: (up ? fx.get() + sx.get() + ox.get() - gx.get() : x.get()) + (swipeAxis === 'x' ? away : 0) },
        { translateY: (up ? fy.get() + sy.get() + oy.get() - gy.get() : y.get()) + (swipeAxis === 'y' ? away : 0) },
        { scale: scale.get() },
      ],
    };
  });
}

/** An item's visuals. Drawn again only when what it's drawn from changes, not whenever the grid renders. */
function ItemContentImpl<T>({
  item,
  index,
  width,
  height,
  dragging,
  swipe,
  renderItem,
}: {
  item: T;
  index: number;
  width: number;
  height: number;
  dragging: boolean;
  swipe: SharedValue<number>;
  renderItem: (item: T, info: ItemRenderInfo) => ReactNode;
}) {
  return <>{renderItem(item, { index, size: { width, height }, dragging, swipe })}</>;
}
const ItemContent = memo(ItemContentImpl) as typeof ItemContentImpl;

const sameRect = (a?: Rect, b?: Rect) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/**
 * A cell is drawn again only when something it shows changes. `start` and
 * `appear` are read once, when it mounts, so a change of them is no reason to.
 */
function sameCell(a: CellProps<unknown>, b: CellProps<unknown>): boolean {
  return (
    a.id === b.id &&
    a.item === b.item &&
    a.index === b.index &&
    a.renderItem === b.renderItem &&
    sameRect(a.rect, b.rect) &&
    a.leaving === b.leaving &&
    a.dragging === b.dragging &&
    a.floating === b.floating &&
    a.finger === b.finger &&
    a.cellNodes === b.cellNodes &&
    a.swipes === b.swipes &&
    a.swipeAxis === b.swipeAxis &&
    a.exit === b.exit &&
    a.onGone === b.onGone &&
    a.reduceMotion === b.reduceMotion
  );
}

/** One item's visuals: placed by animated values, so every move starts from where it is. */
function ReflowCellImpl<T>({
  id,
  item,
  index,
  renderItem,
  rect,
  start,
  leaving = false,
  appear = false,
  dragging = false,
  floating = false,
  finger,
  cellNodes,
  swipes,
  swipeAxis,
  exit,
  onGone,
  reduceMotion,
}: CellProps<T>) {
  const move = useMemo<Move>(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
  const v = useCellValues(start ?? rect, appear);
  const f = useFingerValues(finger);
  const wasLifted = useRef(false);

  // In this order: they are effects, and run in it.
  useSwipeRegistration(id, v.swipe, swipes);
  usePlacement({ id, rect, from: start ?? rect, leaving, appear, dragging, floating, v, wasLifted, move });
  useLeaving({ id, leaving, exit, v, move, onGone });
  useDim({ dragging, floating, v, reduceMotion });
  useLift({ dragging, floating, rect, v, f, wasLifted, move });

  // What the item is drawn at: its slot's size, but a lifted one keeps the size it was lifted at.
  const liftedSize = useRef<Size | undefined>(undefined);
  if (dragging && floating && rect) liftedSize.current ??= { width: rect.width, height: rect.height };
  else liftedSize.current = undefined;

  const style = useCellStyle(v, f, swipeAxis);

  return (
    <Animated.View
      ref={(node: unknown) => {
        if (node) cellNodes.current.set(id, node);
        else cellNodes.current.delete(id);
      }}
      style={[styles.cell, style]}
      pointerEvents="none"
    >
      <ItemContent
        item={item}
        index={index}
        width={leaving ? 0 : (liftedSize.current?.width ?? rect?.width ?? 0)}
        height={leaving ? 0 : (liftedSize.current?.height ?? rect?.height ?? 0)}
        dragging={dragging}
        swipe={v.swipe}
        renderItem={renderItem}
      />
    </Animated.View>
  );
}

export const ReflowCell = memo(ReflowCellImpl, sameCell as never) as typeof ReflowCellImpl;

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0 },
});
