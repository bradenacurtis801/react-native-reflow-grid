import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import { beginDrag, edgeVelocity, endDrag, slotAt, updateDrag, type DragResult, type DragSession, type DragState, type Point } from './drag';
import { intersects, type Rect, type ReflowLayout, type ReflowResult, type Region, type Size } from './layout';

/** How cells glide to a new place: a quick spring, so one set going while another is still moving carries on from where it is. */
const MOVE = { damping: 26, stiffness: 320, mass: 0.9 };
/** A cell leaving shrinks and fades over this long (ms). */
const LEAVE_MS = 180;
const LEAVE_SCALE = 0.5;
/** A cell added later starts this small and grows in. */
const ENTER_SCALE = 0.6;
/** A finger that moves further than this (pt) from where it went down is scrolling, not pressing. */
const SLOP = 10;
/** Cells this far (pt) beyond the screen are kept mounted, so a scroll doesn't mount them at the edge. */
const BUFFER = 300;
/** Held at an edge this long (ms), a drag in a paged layout turns the page; held on, it turns another. */
const PAGE_DWELL_MS = 700;
/** A page turn on web takes this long (ms). */
const PAGE_TURN_MS = 320;
/** A drag scrolls at this fraction of its speed when it reaches an edge, and builds up to all of it over `RAMP_MS`. */
const RAMP_FROM = 0.3;
const RAMP_MS = 1000;
/** A drag whose pointer has sent nothing for this long (ms) has left the window: it stops scrolling. */
const QUIET_MS = 500;
/** After a drop, the new order is held this long (ms) for `data` to follow. */
const HOLD_MS = 600;
/** A dragged item's slot dims to this, to show where it will land. */
const DRAGGED_OPACITY = 0.35;

interface Leaving<T> {
  key: string;
  item: T;
}

interface ItemInfo {
  index: number;
  size: Size;
  /** It's being dragged: its slot shows where it will land. */
  dragging: boolean;
}

/**
 * A pressable part of an item, in the item's own space (`rect`, from its
 * top-left). `onPress` runs when a finger that went down inside it lifts
 * again without having moved (`SLOP`) — so a scroll that starts there isn't a press.
 */
export interface TouchRegion {
  key: string;
  rect: Rect;
  onPress: () => void;
}

/** A finger that went down on a region and hasn't lifted yet. */
interface Pending {
  region: TouchRegion;
  startX: number;
  startY: number;
  /** It moved too far: a scroll, not a press. */
  moved: boolean;
}

/** A scroll position, in the scroll view's terms (what `contentOffset` reports). */
interface Offset {
  x: number;
  y: number;
}

function sameIndices(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Items laid out by `layout` — a grid, a list, a strip, anything a layout
 * function can describe (`./layout.ts`) — in a scroll view the grid owns, so
 * it knows what's on screen. Only the items on screen (and a buffer either
 * side) are mounted; the rest exist only as their slots in the layout. Take
 * an item out of `data` and it shrinks away while each item after it glides
 * into the place before it, as a collection view's delete does; add one and
 * it grows in where it goes. A change of `layout`, or of the container's
 * size, glides the same way — for the items on screen. Items off screen move
 * with no animation, since nobody can see them.
 *
 * Presses are decided here, not by the controls. `touchRegions` says where
 * an item's pressable parts are, in its own space. Each finger is followed
 * by its own id from the grid's touch events: where it goes down is hit
 * against the items' final slots (where the layout puts them, not where
 * their animations have got to), and a press fires when that finger lifts
 * without having moved (`SLOP`). A finger that moves further is a scroll
 * and never presses, and a cancelled touch (the scroll view taking over)
 * presses nothing. Several fingers at once each keep their own state.
 *
 * Nothing here is a responder. A `Pressable` per control can't do this: one
 * touch holds the responder, and the next finger's press is dropped.
 *
 * The visuals (`renderItem`) take no touches; a leaving item has no regions,
 * so a tap can't land on it.
 *
 * Give it its size (`style`): it fills the room it's in and scrolls the rest
 * along `axis` — or along both, for cards with a fixed width and height.
 */
export function ReflowGrid<T>({
  data,
  keyExtractor,
  renderItem,
  touchRegions,
  layout,
  axis = 'vertical',
  startInset: startProp,
  endInset: endProp,
  crossStartInset = 0,
  crossEndInset = 0,
  onMounted,
  onReorder,
  canDrag,
  reduceMotion = ReduceMotion.System,
  style,
}: {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  /** One item's visuals: they fill the cell the layout gives it. */
  renderItem: (item: T, info: ItemInfo) => ReactNode;
  /** One item's pressable parts (see `TouchRegion`). Memoize it with the rest. */
  touchRegions?: (item: T, info: ItemInfo) => TouchRegion[];
  /** Memoize it: a new function lays everything out again. */
  layout: ReflowLayout<T>;
  /**
   * The directions the grid scrolls. `'vertical'` and `'horizontal'` scroll
   * along one axis, and the layout's room is split across the other. `'both'`
   * scrolls on both, for a layout whose cards have a fixed width and height.
   * @default 'vertical'
   */
  axis?: 'vertical' | 'horizontal' | 'both';
  /**
   * Space the scrolled items must start and end clear of — the header over
   * the top (`startInset`), the tab bar under the bottom (`endInset`), along
   * the vertical axis (or the horizontal one, for a horizontal grid). The grid
   * is full-bleed: its content scrolls under the header, and rests below it.
   * iOS insets the scroll view; Android pads it. @default 0
   */
  startInset?: number;
  endInset?: number;
  /**
   * For a horizontal grid: space its rows must stay clear of at the top and
   * bottom (what is pinned over them). Unused on other axes. @default 0
   */
  crossStartInset?: number;
  crossEndInset?: number;
  /** How many cells are mounted, after each change of them. */
  onMounted?: (count: number) => void;
  /**
   * Turns on drag to reorder (web, for now): a dragged item's slot follows the
   * finger and the others make room. Called on a drop that changed the order,
   * with the new order of the keys — put `data` in that order. The grid shows
   * the new order meanwhile, so a `data` that follows a moment later doesn't flicker.
   */
  onReorder?: (result: DragResult) => void;
  /** Whether an item can be dragged. @default every item can */
  canDrag?: (item: T, index: number) => boolean;
  /**
   * Whether the animations follow the device's reduce-motion setting (they
   * jump to their end when it's on), page turns during a drag included.
   * `ReduceMotion.Never` always animates.
   * @default ReduceMotion.System
   */
  reduceMotion?: ReduceMotion;
  style?: StyleProp<ViewStyle>;
}) {
  const mainHorizontal = axis === 'horizontal';
  const move = useMemo(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
  // Whether the device asks for no motion, and `reduceMotion` goes along with it.
  const systemReduced = useReducedMotion();
  const instant = reduceMotion === ReduceMotion.Always || (reduceMotion === ReduceMotion.System && systemReduced);
  const android = Platform.OS === 'android';
  const ios = Platform.OS === 'ios';
  // Only iOS has a scroll inset; everywhere else (Android, web) the insets are padding.
  const padded = !ios;
  const insetY = mainHorizontal
    ? { start: 0, end: 0 }
    : { start: startProp ?? 0, end: endProp ?? 0 };
  const insetX = mainHorizontal ? { start: startProp ?? 0, end: endProp ?? 0 } : { start: 0, end: 0 };
  // A sideways grid's rows also clear what's pinned over its top and bottom .
  const crossStart = mainHorizontal ? crossStartInset : 0;
  const crossEnd = mainHorizontal ? crossEndInset : 0;
  const [viewport, setViewport] = useState<Size>();
  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((was) => (was?.width === width && was.height === height ? was : { width, height }));
    // Where it is now, for the touches that follow.
    rootRef.current?.measureInWindow((left, top) => {
      origin.current = { left, top };
    });
  }, []);

  // Items taken out of `data` stay drawn until they've shrunk away (`leaving`).
  // Worked out as `data` changes, in render: after the commit they'd be gone for a frame.
  const [seen, setSeen] = useState(data);
  const [leaving, setLeaving] = useState<Leaving<T>[]>([]);
  if (seen !== data) {
    const keys = new Set(data.map(keyExtractor));
    setSeen(data);
    setLeaving([
      ...leaving.filter((l) => !keys.has(l.key)),
      ...seen.flatMap((item, i) => {
        const key = keyExtractor(item, i);
        return keys.has(key) ? [] : [{ key, item }];
      }),
    ]);
  }

  // Dragging: what's shown is `data` in the order of the drag's preview — after a
  // drop, in the order it left, until `data` follows (or a moment passes).
  const [drag, setDrag] = useState<DragState>();
  const dragRef = useRef<DragState>(undefined);
  const [held, setHeld] = useState<readonly string[]>();
  const byKey = useRef(new Map<string, T>());
  if (held && seen !== data) setHeld(undefined);
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setHeld(undefined), HOLD_MS);
    return () => clearTimeout(timer);
  }, [held]);
  const order = drag?.preview ?? held;
  const items = useMemo(() => (order ? order.map((k) => byKey.current.get(k) as T) : data), [order, data]);
  const draggedKeys = useMemo(() => new Set(drag?.dragged), [drag?.dragged]);

  // The layout's room: the viewport, less the cross-axis insets (a sideways grid's rows sit between them).
  const roomWidth = viewport?.width;
  const roomHeight = viewport ? (mainHorizontal ? Math.max(viewport.height - crossStart - crossEnd, 0) : viewport.height) : undefined;
  const placed = useMemo(
    () => (roomWidth != null && roomHeight != null ? layout(items, { width: roomWidth, height: roomHeight }) : undefined),
    [layout, items, roomWidth, roomHeight],
  );

  // Scrolling: the offset is a ref, so a scroll doesn't render; a render comes
  // only when the items on screen change (`onScroll`).
  // iOS rests at minus the start inset (the header's space, drawn over). Android pads instead, and rests at 0.
  const offset = useRef<Offset>({ x: ios ? -insetX.start : 0, y: ios ? -insetY.start : 0 });
  // A change of axis is a new scroll view (`key` below), resting at its own start: the old axis's offset would misplace every touch and window.
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
    return { x0: c.x - BUFFER, x1: c.x + v.width + BUFFER, y0: c.y - BUFFER, y1: c.y + v.height + BUFFER };
  };
  const shown = useRef<number[] | undefined>(undefined);
  const [, showMore] = useState(0);
  const indicesAt = (o: Offset): number[] | undefined =>
    placed ? placed.indicesIn(windowOf(o)) : undefined;
  // A scroll view reports its own axis: the outer (vertical) and, for `both`, the inner (horizontal).
  const track = (next: Offset) => {
    offset.current = next;
    if (!sameIndices(indicesAt(next), shown.current)) showMore((n) => n + 1);
  };
  const onScrollY = (e: NativeSyntheticEvent<NativeScrollEvent>) => track({ x: offset.current.x, y: e.nativeEvent.contentOffset.y });
  // A sideways grid never scrolls across: its y stays 0 (the header's space is its frame's padding, not an offset).
  const onScrollX = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    track({ x: e.nativeEvent.contentOffset.x, y: mainHorizontal ? 0 : offset.current.y });
  const indices = indicesAt(offset.current);
  shown.current = indices;

  // The last known slot of each item on screen, kept for a leaving one too: it
  // leaves from there. An item off screen has none, so it moves with no animation.
  const lastRects = useRef(new Map<string, Rect>());
  // Each mounted cell's element on web, for the image a drag carries.
  const cellNodes = useRef(new Map<string, unknown>());
  // The items on screen, with where they go and their touch regions — what a touch is hit against.
  const slots = useRef<{ key: string; rect: Rect; regions: TouchRegion[] }[]>([]);
  // Every key the grid has shown before this render: an item not among them is new, and grows in.
  const knownKeys = useRef(new Set<string>());
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  useEffect(() => {
    knownKeys.current = new Set(data.map(keyExtractor));
  }, [data, keyExtractor]);
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
      setLeaving((all) => all.filter((l) => l.key !== key));
    },
    [],
  );

  // A leaving item that's off screen has nothing to animate: it's gone now.
  useEffect(() => {
    const w = windowOf(offset.current);
    for (const l of leaving) {
      const rect = lastRects.current.get(l.key);
      if (!rect || !intersects(rect, w)) gone(l.key);
    }
    // Only when a removal changes what's leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // The content's size follows the items: it grows and shrinks with them. A
  // sideways grid's content is at least the room across, so the scroll only
  // travels along its own axis — no slack to drift up and down.
  const contentHeight = placed ? placed.size.height : 0;
  const width = useSharedValue(placed?.size.width ?? 0);
  const height = useSharedValue(contentHeight);
  const sized = useRef(false);
  useEffect(() => {
    if (!placed) return;
    if (!sized.current) {
      sized.current = true;
      width.set(placed.size.width);
      height.set(contentHeight);
      return;
    }
    width.set(withSpring(placed.size.width, move));
    height.set(withSpring(contentHeight, move));
  }, [placed, contentHeight, width, height, move]);
  const contentStyle = useAnimatedStyle(() => ({ width: width.get(), height: height.get() }));
  // With both axes scrolling, the inner (horizontal) scroll view is as tall as its content.
  const innerStyle = useAnimatedStyle(() => ({ height: height.get() }));

  // The cells on screen. A cell is keyed by its item, so one that goes from
  // `data` to `leaving` is the same cell, and carries on from where it was.
  const cells: ReactNode[] = [];
  const slotList: { key: string; rect: Rect; regions: TouchRegion[] }[] = [];
  if (placed) {
    const w = windowOf(offset.current);
    for (const index of indices ?? []) {
      const item = items[index]!;
      const key = keyExtractor(item, index);
      const rect = placed.rectOf(index);
      const info: ItemInfo = { index, size: { width: rect.width, height: rect.height }, dragging: draggedKeys.has(key) };
      slotList.push({ key, rect, regions: touchRegions?.(item, info) ?? [] });
      cells.push(
        <ReflowCell
          key={key}
          id={key}
          rect={rect}
          start={lastRects.current.get(key)}
          appear={settled.current && !knownKeys.current.has(key)}
          dragging={info.dragging}
          cellNodes={cellNodes}
          onGone={gone}
          reduceMotion={reduceMotion}
        >
          {renderItem(item, info)}
        </ReflowCell>,
      );
    }
    for (const l of leaving) {
      const rect = lastRects.current.get(l.key);
      if (!rect || !intersects(rect, w)) continue;
      cells.push(
        <ReflowCell key={l.key} id={l.key} leaving start={rect} onGone={gone} cellNodes={cellNodes} reduceMotion={reduceMotion}>
          {renderItem(l.item, { index: -1, size: { width: 0, height: 0 }, dragging: false })}
        </ReflowCell>,
      );
    }
  }
  slots.current = slotList;
  const mountedCount = cells.length;
  useEffect(() => onMounted?.(mountedCount), [mountedCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each finger, by its id, from the grid's own touch events (which carry
  // every finger, not one responder's): down on a region, then either it
  // lifts still — a press — or it moves, or the touch is cancelled — nothing.
  // Positions are in the content's space: the viewport's, plus the scroll.
  const root = rootRef;
  // Where the grid sits on screen, from its last layout: a touch is placed at once, not after an async measure that a quick tap can outrun.
  const origin = useRef<{ left: number; top: number } | undefined>(undefined);
  const pending = useRef(new Map<string, Pending>());
  // The region under a point (page coordinates), for a grid whose top-left sits at `left`, `top`.
  // A page point in the content's space.
  const contentPoint = (pageX: number, pageY: number, left: number, top: number): Point => {
    const c = contentOf(offset.current);
    // A horizontal grid's content starts below the frame's top padding, which the scroll doesn't count.
    return { x: pageX - left + c.x, y: pageY - top + c.y - (mainHorizontal ? crossStart : 0) };
  };
  const regionAt = (pageX: number, pageY: number, left: number, top: number) => {
    const { x, y } = contentPoint(pageX, pageY, left, top);
    const slot = slots.current.find(
      (s) => x >= s.rect.x && x < s.rect.x + s.rect.width && y >= s.rect.y && y < s.rect.y + s.rect.height,
    );
    const local = slot && { x: x - slot.rect.x, y: y - slot.rect.y };
    return slot && local
      ? slot.regions.find(
          (r) => local.x >= r.rect.x && local.x < r.rect.x + r.rect.width && local.y >= r.rect.y && local.y < r.rect.y + r.rect.height,
        )
      : undefined;
  };
  const onTouchStart = (e: GestureResponderEvent) => {
    const { changedTouches } = e.nativeEvent;
    // On web this is a `TouchList`, not an array.
    const downs = Array.from(changedTouches, (t) => ({ id: t.identifier, x: t.pageX, y: t.pageY }));
    const place = (left: number, top: number) => {
      for (const { id, x: pageX, y: pageY } of downs) {
        const region = regionAt(pageX, pageY, left, top);
        if (region) pending.current.set(id, { region, startX: pageX, startY: pageY, moved: false });
      }
    };
    if (origin.current) place(origin.current.left, origin.current.top);
    else root.current?.measureInWindow(place);
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      const p = pending.current.get(t.identifier);
      if (!p || p.moved) continue;
      if (Math.hypot(t.pageX - p.startX, t.pageY - p.startY) > SLOP) {
        p.moved = true;
      }
    }
  };
  const lastTouchEnd = useRef(0);
  const onTouchEnd = (e: GestureResponderEvent) => {
    lastTouchEnd.current = Date.now();
    const { changedTouches } = e.nativeEvent;
    for (const t of changedTouches) {
      const p = pending.current.get(t.identifier);
      pending.current.delete(t.identifier);
      if (!p) continue;
      if (!p.moved) p.region.onPress();
    }
  };
  const onTouchCancel = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) pending.current.delete(t.identifier);
  };
  // Web with a mouse sends no touch events, only clicks. A touch screen's tap sends both, so a click right after a touch end is the same press.
  const onClick = (e: { clientX: number; clientY: number }) => {
    if (Date.now() - lastTouchEnd.current < 700) return;
    const left = origin.current?.left ?? 0;
    const top = origin.current?.top ?? 0;
    regionAt(e.clientX, e.clientY, left, top)?.onPress();
  };

  // Drag to reorder on web, through the browser's own drag and drop. It sends its
  // events to the grid's element (the props a `View` forwards don't include them),
  // so they're listened for there, and read what's current from `driver`.
  // While the pointer is near an edge of what's on screen the content scrolls
  // that way, and the target is worked out again as it moves under the pointer.
  // The browser sends no events for a pointer that is still, so a frame loop
  // does the scrolling; `over` starts it, and it ends itself.
  const pointer = useRef<{ x: number; y: number; at: number }>(undefined);
  // A page turn on web is worked out here, a frame at a time: the browser's own smooth scroll is
  // switched off by a reduce-motion setting, which would make every turn instant. Scroll snap is
  // off while it runs, so it doesn't fight the steps.
  const [turning, setTurning] = useState(false);
  const scroller = useRef<{ raf?: number; time: number; pos: Offset; held?: number; dwell?: { dir: number; since: number }; turn?: { from: number; to: number; start: number; horizontal: boolean } }>({ time: 0, pos: { x: 0, y: 0 } });
  const stopScroll = () => {
    if (scroller.current.raf !== undefined) cancelAnimationFrame(scroller.current.raf);
    scroller.current.raf = undefined;
  };
  useEffect(() => stopScroll, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** How fast, along each axis, the pointer (in client coordinates) is asking the content to scroll. */
  const scrollSpeed = (p: Point): Point => {
    const at = origin.current ?? { left: 0, top: 0 };
    if (!viewport) return { x: 0, y: 0 };
    return {
      x: axis === 'vertical' ? 0 : edgeVelocity(p.x - at.left, insetX.start, viewport.width - insetX.end),
      y: mainHorizontal ? 0 : edgeVelocity(p.y - at.top, insetY.start, viewport.height - insetY.end),
    };
  };
  /** Works the target out again for the pointer (in client coordinates), after the content has moved under it. */
  const retarget = (state: DragState, base: ReflowResult, p: Point) => {
    const at = origin.current ?? { left: 0, top: 0 };
    const next = updateDrag(state, base, contentPoint(p.x, p.y, at.left, at.top));
    if (next !== state) {
      dragRef.current = next;
      setDrag(next);
    }
  };
  const frame = useRef<(time: number) => void>(undefined);
  frame.current = (time) => {
    const scroll = scroller.current;
    scroll.raf = undefined;
    const again = () => {
      scroll.raf = requestAnimationFrame((t) => frame.current?.(t));
    };
    const turn = scroll.turn;
    if (turn) {
      const t = Math.min(Math.max((time - turn.start) / PAGE_TURN_MS, 0), 1);
      const at = turn.from + (turn.to - turn.from) * (1 - (1 - t) ** 3);
      const to = turn.horizontal ? { x: at, y: offset.current.y } : { x: offset.current.x, y: at };
      scrollRef.current?.scrollTo({ ...to, animated: false });
      track(to);
      if (t >= 1) {
        scroll.turn = undefined;
        // Held on, it takes another dwell to turn the next.
        scroll.dwell = undefined;
        setTurning(false);
      }
    }
    const state = dragRef.current;
    const base = baseLayout.current;
    const p = pointer.current;
    // Over, or the pointer has gone quiet (out of the window): nothing more to do, but finish a turn.
    if (!state || !base || !p || !viewport || !placed || time - p.at > QUIET_MS) {
      if (scroll.turn) again();
      return;
    }
    const speed = scrollSpeed(p);
    if (speed.x === 0 && speed.y === 0) {
      scroll.dwell = undefined;
      if (scroll.turn) again();
      return;
    }
    // The longer it's held at the edge, the faster it goes.
    const ramp = RAMP_FROM + (1 - RAMP_FROM) * Math.min(Math.max(time - (scroll.held ?? time), 0) / RAMP_MS, 1);
    // A paged layout doesn't scroll steadily: held at an edge it turns the page, and turns another if still held.
    const pages = placed.pages;
    if (pages) {
      const horizontal = pages.direction === 'horizontal';
      const dir = Math.sign(horizontal ? speed.x : speed.y);
      if (scroll.dwell?.dir !== dir) {
        scroll.dwell = { dir, since: time };
      } else if (time - scroll.dwell.since >= PAGE_DWELL_MS && !scroll.turn) {
        const from = horizontal ? offset.current.x : offset.current.y;
        const to = Math.min(Math.max(Math.round(from / pages.stride) + dir, 0), pages.count - 1) * pages.stride;
        scroll.dwell = { dir, since: time };
        if (to !== from) {
          if (Platform.OS === 'web' && !instant) {
            scroll.turn = { from, to, start: time, horizontal };
            setTurning(true);
          } else {
            // Native animates its own (unless asked not to); web, asked not to, jumps.
            scrollRef.current?.scrollTo({ x: horizontal ? to : offset.current.x, y: horizontal ? offset.current.y : to, animated: Platform.OS !== 'web' && !instant });
          }
        }
      }
      // The pages slide under the pointer, so its target follows.
      retarget(state, base, p);
      again();
      return;
    }
    const dt = Math.min((time - scroll.time) / 1000, 0.05);
    scroll.time = time;
    // The scroll view's content: the items, with the insets as padding.
    const room = {
      x: Math.max(placed.size.width + insetX.start + insetX.end - viewport.width, 0),
      y: Math.max(placed.size.height + insetY.start + insetY.end - viewport.height, 0),
    };
    const pos = {
      x: Math.min(Math.max(scroll.pos.x + speed.x * ramp * dt, 0), room.x),
      y: Math.min(Math.max(scroll.pos.y + speed.y * ramp * dt, 0), room.y),
    };
    if (pos.x !== scroll.pos.x || pos.y !== scroll.pos.y) {
      scroll.pos = pos;
      scrollRef.current?.scrollTo({ x: pos.x, y: pos.y, animated: false });
      track(pos);
      retarget(state, base, p);
    }
    scroll.raf = requestAnimationFrame((t) => frame.current?.(t));
  };
  const finish = (cancelled: boolean) => {
    stopScroll();
    const turn = scroller.current.turn;
    if (turn) {
      // A turn still under way lands at once.
      const to = turn.horizontal ? { x: turn.to, y: offset.current.y } : { x: offset.current.x, y: turn.to };
      scrollRef.current?.scrollTo({ ...to, animated: false });
      track(to);
      scroller.current.turn = undefined;
      setTurning(false);
    }
    scroller.current.dwell = undefined;
    scroller.current.held = undefined;
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = undefined;
    const result = endDrag(state, cancelled);
    if (result) {
      setHeld(result.keys);
      onReorder?.(result);
    }
    setDrag(undefined);
  };
  const baseLayout = useRef<ReflowResult>(undefined);
  const driver = useRef<Record<'start' | 'over' | 'drop' | 'end', (e: DragEvent) => void>>(undefined);
  driver.current = {
    start: (e) => {
      const at = origin.current ?? { left: 0, top: 0 };
      const point = contentPoint(e.clientX, e.clientY, at.left, at.top);
      const index = placed ? slotAt(placed, items.length, point) : undefined;
      const rect = index !== undefined ? placed?.rectOf(index) : undefined;
      const over = rect && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
      if (!placed || index === undefined || !rect || !over || (canDrag && !canDrag(items[index]!, index))) {
        e.preventDefault();
        return;
      }
      const keys = items.map(keyExtractor);
      const session: DragSession = { origin: 'internal', items: [{ key: keys[index]!, types: ['text/plain'], local: items[index] }] };
      const state = beginDrag(keys, session);
      if (!state || !e.dataTransfer) return;
      byKey.current = new Map(items.map((item, i) => [keys[i]!, item]));
      baseLayout.current = placed;
      dragRef.current = state;
      setDrag(state);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', keys[index]!);
      const node = cellNodes.current.get(keys[index]!) as Element | undefined;
      if (node) e.dataTransfer.setDragImage(node as HTMLElement, point.x - rect.x, point.y - rect.y);
    },
    over: (e) => {
      const state = dragRef.current;
      const base = baseLayout.current;
      // Only a drag that began here can land here.
      if (!state || !base) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const at = origin.current ?? { left: 0, top: 0 };
      const next = updateDrag(state, base, contentPoint(e.clientX, e.clientY, at.left, at.top));
      if (next !== state) {
        dragRef.current = next;
        setDrag(next);
      }
      const p = { x: e.clientX, y: e.clientY, at: performance.now() };
      pointer.current = p;
      const scroll = scroller.current;
      if (scroll.raf === undefined) {
        const speed = scrollSpeed(p);
        if (speed.x !== 0 || speed.y !== 0) {
          scroll.pos = { ...offset.current };
          scroll.time = p.at;
          scroll.held = p.at;
          scroll.raf = requestAnimationFrame((t) => frame.current?.(t));
        }
      }
    },
    drop: (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      finish(false);
    },
    // After a drop this has nothing left to do; after one that missed the grid, it ends the drag.
    end: () => finish(true),
  };
  const reorderable = onReorder != null;
  useEffect(() => {
    const el = Platform.OS === 'web' && reorderable ? (root.current as unknown as HTMLElement | null) : null;
    if (!el) return;
    const types = { start: 'dragstart', over: 'dragover', drop: 'drop', end: 'dragend' } as const;
    const listeners = (Object.keys(types) as (keyof typeof types)[]).map((name) => {
      const listener = (e: Event) => driver.current?.[name](e as DragEvent);
      el.addEventListener(types[name], listener);
      return [types[name], listener] as const;
    });
    el.setAttribute('draggable', 'true');
    return () => {
      for (const [type, listener] of listeners) el.removeEventListener(type, listener);
      el.removeAttribute('draggable');
    };
  }, [reorderable]); // eslint-disable-line react-hooks/exhaustive-deps

  // A paged layout snaps. Native has `pagingEnabled`. On web it's CSS scroll snap, with a marker at the
  // start of each page: `pagingEnabled` there would replace the style of the content view.
  const pages = placed?.pages;
  const web = Platform.OS === 'web';
  const snap = pages && web && !turning ? ({ scrollSnapType: pages.direction === 'horizontal' ? 'x mandatory' : 'y mandatory' } as ViewStyle) : undefined;
  const markers =
    pages && web
      ? Array.from({ length: pages.count }, (_, page) => (
          <PageMarker key={`page${page}`} at={page * pages.stride} stride={pages.stride} horizontal={pages.direction === 'horizontal'} />
        ))
      : null;

  // Two axes. On iOS one scroll view holds both: its content is wider and taller than its frame, so one drag moves it diagonally.
  // Android has no two-axis scroll view, so there a horizontal one nests inside the vertical (a drag then belongs to one axis).
  const both = axis === 'both';
  const nested = both && android;
  const outerInset = mainHorizontal ? insetX : insetY;
  const onScrollBoth = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    track({ x: e.nativeEvent.contentOffset.x, y: e.nativeEvent.contentOffset.y });
  const outerContent = nested ? (
    <Animated.ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScrollX}
      style={innerStyle}
    >
      <Animated.View style={contentStyle}>{cells}</Animated.View>
    </Animated.ScrollView>
  ) : (
    <Animated.View style={contentStyle}>{cells}</Animated.View>
  );

  return (
    <View
      ref={root}
      // A sideways grid's frame stops short of the header and the footer, so its scroll view has no room to move across.
      style={[style, { paddingTop: crossStart, paddingBottom: crossEnd }]}
      onLayout={onLayout}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      {...(Platform.OS === 'web' ? ({ onClick } as object) : null)}
    >
      <ScrollView
        ref={scrollRef}
        key={axis}
        horizontal={mainHorizontal}
        // The insets are the grid's own (above), not the system's: UIKit's automatic one would add its own on top.
        contentInsetAdjustmentBehavior="never"
        contentInset={mainHorizontal ? { left: outerInset.start, right: outerInset.end } : { top: outerInset.start, bottom: outerInset.end }}
        contentOffset={mainHorizontal ? { x: -outerInset.start, y: 0 } : { x: 0, y: -outerInset.start }}
        contentContainerStyle={[
          padded &&
            (mainHorizontal
              ? { paddingLeft: outerInset.start, paddingRight: outerInset.end }
              : { paddingTop: outerInset.start, paddingBottom: outerInset.end }),
          // One view on two axes: its container is as wide as the content, not the frame, so there's something to pan across.
          both && !nested && { width: placed?.size.width },
        ]}
        onScroll={mainHorizontal ? onScrollX : nested || !both ? onScrollY : onScrollBoth}
        scrollEventThrottle={16}
        // A sideways grid's scroll view is as tall as its row, so its indicator sits under the tiles, not at the room's foot.
        style={[mainHorizontal && placed && roomHeight != null ? { height: Math.min(placed.size.height, roomHeight) } : undefined, snap]}
        pagingEnabled={pages != null && !web}
        // A one-axis grid scrolls only along its axis: no bounce, and no drift across. Two axes lock nothing.
        alwaysBounceVertical={!mainHorizontal}
        directionalLockEnabled={!both}
        // The indicator for the axis it scrolls along, inset as the content is so it sits clear of the header and footer.
        showsHorizontalScrollIndicator={mainHorizontal || (both && !nested)}
        showsVerticalScrollIndicator={!mainHorizontal}
        scrollIndicatorInsets={mainHorizontal ? { left: outerInset.start, right: outerInset.end } : { top: outerInset.start, bottom: outerInset.end }}
      >
        {outerContent}
        {markers}
      </ScrollView>
    </View>
  );
}

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

/** One item's visuals: placed by animated values, so every move starts from where it is. */
function ReflowCell({
  id,
  rect,
  start,
  leaving = false,
  appear = false,
  dragging = false,
  cellNodes,
  onGone,
  reduceMotion,
  children,
}: {
  id: string;
  /** Where it goes — absent once it's leaving: it stays where it is. */
  rect?: Rect;
  /** Where it starts from when it's mounted: its last slot, so a move that was under way carries on. */
  start?: Rect;
  leaving?: boolean;
  /** Added after the rest were shown: grows in. */
  appear?: boolean;
  /** Being dragged: dims, to mark the slot it will land in. */
  dragging?: boolean;
  /** Where the cell registers its element (web), for the image a drag carries. */
  cellNodes: { current: Map<string, unknown> };
  onGone: (id: string) => void;
  reduceMotion: ReduceMotion;
  children: ReactNode;
}) {
  const from = start ?? rect;
  const move = useMemo(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
  const x = useSharedValue(from?.x ?? 0);
  const y = useSharedValue(from?.y ?? 0);
  const w = useSharedValue(from?.width ?? 0);
  const h = useSharedValue(from?.height ?? 0);
  const scale = useSharedValue(appear ? ENTER_SCALE : 1);
  const opacity = useSharedValue(appear ? 0 : 1);
  const dim = useSharedValue(1);
  // The first placement isn't a move; only later ones are logged as such.
  const placed = useRef(false);

  useEffect(() => {
    if (leaving || !rect) return;
    const first = !placed.current;
    placed.current = true;
    // Mounted where it already belongs: nothing to animate.
    if (first && from && from.x === rect.x && from.y === rect.y && from.width === rect.width && from.height === rect.height) return;
    // One callback, on the horizontal spring: the others run to the same target.
    x.set(
withSpring(rect.x, move),
    );
    y.set(withSpring(rect.y, move));
    w.set(withSpring(rect.width, move));
    h.set(withSpring(rect.height, move));
  }, [leaving, rect?.x, rect?.y, rect?.width, rect?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (leaving) {
      scale.set(withTiming(LEAVE_SCALE, { duration: LEAVE_MS, reduceMotion }));
      opacity.set(withTiming(0, { duration: LEAVE_MS, reduceMotion }, (done) => done && runOnJS(onGone)(id)));
    } else {
      // Back in the list (or just added): full size again, from wherever it was.
      scale.set(withSpring(1, move));
      opacity.set(withTiming(1, { duration: LEAVE_MS, reduceMotion }));
    }
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    dim.set(withTiming(dragging ? DRAGGED_OPACITY : 1, { duration: LEAVE_MS, reduceMotion }));
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    width: w.get(),
    height: h.get(),
    opacity: opacity.get() * dim.get(),
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <Animated.View
      ref={(node: unknown) => {
        if (node) cellNodes.current.set(id, node);
        else cellNodes.current.delete(id);
      }}
      style={[styles.cell, style]}
      pointerEvents="none"
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0 },
});
