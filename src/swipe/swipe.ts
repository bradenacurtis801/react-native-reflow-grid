import { SLOP } from '../drag/dragEngine';

/** The way a swiped item went: across a vertical grid it's left or right, across a horizontal one up or down. */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** A finger must go this much further across the scroll than along it to be swiping, not scrolling. */
export const SWIPE_BIAS = 1.2;
/** An item let go past this fraction of its size is swiped away. */
export const SWIPE_COMMIT = 0.4;
/** Or one flicked at least this fast (pt/s) the way it has gone, once it has gone `SWIPE_FLICK_MIN` (pt). */
export const SWIPE_FLICK = 600;
export const SWIPE_FLICK_MIN = 24;
/** A swiped item flies off the edge at the speed it was let go at, but at least this fast (pt/s). */
export const SWIPE_EXIT_SPEED = 1400;
/** It takes between these long (ms): the slower it was let go, the nearer the longer; and it fades over the longer, at its end. */
export const SWIPE_EXIT_MIN_MS = 120;
export const SWIPE_EXIT_MS = 280;
/** It goes this far (pt) past the edge, clear of it. */
export const SWIPE_EXIT_MARGIN = 24;
/** It's given this long (ms) to be taken out of `data`; if it isn't, it comes back. */
export const SWIPE_HOLD_MS = 500;

/**
 * What a finger that went down on an item is doing, from how far it has moved
 * across the scroll and along it (pt, from where it went down): not yet anything,
 * a swipe, or a scroll.
 */
export function classifyMove(across: number, along: number): 'wait' | 'swipe' | 'scroll' {
  if (Math.hypot(across, along) <= SLOP) return 'wait';
  return Math.abs(across) > Math.abs(along) * SWIPE_BIAS ? 'swipe' : 'scroll';
}

/**
 * Whether an item let go `offset` (pt) from where it was, moving at `velocity` (pt/s),
 * and `size` (pt) across, is swiped away or springs back.
 */
export function swipeOutcome(offset: number, velocity: number, size: number): 'commit' | 'return' {
  const far = Math.abs(offset) >= size * SWIPE_COMMIT;
  const flicked = Math.abs(velocity) >= SWIPE_FLICK && Math.abs(offset) >= SWIPE_FLICK_MIN && Math.sign(velocity) === Math.sign(offset);
  return far || flicked ? 'commit' : 'return';
}

/** The way an item went, from its offset: `horizontal`, it was swiped along x. */
export function swipeDirection(offset: number, horizontal: boolean): SwipeDirection {
  if (horizontal) return offset < 0 ? 'left' : 'right';
  return offset < 0 ? 'up' : 'down';
}

/** The ways an item may go, along the swipe axis: `negative` is left (or up), `positive` right (or down). */
export interface SwipeAllowed {
  negative: boolean;
  positive: boolean;
}

/**
 * Which ways an item may go, from the `swipeDirections` asked for (`undefined`: either way). `horizontal`: the
 * swipe is along x, so `'left'` and `'right'` count; along y, `'up'` and `'down'`. A direction that isn't along it is ignored.
 */
export function swipeAllowed(directions: readonly SwipeDirection[] | undefined, horizontal: boolean): SwipeAllowed {
  if (!directions) return { negative: true, positive: true };
  return {
    negative: directions.includes(horizontal ? 'left' : 'up'),
    positive: directions.includes(horizontal ? 'right' : 'down'),
  };
}

/** An offset held to the ways an item may go: it can't be pulled a way it may not go, and stays at its slot. */
export function limitOffset(offset: number, allowed: SwipeAllowed): number {
  if (offset < 0 && !allowed.negative) return 0;
  if (offset > 0 && !allowed.positive) return 0;
  return offset;
}

/**
 * Where a swiped item flies to, as an offset from its slot: on the way it went, clear of the edge of
 * the grid. The slot starts `slotStart` (pt) from the start edge, is `size` across, and the grid is `room` across.
 */
export function exitTarget(offset: number, slotStart: number, size: number, room: number): number {
  return offset < 0 ? -(slotStart + size + SWIPE_EXIT_MARGIN) : room - slotStart + SWIPE_EXIT_MARGIN;
}

/** How long (ms) it takes to fly `distance` (pt), let go at `velocity` (pt/s). */
export function exitDuration(distance: number, velocity: number): number {
  const speed = Math.max(Math.abs(velocity), SWIPE_EXIT_SPEED);
  return Math.min(Math.max((Math.abs(distance) / speed) * 1000, SWIPE_EXIT_MIN_MS), SWIPE_EXIT_MS);
}

/** A finger's position and speed (pt/s), smoothed over its moves. */
export interface Velocity {
  pos: number;
  time: number;
  v: number;
}

export const startVelocity = (pos: number, time: number): Velocity => ({ pos, time, v: 0 });

/** The speed after a move to `pos` at `time` (ms): the speed over this move, weighted towards the recent. */
export function moveVelocity(was: Velocity, pos: number, time: number): Velocity {
  const dt = time - was.time;
  if (dt <= 0) return { pos, time: was.time, v: was.v };
  const instant = ((pos - was.pos) / dt) * 1000;
  return { pos, time, v: was.v === 0 ? instant : instant * 0.6 + was.v * 0.4 };
}
