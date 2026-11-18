import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import type { DragResult, Point } from './drag';
import { SLOP, type Offset } from './dragEngine';
import { intersects, type Rect, type ReflowLayout, type Region, type Size } from './layout';
import { resolveHaptics, expoHaptics, type HapticsOption } from './haptics';
import { loadExpoHaptics } from './loadExpoHaptics';
import { PageDots } from './PageDots';
import { DOTS_HIT, type PageIndicatorOptions } from './pageIndicator';
import { useDragReorder } from './useDragReorder';
import { attachWebDrag } from './webDrag';

/** How cells glide to a new place: a quick spring, so one set going while another is still moving carries on from where it is. */
const MOVE = { damping: 26, stiffness: 320, mass: 0.9 };
/** A cell leaving shrinks and fades over this long (ms). */
const LEAVE_MS = 180;
const LEAVE_SCALE = 0.5;
/** A cell added later starts this small and grows in. */
const ENTER_SCALE = 0.6;
/** Cells this far (pt) beyond the screen are kept mounted, so a scroll doesn't mount them at the edge. */
const BUFFER = 300;
/** The page dots sit this far (pt) in from the edge of the grid, where a scroll indicator would. */
const DOTS_INSET = 6;
/** A lifted item is this much bigger. */
const LIFT_SCALE = 1.06;
/** A dragged item's slot dims to this, to show where it will land. */
const DRAGGED_OPACITY = 0.35;

interface Leaving<T> {
  key: string;
  item: T;
}

/** Where a lifted item follows the finger, in the content's space: the finger, and where it holds the item. */
interface Finger {
  x: SharedValue<number>;
  y: SharedValue<number>;
  gx: SharedValue<number>;
  gy: SharedValue<number>;
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

/** The page a scroll position is on: the nearest whole one. */
function pageOf(pages: { count: number; stride: number }, along: number): number {
  return pages.count > 0 && pages.stride > 0 ? Math.min(Math.max(Math.round(along / pages.stride), 0), pages.count - 1) : 0;
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
  onDragStart,
  haptics = true,
  pageIndicator = true,
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
   * Turns on drag to reorder: on web with a mouse through the browser's drag and
   * drop, and with a finger anywhere by holding on an item to lift it. The others
   * make room as it's dragged. Called on a drop that changed the order,
   * with the new order of the keys — put `data` in that order. The grid shows
   * the new order meanwhile, so a `data` that follows a moment later doesn't flicker.
   */
  onReorder?: (result: DragResult) => void;
  /** Whether an item can be dragged. @default every item can */
  canDrag?: (item: T, index: number) => boolean;
  /** An item has been lifted. Called with its key. (Haptic feedback is `haptics`.) */
  onDragStart?: (keys: readonly string[]) => void;
  /**
   * Haptic feedback for the grid's moments: lifting an item, it moving to another
   * slot, a drop that changed the order, a page turning during a drag, and
   * scrubbing the page dots. `true` (the default): `expo-haptics`, if the app has it
   * installed, and nothing if not (or on web). `false`: none. A function gets each
   * `HapticEvent`, to give feedback with whatever you use. @default true
   */
  haptics?: HapticsOption;
  /**
   * Whether the animations follow the device's reduce-motion setting (they
   * jump to their end when it's on), page turns during a drag included.
   * `ReduceMotion.Never` always animates.
   * @default ReduceMotion.System
   */
  reduceMotion?: ReduceMotion;
  /**
   * For a paged layout (`pagedLayout`): dots, one for each page and lit for the
   * one on screen, shown where the scroll indicator along the pages would be,
   * in place of it. Options style them. `false` shows no dots and leaves the
   * scroll indicator. @default true
   */
  pageIndicator?: boolean | PageIndicatorOptions;
  style?: StyleProp<ViewStyle>;
}) {
  const mainHorizontal = axis === 'horizontal';
  const move = useMemo(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
  // What gives feedback: the app's function, or `expo-haptics` if it has it (not on web), or nothing.
  const haptic = useMemo(
    () => resolveHaptics(haptics, () => (Platform.OS === 'web' ? undefined : expoHaptics(loadExpoHaptics))),
    [haptics],
  );
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

  // Dragging (see `dragEngine.ts`): what's shown is `data` in the order of the drag's preview — after a
  // drop, in the order it left, until `data` follows (or a moment passes).
  const { engine, snap, items, draggedKeys, lifted } = useDragReorder<T>(data);
  const { drag, floating } = snap;
  // A finger's drag lifts the item itself, which follows the finger: a cell follows these.
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const finger = useMemo<Finger>(() => ({ x: fingerX, y: fingerY, gx: grabX, gy: grabY }), [fingerX, fingerY, grabX, grabY]);

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
  // The page on screen, for the dots. What's drawn is worked out from the scroll offset on each render, so it
  // can't disagree with where the grid is (an offset reset by a change of axis, say); this just brings the render.
  const [, setPage] = useState(0);
  // Where the scroll is, in pages, fractional mid-swipe: the dots follow it on the UI thread.
  const pageProgress = useSharedValue(0);
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
  const onScrollY = (e: NativeSyntheticEvent<NativeScrollEvent>) => track({ x: offset.current.x, y: e.nativeEvent.contentOffset.y });
  // A sideways grid never scrolls across: its y stays 0 (the header's space is its frame's padding, not an offset).
  const onScrollX = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    track({ x: e.nativeEvent.contentOffset.x, y: mainHorizontal ? 0 : offset.current.y });
  const shownNow = indicesAt(offset.current);
  shown.current = shownNow;
  // The lifted item follows the finger, so it's drawn even when its slot has scrolled away.
  const indices = shownNow && lifted >= 0 && !shownNow.includes(lifted) ? [...shownNow, lifted].sort((a, b) => a - b) : shownNow;

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
          item={item}
          index={index}
          renderItem={renderItem}
          rect={rect}
          start={lastRects.current.get(key)}
          appear={settled.current && !knownKeys.current.has(key)}
          dragging={info.dragging}
          floating={floating}
          finger={finger}
          cellNodes={cellNodes}
          onGone={gone}
          reduceMotion={reduceMotion}
        />,
      );
    }
    for (const l of leaving) {
      const rect = lastRects.current.get(l.key);
      if (!rect || !intersects(rect, w)) continue;
      cells.push(
        <ReflowCell
          key={l.key}
          id={l.key}
          item={l.item}
          index={-1}
          renderItem={renderItem}
          leaving
          start={rect}
          onGone={gone}
          cellNodes={cellNodes}
          reduceMotion={reduceMotion}
        />,
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
    const first = downs[0];
    if (first) engine.touchDown(first.id, { x: first.x, y: first.y });
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
      engine.touchMove(t.identifier, { x: t.pageX, y: t.pageY });
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
      engine.touchUp(t.identifier);
      const p = pending.current.get(t.identifier);
      pending.current.delete(t.identifier);
      if (!p) continue;
      if (!p.moved) p.region.onPress();
    }
  };
  const onTouchCancel = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      engine.touchCancel(t.identifier);
      pending.current.delete(t.identifier);
    }
  };
  // Web with a mouse sends no touch events, only clicks. A touch screen's tap sends both, so a click right after a touch end is the same press.
  const onClick = (e: { clientX: number; clientY: number }) => {
    if (Date.now() - lastTouchEnd.current < 700) return;
    const left = origin.current?.left ?? 0;
    const top = origin.current?.top ?? 0;
    regionAt(e.clientX, e.clientY, left, top)?.onPress();
  };

  // What the engine reads of the grid: new on every render, so it never works from an old one.
  engine.view = {
    data,
    items,
    keyOf: keyExtractor,
    canDrag,
    enabled: onReorder != null,
    placed,
    viewport,
    axis,
    inset: { x: insetX, y: insetY },
    offset: () => offset.current,
    toContent: (page) => contentPoint(page.x, page.y, origin.current?.left ?? 0, origin.current?.top ?? 0),
    toRoot: (page) => ({ x: page.x - (origin.current?.left ?? 0), y: page.y - (origin.current?.top ?? 0) }),
    scrollTo: (to, animated) => scrollRef.current?.scrollTo({ x: to.x, y: to.y, animated }),
    track,
    setFinger: (point, grab) => {
      if (grab) {
        grabX.set(grab.x);
        grabY.set(grab.y);
      }
      fingerX.set(point.x);
      fingerY.set(point.y);
    },
    instant,
    web: Platform.OS === 'web',
    onReorder,
    onDragStart,
    haptic,
    // The press this finger began is over: it's a drag now.
    onLift: (id) => pending.current.delete(id),
  };
  // On web a mouse drags through the browser's own drag and drop.
  const reorderable = onReorder != null;
  useEffect(() => {
    const el = Platform.OS === 'web' && reorderable ? (root.current as unknown as HTMLElement | null) : null;
    return el ? attachWebDrag(el, engine, (key) => cellNodes.current.get(key)) : undefined;
  }, [reorderable, engine]);

  // A paged layout snaps. Native has `pagingEnabled`. On web it's CSS scroll snap, with a marker at the
  // start of each page: `pagingEnabled` there would replace the style of the content view.
  const pages = placed?.pages;
  const web = Platform.OS === 'web';
  const snapStyle = pages && web && !snap.turning ? ({ scrollSnapType: pages.direction === 'horizontal' ? 'x mandatory' : 'y mandatory' } as ViewStyle) : undefined;
  const markers =
    pages && web
      ? Array.from({ length: pages.count }, (_, page) => (
          <PageMarker key={`page${page}`} at={page * pages.stride} stride={pages.stride} horizontal={pages.direction === 'horizontal'} />
        ))
      : null;

  // Dots for the pages stand in for the scroll indicator along them, in the same place.
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
        // A lifted item follows the finger, which must not scroll the grid as well.
        scrollEnabled={!(drag && floating)}
        // A sideways grid's scroll view is as tall as its row, so its indicator sits under the tiles, not at the room's foot.
        style={[mainHorizontal && placed && roomHeight != null ? { height: Math.min(placed.size.height, roomHeight) } : undefined, snapStyle]}
        pagingEnabled={pages != null && !web}
        // A one-axis grid scrolls only along its axis: no bounce, and no drift across. Two axes lock nothing.
        alwaysBounceVertical={!mainHorizontal}
        directionalLockEnabled={!both}
        // The indicator for the axis it scrolls along, inset as the content is so it sits clear of the header and footer.
        showsHorizontalScrollIndicator={(mainHorizontal || (both && !nested)) && dots?.direction !== 'horizontal'}
        showsVerticalScrollIndicator={!mainHorizontal && dots?.direction !== 'vertical'}
        scrollIndicatorInsets={mainHorizontal ? { left: outerInset.start, right: outerInset.end } : { top: outerInset.start, bottom: outerInset.end }}
      >
        {outerContent}
        {markers}
      </ScrollView>
      {dots && (
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
      )}
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

interface CellProps<T> {
  id: string;
  item: T;
  /** Its place in what's shown; -1 once it's leaving. */
  index: number;
  renderItem: (item: T, info: ItemInfo) => ReactNode;
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
  onGone: (id: string) => void;
  reduceMotion: ReduceMotion;
}

/** An item's visuals. Drawn again only when what it's drawn from changes, not whenever the grid renders. */
function ItemContentImpl<T>({
  item,
  index,
  width,
  height,
  dragging,
  renderItem,
}: {
  item: T;
  index: number;
  width: number;
  height: number;
  dragging: boolean;
  renderItem: (item: T, info: ItemInfo) => ReactNode;
}) {
  return <>{renderItem(item, { index, size: { width, height }, dragging })}</>;
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
  onGone,
  reduceMotion,
}: CellProps<T>) {
  const from = start ?? rect;
  const move = useMemo(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
  const x = useSharedValue(from?.x ?? 0);
  const y = useSharedValue(from?.y ?? 0);
  const w = useSharedValue(from?.width ?? 0);
  const h = useSharedValue(from?.height ?? 0);
  const scale = useSharedValue(appear ? ENTER_SCALE : 1);
  const opacity = useSharedValue(appear ? 0 : 1);
  const dim = useSharedValue(1);
  const lifted = useSharedValue(0);
  const wasLifted = useRef(false);
  const noFinger = useSharedValue(0);
  const fx = finger?.x ?? noFinger;
  const fy = finger?.y ?? noFinger;
  const gx = finger?.gx ?? noFinger;
  const gy = finger?.gy ?? noFinger;
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
    dim.set(withTiming(dragging && !floating ? DRAGGED_OPACITY : 1, { duration: LEAVE_MS, reduceMotion }));
  }, [dragging, floating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lifted: it follows the finger, and grows a little. Dropped: it settles into its slot from where the finger left it.
  useEffect(() => {
    if (dragging && floating) {
      wasLifted.current = true;
      lifted.set(1);
      scale.set(withSpring(LIFT_SCALE, move));
    } else if (wasLifted.current) {
      wasLifted.current = false;
      x.set(fx.get() - gx.get());
      y.set(fy.get() - gy.get());
      lifted.set(0);
      if (rect) {
        x.set(withSpring(rect.x, move));
        y.set(withSpring(rect.y, move));
      }
      scale.set(withSpring(1, move));
    }
  }, [dragging, floating]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => {
    const up = lifted.get() === 1;
    return {
      width: w.get(),
      height: h.get(),
      opacity: opacity.get() * dim.get(),
      zIndex: up ? 100 : 0,
      transform: [
        { translateX: up ? fx.get() - gx.get() : x.get() },
        { translateY: up ? fy.get() - gy.get() : y.get() },
        { scale: scale.get() },
      ],
    };
  });

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
        width={leaving ? 0 : (rect?.width ?? 0)}
        height={leaving ? 0 : (rect?.height ?? 0)}
        dragging={dragging}
        renderItem={renderItem}
      />
    </Animated.View>
  );
}
const ReflowCell = memo(ReflowCellImpl, sameCell as never) as typeof ReflowCellImpl;

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0 },
});
