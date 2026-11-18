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
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import { intersects, type Rect, type ReflowLayout, type Region, type Size } from './layout';

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

interface Leaving<T> {
  key: string;
  item: T;
}

interface ItemInfo {
  index: number;
  size: Size;
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
   * Whether the animations follow the device's reduce-motion setting (they
   * jump to their end when it's on). `ReduceMotion.Never` always animates.
   * @default ReduceMotion.System
   */
  reduceMotion?: ReduceMotion;
  style?: StyleProp<ViewStyle>;
}) {
  const mainHorizontal = axis === 'horizontal';
  const move = useMemo(() => ({ ...MOVE, reduceMotion }), [reduceMotion]);
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

  // The layout's room: the viewport, less the cross-axis insets (a sideways grid's rows sit between them).
  const roomWidth = viewport?.width;
  const roomHeight = viewport ? (mainHorizontal ? Math.max(viewport.height - crossStart - crossEnd, 0) : viewport.height) : undefined;
  const placed = useMemo(
    () => (roomWidth != null && roomHeight != null ? layout(data, { width: roomWidth, height: roomHeight }) : undefined),
    [layout, data, roomWidth, roomHeight],
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
    if (placed && indices) for (const index of indices) next.set(keyExtractor(data[index]!, index), placed.rectOf(index));
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
      const item = data[index]!;
      const key = keyExtractor(item, index);
      const rect = placed.rectOf(index);
      const info: ItemInfo = { index, size: { width: rect.width, height: rect.height } };
      slotList.push({ key, rect, regions: touchRegions?.(item, info) ?? [] });
      cells.push(
        <ReflowCell
          key={key}
          id={key}
          rect={rect}
          start={lastRects.current.get(key)}
          appear={settled.current && !knownKeys.current.has(key)}
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
        <ReflowCell key={l.key} id={l.key} leaving start={rect} onGone={gone} reduceMotion={reduceMotion}>
          {renderItem(l.item, { index: -1, size: { width: 0, height: 0 } })}
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
  const regionAt = (pageX: number, pageY: number, left: number, top: number) => {
    const c = contentOf(offset.current);
    const x = pageX - left + c.x;
    // A horizontal grid's content starts below the frame's top padding, which the scroll doesn't count.
    const y = pageY - top + c.y - (mainHorizontal ? crossStart : 0);
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
        style={mainHorizontal && placed && roomHeight != null ? { height: Math.min(placed.size.height, roomHeight) } : undefined}
        // A one-axis grid scrolls only along its axis: no bounce, and no drift across. Two axes lock nothing.
        alwaysBounceVertical={!mainHorizontal}
        directionalLockEnabled={!both}
        // The indicator for the axis it scrolls along, inset as the content is so it sits clear of the header and footer.
        showsHorizontalScrollIndicator={mainHorizontal || (both && !nested)}
        showsVerticalScrollIndicator={!mainHorizontal}
        scrollIndicatorInsets={mainHorizontal ? { left: outerInset.start, right: outerInset.end } : { top: outerInset.start, bottom: outerInset.end }}
      >
        {outerContent}
      </ScrollView>
    </View>
  );
}

/** One item's visuals: placed by animated values, so every move starts from where it is. */
function ReflowCell({
  id,
  rect,
  start,
  leaving = false,
  appear = false,
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

  const style = useAnimatedStyle(() => ({
    width: w.get(),
    height: h.get(),
    opacity: opacity.get(),
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <Animated.View style={[styles.cell, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cell: { position: 'absolute', left: 0, top: 0 },
});
