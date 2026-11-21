import { useRef, type MutableRefObject, type RefObject } from 'react';
import type { GestureResponderEvent, View } from 'react-native';

import type { Point } from './drag';
import { SLOP, type DragEngine, type Offset } from './dragEngine';
import type { SwipeEngine } from './swipeEngine';
import type { Slot, TouchRegion } from './types';

/** A finger that went down on a region and hasn't lifted yet. */
interface Pending {
  /** Absent when the finger went down off every region (or until the grid's place is known). */
  region?: TouchRegion;
  startX: number;
  startY: number;
  /** It moved too far: a scroll, not a press. */
  moved: boolean;
}

/**
 * The grid's touch handling. Each finger, by its id, from the grid's own touch events (which carry
 * every finger, not one responder's): down on a region, then either it lifts still — a press — or it moves,
 * or the touch is cancelled — nothing. The same events go on to the drag engine and the swipe engine, which
 * each decide what a finger is doing. Positions are in the content's space: the viewport's, plus the scroll.
 */
export function useGridTouch<T>(p: {
  drag: DragEngine<T>;
  swipe: SwipeEngine<T>;
  root: RefObject<View | null>;
  /** Where the grid sits on screen, from its last layout or touch: a touch is placed at once, not after an async measure that a quick tap can outrun. */
  origin: MutableRefObject<{ left: number; top: number } | undefined>;
  /** The items on screen, with their touch regions: what a touch is hit against. */
  slots: MutableRefObject<Slot[]>;
  offset: MutableRefObject<Offset>;
  contentOf: (offset: Offset) => Offset;
  mainHorizontal: boolean;
  crossStart: number;
}) {
  const { drag, swipe, root, origin, slots, offset, contentOf, mainHorizontal, crossStart } = p;
  const pending = useRef(new Map<string, Pending>());

  /** A page point in the content's space, for a grid whose top-left sits at `left`, `top`. */
  const contentPoint = (pageX: number, pageY: number, left: number, top: number): Point => {
    const c = contentOf(offset.current);
    // A horizontal grid's content starts below the frame's top padding, which the scroll doesn't count.
    return { x: pageX - left + c.x, y: pageY - top + c.y - (mainHorizontal ? crossStart : 0) };
  };

  /** The region under a point (page coordinates), for a grid whose top-left sits at `left`, `top`. */
  const regionAt = (pageX: number, pageY: number, left: number, top: number) => {
    const { x, y } = contentPoint(pageX, pageY, left, top);
    const slot = slots.current.find((s) => x >= s.rect.x && x < s.rect.x + s.rect.width && y >= s.rect.y && y < s.rect.y + s.rect.height);
    const local = slot && { x: x - slot.rect.x, y: y - slot.rect.y };
    return slot && local
      ? slot.regions.find((r) => local.x >= r.rect.x && local.x < r.rect.x + r.rect.width && local.y >= r.rect.y && local.y < r.rect.y + r.rect.height)
      : undefined;
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    const { changedTouches } = e.nativeEvent;
    // On web this is a `TouchList`, not an array.
    const downs = Array.from(changedTouches, (t) => ({ id: t.identifier, x: t.pageX, y: t.pageY }));
    const first = downs[0];
    if (first) drag.touchDown(first.id, { x: first.x, y: first.y });
    for (const { id, x, y } of downs) pending.current.set(id, { startX: x, startY: y, moved: false });
    // A finger on an item may swipe it away, whatever the others are doing: whether it does is known once it has moved.
    for (const { id, x, y } of downs) swipe.touchDown(id, { x, y }, offset.current);
    // Hit against a place: for each finger still down, the region under where it went down.
    const place = (left: number, top: number) => {
      for (const { id } of downs) {
        const finger = pending.current.get(id);
        if (finger) finger.region = regionAt(finger.startX, finger.startY, left, top);
      }
    };
    // The cached place first, so a quick tap that lifts before the measure returns still presses. The grid can move without a
    // layout (a parent lifted by a transform, say, as a keyboard dock does), so it's measured again on every touch and the hit
    // redone against that; the drag reads the same place.
    if (origin.current) place(origin.current.left, origin.current.top);
    root.current?.measureInWindow((left, top) => {
      origin.current = { left, top };
      place(left, top);
    });
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      drag.touchMove(t.identifier, { x: t.pageX, y: t.pageY });
      swipe.touchMove(t.identifier, { x: t.pageX, y: t.pageY });
      const finger = pending.current.get(t.identifier);
      if (!finger || finger.moved) continue;
      if (Math.hypot(t.pageX - finger.startX, t.pageY - finger.startY) > SLOP) finger.moved = true;
    }
  };

  const lastTouchEnd = useRef(0);
  const onTouchEnd = (e: GestureResponderEvent) => {
    lastTouchEnd.current = Date.now();
    for (const t of e.nativeEvent.changedTouches) {
      drag.touchUp(t.identifier);
      swipe.touchUp(t.identifier);
      const finger = pending.current.get(t.identifier);
      pending.current.delete(t.identifier);
      if (!finger) continue;
      if (!finger.moved) finger.region?.onPress();
    }
  };

  const onTouchCancel = (e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      drag.touchCancel(t.identifier);
      swipe.touchCancel(t.identifier);
      pending.current.delete(t.identifier);
    }
  };

  // Web with a mouse sends no touch events, only clicks. A touch screen's tap sends both, so a click right after a touch end is the same press.
  const onClick = (e: { clientX: number; clientY: number }) => {
    if (Date.now() - lastTouchEnd.current < 700) return;
    regionAt(e.clientX, e.clientY, origin.current?.left ?? 0, origin.current?.top ?? 0)?.onPress();
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onClick,
    contentPoint,
    /** The press a finger began is over: it's a drag now. */
    cancelPress: (id: string) => pending.current.delete(id),
  };
}
