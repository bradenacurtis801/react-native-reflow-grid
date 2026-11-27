import { Profiler, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { resolveHaptics, expoHaptics } from './support/haptics';
import type { Size } from './layout';
import { useLeaving } from './cells/leaving';
import { loadExpoHaptics } from './support/loadExpoHaptics';
import { DROP_SETTLE_MS, MOVE } from './cells/motion';
import { now, perfLog, perfOn } from './support/perfLog';
import { swipeAllowed } from './swipe/swipe';
import type { Finger, ReflowGridProps, Slot } from './types';
import { useCells } from './cells/useCells';
import { useDragReorder } from './drag/useDragReorder';
import { useGridTouch } from './touch/useGridTouch';
import { usePaging } from './scroll/usePaging';
import { useScroll } from './scroll/useScroll';
import { useSwipeToRemove } from './swipe/useSwipeToRemove';
import { attachWebDrag } from './drag/webDrag';
import { DragContext } from './drag/DragProvider';

const noSubscribe = () => () => {};

/** What scrolls: a scroll view whose offsets reach the UI thread first-hand (`useAnimatedScrollHandler`), so a lifted item can be placed by them. */
const Scroller = Animated.ScrollView as unknown as typeof ScrollView;

/**
 * Items laid out by `layout` — a grid, a list, a strip, anything a layout
 * function can describe (`./layout`) — in a scroll view the grid owns, so
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
 *
 * The work is in hooks, each of one concern: `useScroll` (where it's scrolled to, and what that puts on
 * screen), `useCells` (the cells: in the window, leaving, waiting to be reused), `useDragReorder` (see
 * `dragEngine.ts`), `useSwipeToRemove` (see `swipeEngine.ts`), `useGridTouch` (presses, and the touches the
 * engines are fed), and `usePaging` (a paged layout's snap and dots). This is what ties them together.
 */
export function ReflowGrid<T>({
  data,
  keyExtractor,
  renderItem,
  renderPlaceholder,
  settleDelay,
  touchRegions,
  layout,
  axis = 'vertical',
  scrollEnabled = true,
  initialSize,
  startInset: startProp,
  endInset: endProp,
  crossStartInset = 0,
  crossEndInset = 0,
  onMounted,
  onScroll,
  onReorder,
  canDrag,
  dragOverflow = 'hidden',
  joinPolicy,
  onJoin,
  onSpringLoad,
  onDragExit,
  dragExitDelay,
  continuesDrag = false,
  onDragStart,
  canSwipe,
  onSwipe,
  swipeDirections,
  haptics = true,
  pageIndicator = true,
  reduceMotion = ReduceMotion.System,
  style,
}: ReflowGridProps<T>) {
  const renderStart = now();
  const mainHorizontal = axis === 'horizontal';
  // Across the scroll: the way an item is swiped.
  const swipeAxis: 'x' | 'y' = mainHorizontal ? 'y' : 'x';
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
  const insetY = mainHorizontal ? { start: 0, end: 0 } : { start: startProp ?? 0, end: endProp ?? 0 };
  const insetX = mainHorizontal ? { start: startProp ?? 0, end: endProp ?? 0 } : { start: 0, end: 0 };
  // A sideways grid's rows also clear what's pinned over its top and bottom .
  const crossStart = mainHorizontal ? crossStartInset : 0;
  const crossEnd = mainHorizontal ? crossEndInset : 0;
  const [viewport, setViewport] = useState<Size | undefined>(initialSize);
  const rootRef = useRef<View>(null);
  // Where the grid sits on screen, from its last layout or touch: a touch is placed at once, not after an async measure that a quick tap can outrun.
  const origin = useRef<{ left: number; top: number } | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((was) => (was?.width === width && was.height === height ? was : { width, height }));
    // Where it is now, for the touches that follow.
    rootRef.current?.measureInWindow((left, top) => {
      origin.current = { left, top };
    });
  }, []);

  // Dragging (see `dragEngine.ts`): what's shown is `data` in the order of the drag's preview — after a
  // drop, in the order it left, until `data` follows (or a moment passes).
  const { engine, snap, items, draggedKeys, lifted } = useDragReorder<T>(data);
  const { drag, floating } = snap;

  // Items taken out of `data` stay drawn until they've shrunk away (`leaving`, see `leaving.ts`). One that a join has put
  // another item in the place of is just gone.
  const { leaving, leavingNow, taking, setLeaving } = useLeaving(data, keyExtractor, (key) => key === engine.replaced?.from || engine.handedOff.has(key));

  // With `dragOverflow`, nothing is clipped from the lift until the dropped item has had time to settle back inside.
  const held = drag != null && floating;
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (held) {
      setSettling(true);
      return;
    }
    const timer = setTimeout(() => setSettling(false), DROP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [held]);
  const unclipped = dragOverflow === 'visible' && (held || settling);

  // The layout's room: the viewport, less the cross-axis insets (a sideways grid's rows sit between them).
  const roomWidth = viewport?.width;
  const roomHeight = viewport ? (mainHorizontal ? Math.max(viewport.height - crossStart - crossEnd, 0) : viewport.height) : undefined;
  const placed = useMemo(
    () => (roomWidth != null && roomHeight != null ? layout(items, { width: roomWidth, height: roomHeight }) : undefined),
    [layout, items, roomWidth, roomHeight],
  );

  // Where it's scrolled to, and what that puts on screen (see `useScroll.ts`).
  const scroll = useScroll({ axis, ios, android, padded, insetX, insetY, crossStart, viewport, placed, lifted, dragging: drag != null, onScroll });
  const { offset, contentOf, windowOf } = scroll;

  // What carries a drag to another grid, and the swipe a carried item is drawn with: none.
  const carrier = useContext(DragContext);
  const unswiped = useSharedValue(0);
  // The item being carried between grids: the layer above draws it, so no grid shows it meanwhile.
  const carriedKey = useSyncExternalStore(carrier?.subscribe ?? noSubscribe, () => carrier?.getSnapshot()?.key);

  // A finger's drag lifts the item itself, which follows the finger: a cell follows these.
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const { scrollX, scrollY, shiftX, shiftY } = scroll;
  const finger = useMemo<Finger>(
    () => ({ x: fingerX, y: fingerY, gx: grabX, gy: grabY, sx: scrollX, sy: scrollY, ox: shiftX, oy: shiftY }),
    [fingerX, fingerY, grabX, grabY, scrollX, scrollY, shiftX, shiftY],
  );

  // Each mounted cell's element on web, for the image a drag carries.
  const cellNodes = useRef(new Map<string, unknown>());
  // The items on screen, with where they go and their touch regions — what a touch is hit against.
  const slots = useRef<Slot[]>([]);
  // Swiping an item away (`onSwipe`, see `swipeEngine.ts`): the engine reads the grid as it is, from this, on every render.
  const swipe = useSwipeToRemove<T>(
    {
      enabled: onSwipe != null && axis !== 'both',
      horizontal: mainHorizontal,
      crossStart,
      viewport,
      allowed: swipeAllowed(swipeDirections, !mainHorizontal),
      dragging: drag != null,
      // The item under where a finger went down, with the scroll as it was then.
      itemAt: (page, from) => {
        const c = contentOf(from);
        const x = page.x - (origin.current?.left ?? 0) + c.x;
        const y = page.y - (origin.current?.top ?? 0) + c.y - crossStart;
        const slot = slots.current.find((r) => x >= r.rect.x && x < r.rect.x + r.rect.width && y >= r.rect.y && y < r.rect.y + r.rect.height);
        const item = slot ? items[slot.index] : undefined;
        return slot && item !== undefined ? { key: slot.key, index: slot.index, item, rect: slot.rect } : undefined;
      },
      canSwipe,
      onSwipe,
      inData: (key) => data.some((item, i) => keyExtractor(item, i) === key),
    },
    move,
  );

  // The cells on screen: what's in the window, what's leaving, what waits to be reused (see `useCells.tsx`).
  const { cells, leavingCount } = useCells<T>({
    data,
    items,
    layout,
    placed,
    roomWidth,
    roomHeight,
    indices: scroll.indices,
    windowNow: () => windowOf(offset.current),
    keyExtractor,
    renderItem,
    renderPlaceholder,
    settleDelay,
    touchRegions,
    draggedKeys,
    floating,
    finger,
    drags: engine,
    joinKey: drag?.join,
    carriedKey,
    leaving,
    leavingNow,
    taking,
    setLeaving,
    swipe,
    swipeAxis,
    reduceMotion,
    cellNodes,
    slots,
  });

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

  const mountedCount = cells.length;
  // Reported without the cells shrinking away: removing an item changes it once, not as the cell starts to leave and again as it's gone.
  const settledCount = mountedCount - leavingCount;
  useEffect(() => onMounted?.(settledCount), [settledCount]); // eslint-disable-line react-hooks/exhaustive-deps
  // A change in what's mounted, a new layout (a drag's preview reordered), or a slow render, and what the render and commit took (`perfLog`).
  const loggedCount = useRef(0);
  const treeMs = useRef(0);
  const bodyMs = useRef(0);
  const loggedPlaced = useRef(placed);
  useEffect(() => {
    if (!perfOn()) return;
    const took = now() - renderStart;
    const relaid = loggedPlaced.current !== placed;
    if (loggedCount.current !== mountedCount || relaid || took > 8) {
      perfLog(`render ${took.toFixed(1)}ms = grid ${bodyMs.current.toFixed(1)} + tree ${treeMs.current.toFixed(1)} + commit ${(took - bodyMs.current - treeMs.current).toFixed(1)}ms, cells ${loggedCount.current}→${mountedCount}${relaid ? ' re-laid-out' : ''}`);
    }
    loggedCount.current = mountedCount;
    loggedPlaced.current = placed;
  });

  // Presses, and the touches the drag and swipe engines are fed (see `useGridTouch.ts`).
  const touch = useGridTouch<T>({ drag: engine, swipe: swipe.engine, root: rootRef, origin, slots, offset, contentOf, mainHorizontal, crossStart });

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
    toContent: (page) => touch.contentPoint(page.x, page.y, origin.current?.left ?? 0, origin.current?.top ?? 0),
    toRoot: (page) => ({ x: page.x - (origin.current?.left ?? 0), y: page.y - (origin.current?.top ?? 0) }),
    scrollTo: (to, animated) => scrollRef.current?.scrollTo({ x: to.x, y: to.y, animated }),
    track: scroll.track,
    setFinger: (point, grab) => {
      if (grab) {
        grabX.set(grab.x);
        grabY.set(grab.y);
      }
      // The finger in the grid's own frame: the item adds the scroll offset itself, on the UI thread, as it's drawn.
      // A lift starts the UI thread's offset from the one known here (no scroll event has said where it rests).
      if (grab) {
        scrollX.set(offset.current.x);
        scrollY.set(offset.current.y);
      }
      const c = contentOf(offset.current);
      fingerX.set(point.x - c.x);
      fingerY.set(point.y - c.y + crossStart);
    },
    instant,
    web: Platform.OS === 'web',
    onReorder,
    joinOf: joinPolicy ? (item, index, slot) => joinPolicy(item, { index, size: { width: slot.width, height: slot.height }, dragging: false, joinTarget: false }) : undefined,
    onJoin,
    onSpringLoad,
    onDragExit,
    exitDelay: dragExitDelay,
    carrier,
    renderCarried: (item, index, size) => () => renderItem(item, { index, size, dragging: true, joinTarget: false, swipe: unswiped }),
    onDragStart,
    haptic,
    // The press this finger began is over: it's a drag now.
    onLift: touch.cancelPress,
  };
  // A drag carried from another grid is this one's to take, if it's asked to and has the item (see `DragCarrier`).
  useEffect(() => {
    if (!continuesDrag || !carrier?.getSnapshot() || !placed) return;
    // Measured now: it may have grown into place since it was laid out.
    rootRef.current?.measureInWindow((left, top) => {
      origin.current = { left, top };
      carrier.offer(engine, continuesDrag === 'join');
    });
  }, [continuesDrag, carrier, engine, placed, data]);

  // On web a mouse drags through the browser's own drag and drop.
  const reorderable = onReorder != null;
  useEffect(() => {
    const el = Platform.OS === 'web' && reorderable ? (rootRef.current as unknown as HTMLElement | null) : null;
    return el ? attachWebDrag(el, engine, (key) => cellNodes.current.get(key)) : undefined;
  }, [reorderable, engine]);

  // A paged layout snaps, and shows dots (see `usePaging.tsx`).
  const paging = usePaging<T>({
    placed,
    pageIndicator,
    turning: snap.turning,
    axis,
    offset,
    scrollRef,
    track: scroll.track,
    pageProgress: scroll.pageProgress,
    engine,
    crossEnd,
    viewport,
  });

  const { both, nested } = scroll;
  const outerInset = mainHorizontal ? insetX : insetY;
  const outerContent = nested ? (
    <Animated.ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={scroll.onScrollInnerUI as never}
      style={innerStyle}
    >
      <Animated.View style={contentStyle}>{cells}</Animated.View>
    </Animated.ScrollView>
  ) : (
    <Animated.View style={contentStyle}>{cells}</Animated.View>
  );

  const rootView = (
    <View
      ref={rootRef}
      // A sideways grid's frame stops short of the header and the footer, so its scroll view has no room to move across.
      style={[style, { paddingTop: crossStart, paddingBottom: crossEnd }]}
      onLayout={onLayout}
      onTouchStart={touch.onTouchStart}
      onTouchMove={touch.onTouchMove}
      onTouchEnd={touch.onTouchEnd}
      onTouchCancel={touch.onTouchCancel}
      {...(Platform.OS === 'web' ? ({ onClick: touch.onClick } as object) : null)}
    >
      <Scroller
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
        onScroll={scroll.onScrollUI as never}
        scrollEventThrottle={16}
        // A lifted item follows the finger, which must not scroll the grid as well.
        scrollEnabled={scrollEnabled && !(drag && floating) && !snap.carrying && swipe.swiping === 0}
        // A sideways grid's scroll view is as tall as its row, so its indicator sits under the tiles, not at the room's foot.
        style={[mainHorizontal && placed && roomHeight != null ? { height: Math.min(placed.size.height, roomHeight) } : undefined, paging.snapStyle, unclipped && styles.unclipped]}
        pagingEnabled={paging.pages != null && !paging.web}
        // A one-axis grid scrolls only along its axis: no bounce, and no drift across. Two axes lock nothing.
        alwaysBounceVertical={!mainHorizontal}
        directionalLockEnabled={!both}
        // The indicator for the axis it scrolls along, inset as the content is so it sits clear of the header and footer.
        showsHorizontalScrollIndicator={(mainHorizontal || (both && !nested)) && paging.dots?.direction !== 'horizontal'}
        showsVerticalScrollIndicator={!mainHorizontal && paging.dots?.direction !== 'vertical'}
        scrollIndicatorInsets={mainHorizontal ? { left: outerInset.start, right: outerInset.end } : { top: outerInset.start, bottom: outerInset.end }}
      >
        {outerContent}
        {paging.markers}
      </Scroller>
      {paging.dotsElement}
    </View>
  );
  bodyMs.current = now() - renderStart;
  // With logging on, the time React spent rendering the tree (the rest of a render's time is the commit), for `perfLog`.
  return perfOn() ? (
    <Profiler id="reflow" onRender={(_id, _phase, actual) => (treeMs.current = actual)}>
      {rootView}
    </Profiler>
  ) : (
    rootView
  );
}

const styles = StyleSheet.create({
  unclipped: { overflow: 'visible' },
});
