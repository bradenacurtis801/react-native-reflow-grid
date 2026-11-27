import {
  beginDrag,
  besideTarget,
  canJoin,
  EDGE_BAND,
  edgeVelocity,
  endDrag,
  joinZone,
  moveTarget,
  slotAt,
  updateDrag,
  within,
  type DragResult,
  type DragSession,
  type DragState,
  type JoinPolicy,
  type JoinResult,
  type Point,
} from './drag';
import type { CarryTarget, DragCarrier } from './carrier';
import { HAPTIC_GAPS, type HapticEvent } from '../support/haptics';
import type { Rect, ReflowResult, Size } from '../layout';
import { now, perfLog, perfOn } from '../support/perfLog';

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
/** How far (pt) in from an edge a drag in a paged layout turns the page: narrow, so the pages' edge cells can be held over. */
export const PAGE_EDGE_BAND = 28;
/** Held at an edge this long (ms), a drag in a paged layout turns the page; held on, it turns another. */
export const PAGE_DWELL_MS = 700;
/** A page turn on web takes this long (ms). */
export const PAGE_TURN_MS = 320;
/** A drag scrolls at this fraction of its speed when it reaches an edge, and builds up to all of it over `RAMP_MS`. */
export const RAMP_FROM = 0.3;
export const RAMP_MS = 1000;
/** A mouse drag that has sent nothing for this long (ms) has left the window: it stops scrolling. */
export const QUIET_MS = 500;
/** Held on an item it can join this long (ms), the drag asks for it to be opened (`onSpringLoad`). */
export const SPRING_LOAD_MS = 900;
/** A drag that has stayed outside a grid this long (ms, unless the grid says otherwise) asks to leave it (`onDragExit`). */
export const DRAG_EXIT_MS = 450;
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
  /** What an item is for joining, `slot` being where it was when the drag began. Joining is on with this and `onJoin`. */
  joinOf?(item: T, index: number, slot: Rect): JoinPolicy | undefined;
  /** A drop onto an item. `false` refuses it; a string is the key of the item that takes the target's place. */
  onJoin?(result: JoinResult): string | false | void;
  /** The finger has stayed on an item it can join. `false`: nothing opened. A string: the key now in the target's place. */
  onSpringLoad?(result: JoinResult): string | false | void;
  /** The finger has stayed outside the grid. `false`: the drag stays this grid's. */
  onDragExit?(result: { session: DragSession; dragged: readonly string[]; point: Point }): false | void;
  /** How long the finger stays outside before `onDragExit` is asked. @default `DRAG_EXIT_MS` */
  exitDelay?: number;
  /** What carries a drag from one grid to another (see `ReflowDragProvider`). */
  carrier?: DragCarrier;
  /** What draws an item outside the grid, for the carrier's layer. */
  renderCarried?(item: T, index: number, size: Size): () => unknown;
  onDragStart?(session: DragSession): void;
  /** The finger with this id has lifted an item: the press it began is over. */
  onLift?(id: string): void;
  /** A moment for feedback (see `HapticEvent`); absent when there is none to give. */
  haptic?(event: HapticEvent): void;
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
  /** A drag that began here has been carried off: its finger still belongs to this grid, which must not scroll under it. */
  carrying?: boolean;
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
  /** Its drag has left for another grid: its moves are passed on. */
  carried?: boolean;
  timer?: unknown;
}

/**
 * Drag to reorder, apart from how a drag is begun: a finger held on an item
 * (`touch…`) or a browser's drag and drop (`os…`). It follows the pointer,
 * works out where the item would land, scrolls or turns pages at an edge, and
 * on a drop reports the new order. It knows nothing of React or of how the grid
 * draws: it reads the grid through `view`, and the grid reads `getSnapshot`.
 */
export class DragEngine<T> implements CarryTarget {
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
  private lastHaptic: Partial<Record<HapticEvent, number>> = {};
  /** Where the drag holds the lifted item, from its top-left. */
  private grab: Point = { x: 0, y: 0 };
  private springWait?: unknown;
  private exitWait?: unknown;
  /** The drag is of an item this grid doesn't have, here only to be joined to one it does. */
  private visiting = false;
  /** The items carried off to another grid: they leave `data` here without being seen to. */
  readonly handedOff = new Set<string>();
  /** What each dragged item is, for joining. */
  private dragPolicies: (JoinPolicy | undefined)[] = [];
  /** The item whose join zone the pointer is in, and the zone's middle from its slot's top-left. */
  private joinWait?: { key: string; at: Point };

  /**
   * The items the last drop joined to another: for each, the item it went into (by the key it has now) and the point on it
   * (from its top-left) it went to. The grid takes them there as they leave `data`.
   */
  readonly joined = new Map<string, { into: string; at: Point }>();
  /** The item the last join put in another's place: the key that went and the one that came. */
  replaced?: { from: string; to: string };

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

  /** Gives feedback for a moment, unless it's one that comes often and did a moment ago (`HAPTIC_GAPS`). */
  haptic(event: HapticEvent) {
    const gap = HAPTIC_GAPS[event];
    if (gap) {
      const now = this.host.now();
      if (now - (this.lastHaptic[event] ?? -Infinity) < gap) return;
      this.lastHaptic[event] = now;
    }
    this.view.haptic?.(event);
  }

  dispose() {
    this.stopScroll();
    this.cancelJoinWait();
    this.cancelExit();
    this.host.clearTimeout(this.holdTimer);
    if (this.press?.carried) this.view.carrier?.end(true);
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
    if (press.carried) {
      this.view.carrier?.move(page);
    } else if (press.active) {
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
    if (press.carried) {
      this.view.carrier?.end(cancelled);
      this.set({ carrying: false });
    } else if (press.active) this.finish(cancelled);
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
    this.view.onDragStart?.(state.session);
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
  private begin(index: number, point: Point, kind: 'touch' | 'os' | 'carried', grab?: Point): DragState | undefined {
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
    this.joined.clear();
    this.replaced = undefined;
    this.handedOff.clear();
    this.visiting = false;
    this.grab = grab ?? { x: point.x - rect.x, y: point.y - rect.y };
    this.dragPolicies = [this.view.joinOf?.(items[index]!, index, rect)];
    this.view.setFinger(point, this.grab);
    this.set({ drag: state, floating: kind !== 'os' });
    // A carried item was lifted already, in the grid it came from.
    if (kind !== 'carried') this.haptic('lift');
    return state;
  }

  // A drag carried here from another grid (see `DragCarrier`), which passes on its finger.

  adopt(key: string, page: Point, grab: Point, size: Size): boolean {
    const { enabled, items, keyOf, placed } = this.view;
    // The grid the finger belongs to can take its item back.
    if (!enabled || !placed || this.snap.drag || (this.press && !this.press.carried)) return false;
    const index = items.findIndex((item, i) => keyOf(item, i) === key);
    if (index < 0) return false;
    // The cells needn't be the size they were: the finger keeps its place from the item's middle across, and from its top.
    const held = { x: grab.x + (placed.rectOf(index).width - size.width) / 2, y: grab.y };
    if (!this.begin(index, this.view.toContent(page), 'carried', held)) return false;
    this.follow(page, true);
    return true;
  }

  visit(key: string, item: unknown, page: Point, size: Size): boolean {
    const { enabled, items, keyOf, placed, joinOf, onJoin } = this.view;
    if (!enabled || !placed || !joinOf || !onJoin || this.snap.drag || (this.press && !this.press.carried)) return false;
    const keys = items.map(keyOf);
    if (keys.includes(key)) return false;
    // Nothing of this grid's moves: the keys stay as they are, and the item that's dragged is none of them.
    this.byKey = new Map(items.map((own, i) => [keys[i]!, own]));
    this.byKey.set(key, item as T);
    this.base = placed;
    this.joined.clear();
    this.replaced = undefined;
    this.handedOff.clear();
    this.visiting = true;
    this.dragPolicies = [joinOf(item as T, -1, { x: 0, y: 0, ...size })];
    const session: DragSession = { origin: 'external', items: [{ key, types: ['text/plain'], local: item }] };
    this.set({ drag: { session, keys, dragged: [key], target: -1, preview: keys }, floating: true });
    this.follow(page, true);
    return true;
  }

  carryMove(page: Point) {
    if (this.snap.drag) this.follow(page, true);
  }

  carryEnd(cancelled: boolean) {
    this.finish(cancelled);
  }

  /** The finger has stayed on `key`: if the app opens it, the drag leaves this grid for whatever takes it over. */
  private springLoad(key: string) {
    this.springWait = undefined;
    const drag = this.snap.drag;
    const { onSpringLoad } = this.view;
    if (!drag || drag.join !== key || !onSpringLoad) return;
    const leave = this.leaveWith(drag);
    if (!leave) return;
    const returned = onSpringLoad({ session: drag.session, dragged: drag.dragged, target: key });
    if (returned === false) return;
    if (typeof returned === 'string' && returned !== key) this.replaced = { from: key, to: returned };
    leave();
  }

  /** The finger has stayed outside the grid: if the app lets it, the drag leaves for whatever takes it over. */
  private exit() {
    this.exitWait = undefined;
    const drag = this.snap.drag;
    const { onDragExit } = this.view;
    const at = this.pointer;
    if (!drag || !onDragExit || !at) return;
    const leave = this.leaveWith(drag);
    if (!leave || onDragExit({ session: drag.session, dragged: drag.dragged, point: { x: at.x, y: at.y } }) === false) return;
    leave();
  }

  /**
   * What lets the drag go from this grid, if it can be: the finger is this grid's (held on here, or the item taken back),
   * or the item was carried here. It's worked out before the app is told, which changes `data`.
   */
  private leaveWith(drag: DragState): (() => void) | undefined {
    const { carrier, renderCarried } = this.view;
    const press = this.press;
    const base = this.base;
    const at = this.pointer;
    if (!carrier || !renderCarried || !base || !at) return undefined;
    const adopted = carrier.holds(this);
    if (!adopted && !press?.active) return undefined;
    const dragged = drag.dragged[0]!;
    // One carried here is drawn by its first grid already.
    let start: (() => void) | undefined;
    if (!adopted) {
      const index = drag.keys.indexOf(dragged);
      const { width, height } = base.rectOf(index);
      const size = { width, height };
      const item = this.byKey.get(dragged)!;
      const render = renderCarried(item, index, size);
      start = () => {
        press!.carried = true;
        carrier.start({ key: dragged, item, size, grab: this.grab, render }, at);
      };
    }
    return () => {
      for (const k of drag.dragged) this.handedOff.add(k);
      this.cancelJoinWait();
      this.cancelExit();
      this.stopScroll();
      this.scroll.dwell = undefined;
      if (start) start();
      else carrier.release();
      // The grid the finger belongs to must not scroll under it.
      this.set({ drag: undefined, floating: false, carrying: this.press?.carried === true });
    };
  }

  /** Whether the pointer is outside a grid that can be left. */
  private outside(p: Point & { touch: boolean }): boolean {
    const { onDragExit, carrier, viewport } = this.view;
    if (!p.touch || !onDragExit || !carrier || !viewport) return false;
    const at = this.view.toRoot(p);
    return at.x < 0 || at.y < 0 || at.x > viewport.width || at.y > viewport.height;
  }

  private cancelExit() {
    this.host.clearTimeout(this.exitWait);
    this.exitWait = undefined;
  }

  /** The pointer (page coordinates) has moved: the item follows it, the target is worked out, and an edge starts the scroll. */
  private follow(page: Point, touch: boolean) {
    const state = this.snap.drag;
    if (!state || !this.base) return;
    const p = { x: page.x, y: page.y, at: this.host.now(), touch };
    this.pointer = p;
    if (perfOn()) {
      // A long gap between moves: the thread was busy, and the lifted item stood still while the finger didn't.
      const at = now();
      if (this.lastMove && at - this.lastMove > 40) perfLog(`pointer move gap=${(at - this.lastMove).toFixed(0)}ms`);
      this.lastMove = at;
    }
    if (this.outside(p)) {
      // On its way out: the item follows, nothing makes room, and, held out there, the drag leaves.
      this.view.setFinger(this.view.toContent(p));
      this.cancelJoinWait();
      this.unjoin();
      this.exitWait ??= this.host.setTimeout(() => this.exit(), this.view.exitDelay ?? DRAG_EXIT_MS);
      return;
    }
    this.cancelExit();
    this.retarget(state, this.base, p);
    // A visiting item doesn't scroll the grid it visits.
    if (this.visiting) return;
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
    const under = this.joinable(state, base, point);
    if (under?.inZone) {
      // On the item itself: nothing makes room.
      this.hoverJoin(under.key, under.at);
      return;
    }
    this.cancelJoinWait();
    const current = this.unjoin();
    if (!current || this.visiting) return;
    this.moveTo(under ? moveTarget(current, besideTarget(base, current.keys.length, under.index, current.target, point, under.zone)) : updateDrag(current, base, point));
  }

  private moveTo(next: DragState) {
    if (next === this.snap.drag) return;
    if (perfOn()) {
      const o = this.view.offset();
      perfLog(`reflow: target ${next.target}, scroll offset=(${o.x.toFixed(0)}, ${o.y.toFixed(0)})`);
    }
    this.set({ drag: next });
    this.haptic('move');
  }

  /**
   * The item under the point, if the dragged ones can join it, and whether the point is in its join zone. The slots are those
   * the drag began with, which don't move; the item in one is whichever the preview shows there.
   */
  private joinable(state: DragState, base: ReflowResult, point: Point) {
    const { joinOf, onJoin } = this.view;
    if (!joinOf || !onJoin) return undefined;
    const index = slotAt(base, state.keys.length, point);
    const key = index !== undefined ? state.preview[index] : undefined;
    if (index === undefined || key === undefined || state.dragged.includes(key)) return undefined;
    const slot = base.rectOf(index);
    const policy = joinOf(this.byKey.get(key)!, index, slot);
    if (!policy || !canJoin(this.dragPolicies, policy)) return undefined;
    const zone = joinZone(slot, policy.zone);
    return { key, index, zone, inZone: within(zone, point), at: { x: zone.x + zone.width / 2 - slot.x, y: zone.y + zone.height / 2 - slot.y } };
  }

  /** The pointer is in `key`'s join zone: it's the item a drop joins at once, and, held on, the one that's opened. */
  private hoverJoin(key: string, at: Point) {
    if (this.joinWait?.key === key) return;
    this.cancelJoinWait();
    this.unjoin();
    this.joinWait = { key, at };
    const drag = this.snap.drag;
    if (!drag) return;
    this.set({ drag: { ...drag, join: key } });
    this.haptic('join');
    // Only a finger's drag can be carried on.
    if (this.snap.floating && this.view.onSpringLoad && this.view.carrier) this.springWait = this.host.setTimeout(() => this.springLoad(key), SPRING_LOAD_MS);
  }

  /** No item is the one to join: the drag as it is without. */
  private unjoin(): DragState | undefined {
    const drag = this.snap.drag;
    if (drag?.join === undefined) return drag;
    const { join: _, ...rest } = drag;
    this.set({ drag: rest });
    return rest;
  }

  private cancelJoinWait() {
    this.host.clearTimeout(this.springWait);
    this.springWait = undefined;
    this.joinWait = undefined;
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
    const at = this.joinWait?.at;
    this.cancelJoinWait();
    this.cancelExit();
    const state = this.snap.drag;
    if (!state) return;
    if (state.join !== undefined && at && !cancelled && this.view.onJoin) {
      this.drop(state, state.join, at);
      return;
    }
    const result = endDrag(state, cancelled);
    if (result) {
      this.set({ drag: undefined, floating: false, held: { keys: result.keys, data: this.view.data } });
      this.host.clearTimeout(this.holdTimer);
      this.holdTimer = this.host.setTimeout(() => this.set({ held: undefined }), HOLD_MS);
      this.haptic('drop');
      this.view.onReorder?.(result);
    } else {
      this.set({ drag: undefined, floating: false });
    }
  }

  /** A drop onto the item `target`. The order the drag had previewed is let go: `data` says what there is now. */
  private drop(state: DragState, target: string, at: Point) {
    const returned = this.view.onJoin!({ session: state.session, dragged: state.dragged, target });
    if (returned !== false) {
      const into = typeof returned === 'string' ? returned : target;
      for (const key of state.dragged) this.joined.set(key, { into, at });
      if (into !== target) this.replaced = { from: target, to: into };
      this.haptic('drop');
    }
    this.set({ drag: undefined, floating: false });
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
    // Outside a grid that can be left, the finger isn't asking it to scroll.
    if (!viewport || this.outside(p as Point & { touch: boolean })) return { x: 0, y: 0 };
    const at = this.view.toRoot(p);
    // Pages don't scroll under the finger, so their edge zone needn't be the room a scroll builds up speed in.
    const band = this.view.placed?.pages ? PAGE_EDGE_BAND : EDGE_BAND;
    return {
      x: axis === 'vertical' ? 0 : edgeVelocity(at.x, inset.x.start, viewport.width - inset.x.end, band),
      y: axis === 'horizontal' ? 0 : edgeVelocity(at.y, inset.y.start, viewport.height - inset.y.end, band),
    };
  }

  private turnPosition(turn: { horizontal: boolean }, along: number): Offset {
    const now = this.view.offset();
    return turn.horizontal ? { x: along, y: now.y } : { x: now.x, y: along };
  }

  /** The time of the last frame, for the gap between them (`perfLog`). */
  private lastFrame = 0;
  /** The time of the last move of the pointer, for the gap between them (`perfLog`). */
  private lastMove = 0;

  private frame(time: number) {
    if (!perfOn()) return this.step(time);
    const start = now();
    const gap = this.lastFrame && time - this.lastFrame < 1000 ? time - this.lastFrame : 0;
    this.lastFrame = time;
    this.step(time);
    const work = now() - start;
    // Only a slow one: a frame that took long to start (the thread was busy), or long to do.
    if (gap > 24 || work > 8) perfLog(`drag frame gap=${gap.toFixed(0)}ms work=${work.toFixed(1)}ms`);
  }

  private step(time: number) {
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
          this.haptic('pageTurn');
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
