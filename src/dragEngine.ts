import { beginDrag, edgeVelocity, endDrag, slotAt, updateDrag, type DragResult, type DragSession, type DragState, type Point } from './drag';
import type { ReflowResult, Size } from './layout';

/** A scroll position, in the scroll view's terms (what `contentOffset` reports). */
export interface Offset {
  x: number;
  y: number;
}

export interface Edge {
  start: number;
  end: number;
}

/** A finger that moves further than this (pt) from where it went down is scrolling, not pressing or holding. */
export const SLOP = 10;
/** A finger held still this long (ms) on an item lifts it: from then on it's a drag, not a scroll or a press. */
export const LONG_PRESS_MS = 350;
/** Held at an edge this long (ms), a drag in a paged layout turns the page; held on, it turns another. */
export const PAGE_DWELL_MS = 700;
/** A page turn on web takes this long (ms). */
export const PAGE_TURN_MS = 320;
/** A drag scrolls at this fraction of its speed when it reaches an edge, and builds up to all of it over `RAMP_MS`. */
export const RAMP_FROM = 0.3;
export const RAMP_MS = 1000;
/** A mouse drag that has sent nothing for this long (ms) has left the window: it stops scrolling. */
export const QUIET_MS = 500;
/** After a drop, the new order is held this long (ms) for `data` to follow. */
export const HOLD_MS = 600;

/** What the engine needs of its surroundings that isn't the grid's: time, frames and timers. */
export interface DragHost {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * The grid as it is right now. The grid hands a new one over on every render, so
 * the engine never works from what was true a render ago; whatever can change
 * between renders without one (the scroll offset) is a function.
 */
export interface DragView<T> {
  /** The grid's `data`: what the order held after a drop is held for. */
  data: readonly T[];
  /** What's on show: `data` in the order of a drag's preview. */
  items: readonly T[];
  keyOf(item: T, index: number): string;
  canDrag?(item: T, index: number): boolean;
  /** Drag to reorder is on. */
  enabled: boolean;
  /** The layout of `items`, once the grid has its size. */
  placed?: ReflowResult;
  viewport?: Size;
  axis: 'vertical' | 'horizontal' | 'both';
  /** Space the scrolled content must start and end clear of, along each axis. */
  inset: { x: Edge; y: Edge };
  /** Where the scroll view is now. */
  offset(): Offset;
  /** A page point in the content's space (scroll and insets taken into account). */
  toContent(page: Point): Point;
  /** A page point in the grid's own space: from its top-left, scroll not counted. */
  toRoot(page: Point): Point;
  scrollTo(to: Offset, animated: boolean): void;
  /** The engine has scrolled: the grid takes the new offset (and mounts what's now on screen). */
  track(to: Offset): void;
  /** Where a lifted item follows the finger to: the finger, in content space, and (on lifting) where it holds the item. */
  setFinger(point: Point, grab?: Point): void;
  /** The device asks for no motion. */
  instant: boolean;
  /** The scroll position of a page turn is worked out here, a frame at a time (the browser's own smooth scroll is switched off by a reduce-motion setting). */
  web: boolean;
  onReorder?(result: DragResult): void;
  onDragStart?(keys: readonly string[]): void;
  /** The finger with this id has lifted an item: the press it began is over. */
  onLift?(id: string): void;
}

/** What the grid draws from: a drag in progress, and what goes with it. */
export interface DragSnapshot {
  drag?: DragState;
  /** A finger's drag lifts the item itself, which follows the finger; a mouse's has the browser's own image, and the item's slot dims instead. */
  floating: boolean;
  /** After a drop: the new order, shown until `data` follows. */
  held?: { keys: readonly string[]; data: readonly unknown[] };
  /** A page turn is under way: scroll snap must stay off. */
  turning: boolean;
}

interface ScrollState {
  raf?: number;
  time: number;
  pos: Offset;
  /** When the pointer reached the edge it's at. */
  held?: number;
  dwell?: { dir: number; since: number };
  turn?: { from: number; to: number; start: number; horizontal: boolean };
}

interface Press {
  id: string;
  x: number;
  y: number;
  active: boolean;
  timer?: unknown;
}

/**
 * Drag to reorder, apart from how a drag is begun: a finger held on an item
 * (`touch…`) or a browser's drag and drop (`os…`). It follows the pointer,
 * works out where the item would land, scrolls or turns pages at an edge, and
 * on a drop reports the new order. It knows nothing of React or of how the grid
 * draws: it reads the grid through `view`, and the grid reads `getSnapshot`.
 */
export class DragEngine<T> {
  /** Set by the grid on every render. */
  view!: DragView<T>;

  private snap: DragSnapshot = { floating: false, turning: false };
  private listeners = new Set<() => void>();
  /** The layout the drag began with: what the pointer is hit against. */
  private base?: ReflowResult;
  private byKey = new Map<string, T>();
  private pointer?: { x: number; y: number; at: number; touch: boolean };
  private scroll: ScrollState = { time: 0, pos: { x: 0, y: 0 } };
  private press?: Press;
  private holdTimer?: unknown;

  constructor(private host: DragHost) {}

  // The store the grid subscribes to.

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DragSnapshot => this.snap;

  private set(patch: Partial<DragSnapshot>) {
    const next = { ...this.snap, ...patch };
    if ((Object.keys(next) as (keyof DragSnapshot)[]).every((k) => next[k] === this.snap[k])) return;
    this.snap = next;
    for (const listener of this.listeners) listener();
  }

  /** Whether a drag is under way. */
  get dragging(): boolean {
    return this.snap.drag !== undefined;
  }

  /** The order of the keys to show: a drag's preview, or the order a drop left until `data` follows. */
  order(data: readonly T[]): readonly string[] | undefined {
    const { drag, held } = this.snap;
    return drag?.preview ?? (held && held.data === data ? held.keys : undefined);
  }

  /** `data` in that order. */
  itemsFor(data: readonly T[], order: readonly string[] | undefined): readonly T[] {
    return order ? order.map((k) => this.byKey.get(k) as T) : data;
  }

  dispose() {
    this.stopScroll();
    this.host.clearTimeout(this.holdTimer);
    if (this.press) this.host.clearTimeout(this.press.timer);
    this.press = undefined;
  }

  // A finger: held on an item, it lifts it.

  touchDown(id: string, page: Point) {
    if (!this.view.enabled || this.snap.drag || this.press) return;
    const press: Press = { id, x: page.x, y: page.y, active: false };
    press.timer = this.host.setTimeout(() => this.lift(), LONG_PRESS_MS);
    this.press = press;
  }

  touchMove(id: string, page: Point) {
    const press = this.press;
    if (!press || press.id !== id) return;
    if (press.active) {
      this.follow(page, true);
    } else if (Math.hypot(page.x - press.x, page.y - press.y) > SLOP) {
      // It moved before the hold was up: a scroll.
      this.host.clearTimeout(press.timer);
      this.press = undefined;
    }
  }

  touchUp(id: string) {
    this.endTouch(id, false);
  }

  touchCancel(id: string) {
    this.endTouch(id, true);
  }

  private endTouch(id: string, cancelled: boolean) {
    const press = this.press;
    if (!press || press.id !== id) return;
    this.host.clearTimeout(press.timer);
    this.press = undefined;
    if (press.active) this.finish(cancelled);
  }

  /** The finger has been held still on an item: it's lifted. */
  private lift() {
    const press = this.press;
    if (!press || press.active || this.snap.drag) return;
    const point = this.view.toContent(press);
    const index = this.itemAt(point);
    const state = index !== undefined ? this.begin(index, point, 'touch') : undefined;
    if (!state) {
      this.press = undefined;
      return;
    }
    press.active = true;
    this.view.onLift?.(press.id);
    this.view.onDragStart?.(state.dragged);
  }

  // A browser's drag and drop (see `webDrag.ts`).

  /** A drag began at a page point: what it lifts (the key, and where it holds it), or nothing. */
  osStart(page: Point): { key: string; grab: Point } | undefined {
    // A finger's drag has it already.
    if (this.press) return undefined;
    const point = this.view.toContent(page);
    const index = this.itemAt(point);
    const state = index !== undefined ? this.begin(index, point, 'os') : undefined;
    const placed = this.view.placed;
    if (!state || !placed || index === undefined) return undefined;
    const rect = placed.rectOf(index);
    return { key: state.dragged[0]!, grab: { x: point.x - rect.x, y: point.y - rect.y } };
  }

  /** The drag is over the grid. Whether it's one that began here (and so can land). */
  osMove(page: Point): boolean {
    if (!this.snap.drag || !this.base) return false;
    this.follow(page, false);
    return true;
  }

  /** Whether the drop was of a drag that began here. */
  osDrop(): boolean {
    if (!this.snap.drag) return false;
    this.finish(false);
    return true;
  }

  /** The drag is over, wherever it ended: nothing left to do after a drop, and a cancel after one that missed the grid. */
  osEnd() {
    this.finish(true);
  }

  // The drag itself.

  /** The item under a point, if it's over one that can be dragged. */
  private itemAt(point: Point): number | undefined {
    const { placed, items, canDrag } = this.view;
    const index = placed ? slotAt(placed, items.length, point) : undefined;
    const rect = index !== undefined ? placed?.rectOf(index) : undefined;
    const over = rect && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
    return index !== undefined && over && !(canDrag && !canDrag(items[index]!, index)) ? index : undefined;
  }

  /** Begins a drag of the item at `index`, the pointer being at `point` (content coordinates). */
  private begin(index: number, point: Point, kind: 'touch' | 'os'): DragState | undefined {
    const { placed, items, keyOf } = this.view;
    if (!placed) return undefined;
    const keys = items.map(keyOf);
    const key = keys[index]!;
    const session: DragSession = { origin: 'internal', items: [{ key, types: ['text/plain'], local: items[index] }] };
    const state = beginDrag(keys, session);
    if (!state) return undefined;
    this.byKey = new Map(items.map((item, i) => [keys[i]!, item]));
    this.base = placed;
    const rect = placed.rectOf(index);
    this.view.setFinger(point, { x: point.x - rect.x, y: point.y - rect.y });
    this.set({ drag: state, floating: kind === 'touch' });
    return state;
  }

  /** The pointer (page coordinates) has moved: the item follows it, the target is worked out, and an edge starts the scroll. */
  private follow(page: Point, touch: boolean) {
    const state = this.snap.drag;
    if (!state || !this.base) return;
    const p = { x: page.x, y: page.y, at: this.host.now(), touch };
    this.pointer = p;
    this.retarget(state, this.base, p);
    const scroll = this.scroll;
    if (scroll.raf === undefined) {
      const speed = this.scrollSpeed(p);
      if (speed.x !== 0 || speed.y !== 0) {
        scroll.pos = { ...this.view.offset() };
        scroll.time = p.at;
        scroll.held = p.at;
        this.schedule();
      }
    }
  }

  /** Works the target out again for the pointer (page coordinates), after it or the content has moved. */
  private retarget(state: DragState, base: ReflowResult, p: Point) {
    const point = this.view.toContent(p);
    // The content may have scrolled under a still finger.
    this.view.setFinger(point);
    const next = updateDrag(state, base, point);
    if (next !== state) this.set({ drag: next });
  }

  private finish(cancelled: boolean) {
    this.stopScroll();
    const turn = this.scroll.turn;
    if (turn) {
      // A turn still under way lands at once.
      const to = this.turnPosition(turn, turn.to);
      this.view.scrollTo(to, false);
      this.view.track(to);
      this.scroll.turn = undefined;
      this.set({ turning: false });
    }
    this.scroll.dwell = undefined;
    this.scroll.held = undefined;
    const press = this.press;
    if (press) {
      this.host.clearTimeout(press.timer);
      this.press = undefined;
    }
    const state = this.snap.drag;
    if (!state) return;
    const result = endDrag(state, cancelled);
    if (result) {
      this.set({ drag: undefined, floating: false, held: { keys: result.keys, data: this.view.data } });
      this.host.clearTimeout(this.holdTimer);
      this.holdTimer = this.host.setTimeout(() => this.set({ held: undefined }), HOLD_MS);
      this.view.onReorder?.(result);
    } else {
      this.set({ drag: undefined, floating: false });
    }
  }

  // Scrolling at an edge. While the pointer is near an edge of what's on screen
  // the content scrolls that way (or, in a paged layout, turns the page after a
  // moment), and the target is worked out again as it moves under the pointer.
  // A pointer that is still sends no events, so a frame loop does the work.

  private schedule() {
    this.scroll.raf = this.host.requestFrame((t) => this.frame(t));
  }

  private stopScroll() {
    if (this.scroll.raf !== undefined) this.host.cancelFrame(this.scroll.raf);
    this.scroll.raf = undefined;
  }

  /** How fast, along each axis, the pointer (page coordinates) is asking the content to scroll. */
  private scrollSpeed(p: Point): Point {
    const { viewport, axis, inset } = this.view;
    if (!viewport) return { x: 0, y: 0 };
    const at = this.view.toRoot(p);
    return {
      x: axis === 'vertical' ? 0 : edgeVelocity(at.x, inset.x.start, viewport.width - inset.x.end),
      y: axis === 'horizontal' ? 0 : edgeVelocity(at.y, inset.y.start, viewport.height - inset.y.end),
    };
  }

  private turnPosition(turn: { horizontal: boolean }, along: number): Offset {
    const now = this.view.offset();
    return turn.horizontal ? { x: along, y: now.y } : { x: now.x, y: along };
  }

  private frame(time: number) {
    const scroll = this.scroll;
    scroll.raf = undefined;
    const turn = scroll.turn;
    if (turn) {
      const t = Math.min(Math.max((time - turn.start) / PAGE_TURN_MS, 0), 1);
      const to = this.turnPosition(turn, turn.from + (turn.to - turn.from) * (1 - (1 - t) ** 3));
      this.view.scrollTo(to, false);
      this.view.track(to);
      if (t >= 1) {
        scroll.turn = undefined;
        // Held on, it takes another dwell to turn the next.
        scroll.dwell = undefined;
        this.set({ turning: false });
      }
    }
    const { placed, viewport, inset, instant, web } = this.view;
    const state = this.snap.drag;
    const base = this.base;
    const p = this.pointer;
    // Over, or the pointer has gone quiet (out of the window): nothing more to do, but finish a turn.
    if (!state || !base || !p || !viewport || !placed || (!p.touch && time - p.at > QUIET_MS)) {
      if (scroll.turn) this.schedule();
      return;
    }
    const speed = this.scrollSpeed(p);
    if (speed.x === 0 && speed.y === 0) {
      scroll.dwell = undefined;
      if (scroll.turn) this.schedule();
      return;
    }
    // A paged layout doesn't scroll steadily: held at an edge it turns the page, and turns another if still held.
    const pages = placed.pages;
    if (pages) {
      const horizontal = pages.direction === 'horizontal';
      const dir = Math.sign(horizontal ? speed.x : speed.y);
      if (scroll.dwell?.dir !== dir) {
        scroll.dwell = { dir, since: time };
      } else if (time - scroll.dwell.since >= PAGE_DWELL_MS && !scroll.turn) {
        const now = this.view.offset();
        const from = horizontal ? now.x : now.y;
        const to = Math.min(Math.max(Math.round(from / pages.stride) + dir, 0), pages.count - 1) * pages.stride;
        scroll.dwell = { dir, since: time };
        if (to !== from) {
          if (web && !instant) {
            scroll.turn = { from, to, start: time, horizontal };
            this.set({ turning: true });
          } else {
            // Native animates its own (unless asked not to); web, asked not to, jumps.
            this.view.scrollTo(this.turnPosition({ horizontal }, to), !web && !instant);
          }
        }
      }
      // The pages slide under the pointer, so its target follows.
      this.retarget(state, base, p);
      this.schedule();
      return;
    }
    // The longer it's held at the edge, the faster it goes.
    const ramp = RAMP_FROM + (1 - RAMP_FROM) * Math.min(Math.max(time - (scroll.held ?? time), 0) / RAMP_MS, 1);
    const dt = Math.min((time - scroll.time) / 1000, 0.05);
    scroll.time = time;
    // The scroll view's content: the items, with the insets as padding.
    const room = {
      x: Math.max(placed.size.width + inset.x.start + inset.x.end - viewport.width, 0),
      y: Math.max(placed.size.height + inset.y.start + inset.y.end - viewport.height, 0),
    };
    const pos = {
      x: Math.min(Math.max(scroll.pos.x + speed.x * ramp * dt, 0), room.x),
      y: Math.min(Math.max(scroll.pos.y + speed.y * ramp * dt, 0), room.y),
    };
    if (pos.x !== scroll.pos.x || pos.y !== scroll.pos.y) {
      scroll.pos = pos;
      this.view.scrollTo(pos, false);
      this.view.track(pos);
      this.retarget(state, base, p);
    }
    this.schedule();
  }
}
