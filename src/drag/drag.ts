import type { Region, ReflowResult } from '../layout';

/** A point in the content's own coordinates. */
export interface Point {
  x: number;
  y: number;
}

/**
 * One thing being dragged. `key` is its key in the grid's `data` when it came
 * from there; an item from elsewhere (another app, another grid) has none.
 * `types` say what it can be read as (MIME types or platform type identifiers),
 * `local` is what a drag within the app carries along: for an item of the grid,
 * the item.
 */
export interface DragItem {
  key?: string;
  types: readonly string[];
  local?: unknown;
}

/**
 * A drag, from the first lift to the drop: everything lifted together, and where
 * it came from. A drag is always a list of items, so a drag of several items, or
 * one that carries items from another grid or app, is the same shape as one item
 * lifted from the grid. For now a drag the grid begins lifts one internal item.
 */
export interface DragSession {
  origin: 'internal' | 'external';
  items: readonly DragItem[];
}

/**
 * A drag in progress inside the grid. The grid keeps the layout of `keys`, as
 * it was when the drag began, to hit-test against: it doesn't move under the
 * finger, so the target can't flip back and forth as the others make room. What
 * the grid shows is the layout of `preview`.
 */
export interface DragState {
  session: DragSession;
  /** The keys of `data` when the drag began, in order. */
  keys: readonly string[];
  /** The dragged items' keys, in the order they have in `keys`. */
  dragged: readonly string[];
  /** The index the dragged items take: that of the slot the finger is over. */
  target: number;
  /** `keys` with the dragged items moved to `target`. */
  preview: readonly string[];
}

/** What a finished drag changed. */
export interface DragResult {
  /** The drag: what was lifted. */
  session: DragSession;
  /** The new order of the keys. */
  keys: readonly string[];
  /** The keys that moved, in order. */
  moved: readonly string[];
  /** Where the first of them was, and where it is now. */
  from: number;
  to: number;
}

/** How far past a slot's edges (as a fraction of its smaller side) the finger can go before the target moves off it. */
export const HYSTERESIS = 0.25;

/** `keys` with `moving` taken out and put back together, the first of them at index `to` (clamped). */
export function moveKeys(keys: readonly string[], moving: readonly string[], to: number): string[] {
  const set = new Set(moving);
  const others = keys.filter((k) => !set.has(k));
  const block = keys.filter((k) => set.has(k));
  const at = Math.min(Math.max(to, 0), others.length);
  return [...others.slice(0, at), ...block, ...others.slice(at)];
}

/** The page of a paged layout the point is on (the last one, beyond the end), or everything. */
function pageAround(layout: ReflowResult, point: Point): Region {
  const pages = layout.pages;
  const everything = { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };
  if (!pages || pages.count === 0 || !(pages.stride > 0)) return everything;
  const along = pages.direction === 'horizontal' ? point.x : point.y;
  const start = Math.min(Math.max(Math.floor(along / pages.stride), 0), pages.count - 1) * pages.stride;
  return pages.direction === 'horizontal' ? { ...everything, x0: start, x1: start + pages.stride } : { ...everything, y0: start, y1: start + pages.stride };
}

/**
 * The slot the point is over, or the nearest one when it's over none (in a gap,
 * or off the content). Looks only at the slots near the point, widening the
 * search until it finds some, so it never visits every item.
 */
export function slotAt(layout: ReflowResult, count: number, point: Point): number | undefined {
  if (count === 0) return undefined;
  const reach = Math.max(layout.size.width, layout.size.height, Math.abs(point.x), Math.abs(point.y)) * 2 + 2;
  const page = pageAround(layout, point);
  for (let r = 1; r <= reach; r *= 2) {
    // In a paged layout only the slots of the page the point is on count: the nearest overall could be on the next one.
    const found = layout.indicesIn({
      x0: Math.max(point.x - r, page.x0),
      x1: Math.min(point.x + r, page.x1),
      y0: Math.max(point.y - r, page.y0),
      y1: Math.min(point.y + r, page.y1),
    });
    if (found.length === 0) continue;
    let best = found[0]!;
    let bestDistance = Infinity;
    for (const i of found) {
      const rect = layout.rectOf(i);
      const distance = Math.hypot(point.x - (rect.x + rect.width / 2), point.y - (rect.y + rect.height / 2));
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }
  return 0;
}

/**
 * The index the dragged items should take with the finger at `point`. The slot
 * it's in now (`current`) holds on a little past its edges, so a finger resting
 * on the line between two slots doesn't flip between them; once it's out of
 * that, wherever it is, the slot it's over (or the nearest) is the target. With
 * no `current`, or off the content altogether, the nearest slot wins.
 */
export function hoverIndex(layout: ReflowResult, count: number, point: Point, current?: number, hysteresis = HYSTERESIS): number | undefined {
  const found = slotAt(layout, count, point);
  if (found === undefined || current === undefined || found === current || current >= count) return found ?? current;
  const { width, height } = layout.size;
  if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return found;
  const rect = layout.rectOf(current);
  const margin = hysteresis * Math.min(rect.width, rect.height);
  const holds =
    point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin && point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
  return holds ? current : found;
}

/**
 * Begins a drag of the session's items that are in `keys`. An external drop
 * (nothing of the session in `keys`) isn't a reorder, so it has no state.
 */
export function beginDrag(keys: readonly string[], session: DragSession): DragState | undefined {
  const own = new Set(session.items.flatMap((item) => (item.key !== undefined ? [item.key] : [])));
  const dragged = keys.filter((k) => own.has(k));
  if (dragged.length === 0) return undefined;
  const target = keys.indexOf(dragged[0]!);
  return { session, keys, dragged, target, preview: keys };
}

/**
 * The state with the finger at `point`. `layout` is the layout of `state.keys`.
 * The same state comes back when the target hasn't changed.
 */
export function updateDrag(state: DragState, layout: ReflowResult, point: Point, hysteresis = HYSTERESIS): DragState {
  const target = hoverIndex(layout, state.keys.length, point, state.target, hysteresis) ?? state.target;
  if (target === state.target) return state;
  // A block of several can't start past the last of the others: `moveKeys` clamps it.
  return { ...state, target, preview: moveKeys(state.keys, state.dragged, target) };
}

/** What dropping changed, or `undefined` when nothing did (or the drag was cancelled). */
export function endDrag(state: DragState, cancelled = false): DragResult | undefined {
  if (cancelled) return undefined;
  const moved = state.preview.length === state.keys.length && state.preview.some((k, i) => k !== state.keys[i]);
  if (!moved) return undefined;
  return { session: state.session, keys: state.preview, moved: state.dragged, from: state.keys.indexOf(state.dragged[0]!), to: state.preview.indexOf(state.dragged[0]!) };
}

/** How far (pt) in from the edge of what's on screen a drag starts scrolling. */
export const EDGE_BAND = 72;
/** How fast (pt/s) a drag at the edge scrolls. */
export const EDGE_SPEED = 1200;

/**
 * How fast to scroll (pt/s, negative towards the start) with the pointer at
 * `pos` along an axis whose visible part runs from `start` to `end`: none out
 * of the bands at either end, building up to `max` at the edge and holding it
 * beyond (over the header, say). The band is never more than a third of the
 * view, so a small one still has a middle that stays still.
 */
export function edgeVelocity(pos: number, start: number, end: number, band = EDGE_BAND, max = EDGE_SPEED): number {
  const b = Math.min(band, Math.max(end - start, 0) / 3);
  if (b <= 0) return 0;
  const intoStart = start + b - pos;
  if (intoStart > 0) return -max * Math.min(intoStart / b, 1) ** 2;
  const intoEnd = pos - (end - b);
  if (intoEnd > 0) return max * Math.min(intoEnd / b, 1) ** 2;
  return 0;
}
