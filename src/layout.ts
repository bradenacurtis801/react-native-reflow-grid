export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** A part of the content, in the content's own coordinates: what's on screen, with a buffer. */
export interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Whether a rect meets a region (touching edges don't count). */
export function intersects(r: Rect, region: Region): boolean {
  return r.x < region.x1 && r.x + r.width > region.x0 && r.y < region.y1 && r.y + r.height > region.y0;
}

/**
 * Where a layout puts its items. It's asked for only what's needed — the
 * items on screen, one item's slot — so a layout need not build a rect for
 * every item: a grid works each one out from its index. Indices run from 0 to
 * the data's length less one.
 */
export interface ReflowResult {
  /** What the items take up together: what the content view is sized to. */
  size: Size;
  /** Where item `index` goes. */
  rectOf(index: number): Rect;
  /** The items whose rects meet `region`, in ascending order. */
  indicesIn(region: Region): number[];
}

/**
 * A layout is a function from the items to where each goes. That is all
 * `ReflowGrid` asks of one, so any arrangement works — a grid (`gridLayout`),
 * a masonry (`masonryLayout`), a stack — by being written as one. It sees the
 * items, so what it places can depend on them (their sizes, say). It's called
 * again whenever `data` or the container changes, and the items glide to their
 * new places. A layout written with an array of rects can wrap it with
 * `layoutFromRects`.
 */
export type ReflowLayout<T = unknown> = (data: readonly T[], container: Size) => ReflowResult;

/** A result from an array of rects, one per item: a scan finds the ones in a region. */
export function layoutFromRects(rects: readonly Rect[], size: Size): ReflowResult {
  return {
    size,
    rectOf: (index) => rects[index]!,
    indicesIn: (region) => {
      const out: number[] = [];
      rects.forEach((r, i) => {
        if (intersects(r, region)) out.push(i);
      });
      return out;
    },
  };
}

/**
 * A card's size. Each form takes the room's cross side, or fixes what it
 * needs to:
 *   • `{ aspect }` — width ÷ height. Across the scroll axis it fills the room;
 *     along it, the length follows from that. The default: `{ aspect: 0.75 }`,
 *     a tab's shape.
 *   • `{ length }` — a fixed length along the scroll axis, in points.
 *   • `{ width, height }` — both fixed, in points. The content is then as big
 *     as its cards: with a fixed size on both axes, the grid scrolls on both.
 */
export type CardSize = { aspect: number } | { length: number } | { width: number; height: number };

/** The default card: a tab's shape. */
const DEFAULT_CARD: CardSize = { aspect: 0.75 };

export interface GridLayoutOptions {
  /**
   * The direction the items fill in. `'vertical'`: a row is filled, then the
   * next one under it — `lines` is how many columns there are. `'horizontal'`:
   * a column is filled, then the next beside it — `lines` is how many rows.
   * The extra items go further along the scroll axis, which is the one that
   * scrolls (or both, with a fixed `card`).
   */
  flow: 'vertical' | 'horizontal';
  /** Columns (vertical flow) or rows (horizontal). One makes a plain list or strip. */
  lines: number;
  /** Between items: one number for both axes, or each. @default 0 */
  gap?: number | { x: number; y: number };
  /**
   * The card's size (see `CardSize`). @default `{ aspect: 0.75 }`
   */
  card?: CardSize;
}

/** The columns (or rows) `[first, last]` of `count` that meet `lo`–`hi`; first > last when none do. */
function span(lo: number, hi: number, extent: number, pitch: number, count: number): [number, number] {
  return [Math.max(Math.floor((lo - extent) / pitch) + 1, 0), Math.min(Math.ceil(hi / pitch) - 1, count - 1)];
}

/**
 * Items in rows and columns, as `GridLayoutOptions` says. Every item's slot,
 * and which ones are in a region, are worked out from the index: nothing is
 * built per item.
 */
export function gridLayout(options: GridLayoutOptions): ReflowLayout {
  const { flow, lines } = options;
  if (!Number.isInteger(lines) || lines < 1) throw new Error(`gridLayout: lines must be a whole number of 1 or more, got ${lines}`);
  const gap = typeof options.gap === 'number' ? { x: options.gap, y: options.gap } : (options.gap ?? { x: 0, y: 0 });
  const card = options.card ?? DEFAULT_CARD;
  if ('width' in card && !(card.width > 0 && card.height > 0)) {
    throw new Error(`gridLayout: a card's width and height must be above 0, got ${card.width} × ${card.height}`);
  }
  const horizontal = flow === 'horizontal';

  return (data, room) => {
    const count = data.length;
    let item: Size;
    if ('width' in card) {
      // Fixed on both axes: the room doesn't size it.
      item = { width: card.width, height: card.height };
    } else {
      // Across: the lines share the room's side that runs across them (the height, for rows of columns).
      const across = horizontal ? room.height : room.width;
      const acrossGap = horizontal ? gap.y : gap.x;
      const cross = Math.max((across - (lines - 1) * acrossGap) / lines, 0);
      // Along: the card's length on the scroll axis.
      const along = 'length' in card ? card.length : horizontal ? cross * card.aspect : cross / card.aspect;
      item = horizontal ? { width: along, height: cross } : { width: cross, height: along };
    }
    const pitch = { x: item.width + gap.x, y: item.height + gap.y };

    const columns = horizontal ? Math.ceil(count / lines) : lines;
    const rows = horizontal ? lines : Math.ceil(count / lines);
    const size = {
      width: count === 0 ? 0 : columns * item.width + (columns - 1) * gap.x,
      height: count === 0 ? 0 : rows * item.height + (rows - 1) * gap.y,
    };
    // Vertical flow: across a row, then down. Horizontal: down a column, then across.
    const rectOf = (i: number): Rect => {
      const column = horizontal ? Math.floor(i / lines) : i % lines;
      const row = horizontal ? i % lines : Math.floor(i / lines);
      return { x: column * pitch.x, y: row * pitch.y, ...item };
    };

    return {
      size,
      rectOf,
      indicesIn: (region) => {
        const out: number[] = [];
        if (count === 0) return out;
        // Slots with no pitch (a zero-size room) can't be divided into: look at each.
        if (!(pitch.x > 0 && pitch.y > 0)) {
          for (let i = 0; i < count; i++) if (intersects(rectOf(i), region)) out.push(i);
          return out;
        }
        const [c0, c1] = span(region.x0, region.x1, item.width, pitch.x, columns);
        const [r0, r1] = span(region.y0, region.y1, item.height, pitch.y, rows);
        // Ascending: a row at a time for vertical flow, a column at a time for horizontal.
        if (horizontal) {
          for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (c * lines + r < count) out.push(c * lines + r);
        } else {
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r * lines + c < count) out.push(r * lines + c);
        }
        return out;
      },
    };
  };
}

export interface MasonryLayoutOptions<T> {
  /** How many columns share the room's width. */
  columns: number;
  /** Between items: one number for both axes, or each. @default 0 */
  gap?: number | { x: number; y: number };
  /** An item's height, given the width its column gives it (an image's aspect ratio, a text's length…). */
  heightOf: (item: T, width: number, index: number) => number;
}

/**
 * Columns of equal width, items of any height: each item goes under the
 * shortest column so far (the leftmost, on a tie), in order. Vertical scroll.
 * The rects are built for every item, so a change of `data` costs one pass
 * over it.
 */
export function masonryLayout<T>({ columns, gap: gapOption, heightOf }: MasonryLayoutOptions<T>): ReflowLayout<T> {
  if (!Number.isInteger(columns) || columns < 1) throw new Error(`masonryLayout: columns must be a whole number of 1 or more, got ${columns}`);
  const gap = typeof gapOption === 'number' ? { x: gapOption, y: gapOption } : (gapOption ?? { x: 0, y: 0 });

  return (data, room) => {
    const width = Math.max((room.width - (columns - 1) * gap.x) / columns, 0);
    // Where each column's next item goes.
    const next = new Array<number>(columns).fill(0);
    const rects = data.map((item, index): Rect => {
      let column = 0;
      for (let c = 1; c < columns; c++) if (next[c]! < next[column]!) column = c;
      const height = heightOf(item, width, index);
      const rect = { x: column * (width + gap.x), y: next[column]!, width, height };
      next[column] = rect.y + height + gap.y;
      return rect;
    });
    const empty = data.length === 0;
    return layoutFromRects(rects, {
      width: empty ? 0 : columns * width + (columns - 1) * gap.x,
      height: empty ? 0 : Math.max(...next) - gap.y,
    });
  };
}
