import type { Point } from '../drag/drag';
import type { Offset } from '../drag/dragEngine';
import type { Rect, Size } from '../layout';
import {
  classifyMove,
  exitDuration,
  exitTarget,
  limitOffset,
  moveVelocity,
  startVelocity,
  swipeDirection,
  swipeOutcome,
  SWIPE_HOLD_MS,
  type SwipeAllowed,
  type SwipeDirection,
  type Velocity,
} from './swipe';

/** The item under a finger where it went down, and where its slot is (the grid's content space). */
export interface SwipeTarget<T> {
  key: string;
  index: number;
  item: T;
  rect: Rect;
}

/**
 * The grid as it is right now. The grid hands a new one over on every render, so the engine never works
 * from what was true a render ago (a swipe that ends half a second later sees the data as it is then).
 */
export interface SwipeView<T> {
  /** Swipe to remove is on: `onSwipe` is given, and the grid scrolls along one axis. */
  enabled: boolean;
  /** The grid scrolls sideways, so a swipe goes up or down. */
  horizontal: boolean;
  /** How far a sideways grid's rows sit in from the top of the grid: where a slot starts in the grid's own frame. */
  crossStart: number;
  /** The grid's size, for how far an item has to fly to clear its edge. */
  viewport?: Size;
  /** The ways an item may go. */
  allowed: SwipeAllowed;
  /** A finger has lifted an item: a drag, not a swipe. */
  dragging: boolean;
  /** The item under a point where a finger went down, with the scroll as it was then. */
  itemAt(page: Point, offset: Offset): SwipeTarget<T> | undefined;
  canSwipe?(item: T, index: number): boolean;
  /** An item has been swiped away. `false`: keep it. */
  onSwipe?(item: T, direction: SwipeDirection): boolean | void;
  /** Whether an item is still in `data`. */
  inData(key: string): boolean;
}

/** What the engine does to the screen, which isn't its own: time, and the cells' swipe offsets. */
export interface SwipeHost {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  /** Whether the item has a cell to move. */
  hasCell(key: string): boolean;
  /** Takes the item's cell to `offset`, from its slot, along the swipe. */
  setOffset(key: string, offset: number): void;
  /** Flies the item's cell to `to`. */
  flyOff(key: string, to: number, durationMs: number): void;
  /** Brings the item's cell back to its slot. */
  springBack(key: string): void;
  /** One more finger is swiping an item (`1`), or one less (`-1`): the scroll view mustn't take any over. */
  swipingChanged(by: 1 | -1): void;
  log(message: string): void;
}

/** A finger that went down on the grid, swiping an item away or on its way to it. */
interface Gesture {
  id: string;
  start: Point;
  /** The scroll offset where it went down: the item under it is the one there. */
  startOffset: Offset;
  /** It has gone across the scroll, on an item that can be swiped: the item follows it. */
  active: boolean;
  key?: string;
  item?: unknown;
  /** The item's size across the scroll's way, for how far is far enough. */
  size: number;
  /** Where its slot starts across the scroll's way, in the grid's frame: how far it has to go to clear the edge. */
  slotStart: number;
  /** How far the item is from its slot. */
  offset: number;
  speed: Velocity;
}

/**
 * Swiping items away with a finger. Each finger, by its id, is a gesture of its own, so any number can swipe
 * at once; an item goes with one finger. A finger that goes down on the grid may swipe an item, scroll, or lift
 * it to drag: which it is is known once it has moved (`classifyMove`). The item follows the finger; let go far enough
 * or fast enough and `onSwipe` is told, and the item flies off the way it went, or, if it's kept, comes back.
 */
export class SwipeEngine<T> {
  /** Set by the grid on every render. */
  view!: SwipeView<T>;
  /** The items just swiped away, and the way they went: the cell that leaves for one carries on that way, and doesn't shrink. */
  readonly swiped = new Map<string, SwipeDirection>();
  private readonly gestures = new Map<string, Gesture>();

  constructor(private readonly host: SwipeHost) {}

  touchDown(id: string, page: Point, offset: Offset) {
    if (!this.view.enabled || this.gestures.has(id)) return;
    this.gestures.set(id, {
      id,
      start: { x: page.x, y: page.y },
      startOffset: { ...offset },
      active: false,
      size: 0,
      slotStart: 0,
      offset: 0,
      speed: startVelocity(0, this.host.now()),
    });
  }

  touchMove(id: string, page: Point) {
    const s = this.gestures.get(id);
    if (!s) return;
    const { view, host } = this;
    const dx = page.x - s.start.x;
    const dy = page.y - s.start.y;
    const across = view.horizontal ? dy : dx;
    const along = view.horizontal ? dx : dy;
    if (!s.active && !this.begin(s, across, along)) return;
    // A finger turned back the way an item may not go leaves it at its slot.
    const held = limitOffset(across, view.allowed);
    s.offset = held;
    s.speed = moveVelocity(s.speed, held, host.now());
    host.setOffset(s.key!, held);
  }

  touchUp(id: string) {
    this.end(id, false);
  }

  touchCancel(id: string) {
    this.end(id, true);
  }

  /** Whether the finger has become a swipe. If it's something else (or never will be), it's no longer followed. */
  private begin(s: Gesture, across: number, along: number): boolean {
    const { view, host } = this;
    // Held still, it's lifted: a drag. Along the scroll, it's a scroll.
    if (view.dragging) return this.drop(s);
    const verdict = classifyMove(across, along);
    if (verdict === 'wait') return false;
    if (verdict === 'scroll') return this.drop(s);
    // Across it, but the way it went isn't one an item may go: not a swipe.
    if (limitOffset(across, view.allowed) === 0) return this.drop(s);
    // On an item that can be swiped: from where the finger went down.
    const target = view.itemAt(s.start, s.startOffset);
    if (!target || (view.canSwipe && !view.canSwipe(target.item, target.index))) return this.drop(s);
    // Another finger is already swiping that item: an item goes with one finger.
    for (const other of this.gestures.values()) {
      if (other.active && other.key === target.key) return this.drop(s);
    }
    s.active = true;
    s.key = target.key;
    s.item = target.item;
    s.size = view.horizontal ? target.rect.height : target.rect.width;
    s.slotStart = view.horizontal ? target.rect.y + view.crossStart : target.rect.x;
    host.log(`swipe begins on ${target.key}`);
    host.swipingChanged(1);
    return true;
  }

  private drop(s: Gesture): false {
    this.gestures.delete(s.id);
    return false;
  }

  private end(id: string, cancelled: boolean) {
    const s = this.gestures.get(id);
    if (!s) return;
    this.gestures.delete(id);
    const key = s.key;
    if (!s.active || key === undefined) return;
    const { host } = this;
    host.swipingChanged(-1);
    const outcome = swipeOutcome(s.offset, s.speed.v, s.size);
    const hasCell = host.hasCell(key);
    host.log(
      `swipe ends: offset=${s.offset.toFixed(0)} speed=${s.speed.v.toFixed(0)} size=${s.size.toFixed(0)} ${cancelled ? 'cancelled' : outcome}${hasCell ? '' : ' (no cell registered)'}`,
    );
    if (!hasCell) return;
    if (!cancelled && outcome === 'commit') {
      const direction = swipeDirection(s.offset, !this.view.horizontal);
      // Marked first: the cell that leaves for it is drawn in the render `onSwipe` brings.
      this.swiped.set(key, direction);
      if (this.view.onSwipe?.(s.item as T, direction) !== false) {
        // It flies off the edge it was going to, as fast as it was let go.
        const { viewport, horizontal } = this.view;
        const room = (horizontal ? viewport?.height : viewport?.width) ?? s.slotStart + s.size * 2;
        const target = exitTarget(s.offset, s.slotStart, s.size, room);
        host.flyOff(key, target, exitDuration(target - s.offset, s.speed.v));
        // Not taken out of `data` after a moment: it comes back.
        host.setTimeout(() => {
          this.swiped.delete(key);
          if (this.view.inData(key)) host.springBack(key);
        }, SWIPE_HOLD_MS);
        return;
      }
      this.swiped.delete(key);
    }
    host.springBack(key);
  }
}
