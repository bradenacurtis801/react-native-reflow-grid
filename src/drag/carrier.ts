import type { Point } from './drag';
import type { Size } from '../layout';

/** An item in the air between grids: its grid has let go of it and another hasn't dropped it yet. */
export interface Carried {
  key: string;
  /** The item itself, for a grid that doesn't have it to know what it is. */
  item: unknown;
  /** The size it was lifted at, and where on it the finger holds it. */
  size: Size;
  grab: Point;
  /** What's drawn of it: its own grid's `renderItem`, called by the layer. */
  render(): unknown;
}

/** A grid that can take over a carried item. */
export interface CarryTarget {
  /** Takes the item if it can: it's in its data, and it can be dragged there. */
  adopt(key: string, page: Point, grab: Point, size: Size): boolean;
  /** Takes the finger over for an item it doesn't have, only to join it to one of its own. */
  visit(key: string, item: unknown, page: Point, size: Size): boolean;
  carryMove(page: Point): void;
  carryEnd(cancelled: boolean): void;
}

/**
 * A drag that has left the grid it began in, between the grids of one provider. The finger's touch stays with the view it
 * began in, so that grid passes each move on to here; the item is drawn above everything (see `ReflowDragProvider`), and a
 * grid that takes it over (`offer`) is told where the finger is, and of the drop.
 */
export class DragCarrier {
  private item?: Carried;
  private target?: CarryTarget;
  private listeners = new Set<() => void>();
  /** Where the finger is (page coordinates). */
  private at: Point = { x: 0, y: 0 };
  /** Told of each place the finger gets to, for what's drawn to follow. */
  onMove?: (at: Point) => void;
  /** Told when a carried drag ends, after the drop. */
  onEnd?: () => void;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The item being carried, if one is. */
  getSnapshot = (): Carried | undefined => this.item;

  start(item: Carried, at: Point) {
    this.item = item;
    this.target = undefined;
    this.move(at);
    this.notify();
  }

  /** A grid that would take the item: the first that can has it until it lets go. `join`: it may take it only to join. */
  offer(target: CarryTarget, join = false) {
    const item = this.item;
    if (!item || this.target) return;
    if (target.adopt(item.key, this.at, item.grab, item.size) || (join && target.visit(item.key, item.item, this.at, item.size))) this.target = target;
  }

  /** Whether the grid has the carried item. */
  holds(target: CarryTarget): boolean {
    return this.target === target;
  }

  /** The grid that had the item has let it go: it's in the air, for another to take. */
  release() {
    this.target = undefined;
  }

  move(at: Point) {
    this.at = at;
    this.onMove?.(at);
    this.target?.carryMove(at);
  }

  /** The finger has lifted (or the touch was cancelled): the grid that has the item drops it. */
  end(cancelled: boolean) {
    if (!this.item) return;
    const target = this.target;
    this.item = undefined;
    this.target = undefined;
    target?.carryEnd(cancelled);
    this.notify();
    this.onEnd?.();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
