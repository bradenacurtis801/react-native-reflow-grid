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

/** A layout made of pages, one after another along the scroll axis, each one `stride` long. */
export interface PageInfo {
  count: number;
  /** How far apart the pages start: the room's size along the scroll axis. */
  stride: number;
  direction: 'horizontal' | 'vertical';
  /** How many items a page holds. */
  perPage: number;
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
  /** Set by a paged layout: the grid snaps to whole pages, and a drag turns them. */
  pages?: PageInfo;
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

/** What a masonry layout keeps from its last call, to carry on from. */
interface MasonryBuilt<T> {
  data: readonly T[];
  /** The width a column had. */
  width: number;
  rects: Rect[];
  /** The column each item went in. */
  columnOf: number[];
  /** Where each column's next item would go before item `64 × j`, for each `j` (and `end`: after the last). */
  checkpoints: number[][];
  end: number[];
  result: ReflowResult;
}

/** A masonry layout keeps where the columns stood before every this many items, to start again from the one before a change. */
const MASONRY_CHECKPOINT = 64;

export interface MasonryLayoutOptions<T> {
  /** How many columns share the room's width. */
  columns: number;
  /** Between items: one number for both axes, or each. @default 0 */
  gap?: number | { x: number; y: number };
  /**
   * An item's height, given the width its column gives it (an image's aspect
   * ratio, a text's length…). It must depend only on its arguments: the layout
   * doesn't ask again for an item it has already placed, as long as the item is the
   * same object at the same index, so replace an item to change its height rather
   * than changing it in place.
   */
  heightOf: (item: T, width: number, index: number) => number;
}

/**
 * Columns of equal width, items of any height: each item goes under the
 * shortest column so far (the leftmost, on a tie), in order. Vertical scroll.
 *
 * It remembers its last result. When `data` changes, the items before the first
 * one that differs (by reference) keep their places and `heightOf` is not asked
 * about them again, so adding at the end, or changing one item far down a long
 * list, costs only what follows. A change of the room's width places everything
 * again. Memoize the layout: a new one starts with nothing remembered.
 */
export function masonryLayout<T>({ columns, gap: gapOption, heightOf }: MasonryLayoutOptions<T>): ReflowLayout<T> {
  if (!Number.isInteger(columns) || columns < 1) throw new Error(`masonryLayout: columns must be a whole number of 1 or more, got ${columns}`);
  const gap = typeof gapOption === 'number' ? { x: gapOption, y: gapOption } : (gapOption ?? { x: 0, y: 0 });
  let last: MasonryBuilt<T> | undefined;

  return (data, room) => {
    const width = Math.max((room.width - (columns - 1) * gap.x) / columns, 0);
    // How many items from the start are as they were.
    let same = 0;
    const prev = last && last.width === width ? last : undefined;
    if (prev) {
      const limit = Math.min(prev.data.length, data.length);
      while (same < limit && prev.data[same] === data[same]) same++;
      if (same === data.length && same === prev.data.length) return prev.result;
    }

    const rects: Rect[] = prev ? prev.rects.slice(0, same) : [];
    const columnOf: number[] = prev ? prev.columnOf.slice(0, same) : [];
    // Where each column's next item goes, as it stood before item `same`: from the last checkpoint at or before it.
    let next: number[];
    let checkpoints: number[][];
    if (prev && same > 0) {
      const j = Math.floor((same - 1) / MASONRY_CHECKPOINT);
      checkpoints = prev.checkpoints.slice(0, j + 1);
      next = same === prev.data.length ? prev.end.slice() : checkpoints[j]!.slice();
      if (same !== prev.data.length) {
        for (let i = j * MASONRY_CHECKPOINT; i < same; i++) next[columnOf[i]!] = rects[i]!.y + rects[i]!.height + gap.y;
      }
    } else {
      checkpoints = [];
      next = new Array<number>(columns).fill(0);
    }

    for (let index = same; index < data.length; index++) {
      if (index % MASONRY_CHECKPOINT === 0) checkpoints[index / MASONRY_CHECKPOINT] = next.slice();
      let column = 0;
      for (let c = 1; c < columns; c++) if (next[c]! < next[column]!) column = c;
      const height = heightOf(data[index]!, width, index);
      const rect = { x: column * (width + gap.x), y: next[column]!, width, height };
      next[column] = rect.y + height + gap.y;
      rects.push(rect);
      columnOf.push(column);
    }

    const empty = data.length === 0;
    const result = layoutFromRects(rects, {
      width: empty ? 0 : columns * width + (columns - 1) * gap.x,
      height: empty ? 0 : Math.max(...next) - gap.y,
    });
    last = { data, width, rects, columnOf, checkpoints, end: next, result };
    return result;
  };
}

export interface PagedLayoutOptions {
  /** The way pages follow one another, which is the way the grid scrolls: `axis` must match. */
  direction: 'horizontal' | 'vertical';
  /** Items across a page and down it: a page holds `columns × rows`, filled a row at a time. */
  columns: number;
  rows: number;
  /** Between items: one number for both axes, or each. @default 0 */
  gap?: number | { x: number; y: number };
  /**
   * Between one page's items and the next page's, along `direction`: half of it
   * is left clear at each end of a page, so the last items of one page don't
   * touch the first of the next while the grid is between them. The pages are
   * still a room apart, so the grid snaps to them as before. @default the gap along `direction`
   */
  pageGap?: number;
  /**
   * An item's size. By default each one takes an equal share of the page.
   * `{ aspect }` — width ÷ height, the width being a column's share of the page.
   * `{ width, height }` — fixed, in points. Either way a page is as big as the room,
   * and the items sit at its start.
   */
  card?: { aspect: number } | { width: number; height: number };
}

/**
 * Pages of `columns × rows` items, each page as big as the room, one after
 * another along `direction`, with `pageGap` between a page's items and the next's.
 * The grid snaps to whole pages. Like `gridLayout`,
 * it works every slot, and which ones are in a region, out from the index.
 * Give the grid no start or end inset along its scroll axis: a page is the room.
 */
export function pagedLayout(options: PagedLayoutOptions): ReflowLayout {
  const { direction, columns, rows, card } = options;
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new Error(`pagedLayout: columns and rows must be whole numbers of 1 or more, got ${columns} × ${rows}`);
  }
  if (card && 'width' in card && !(card.width > 0 && card.height > 0)) {
    throw new Error(`pagedLayout: a card's width and height must be above 0, got ${card.width} × ${card.height}`);
  }
  const gap = typeof options.gap === 'number' ? { x: options.gap, y: options.gap } : (options.gap ?? { x: 0, y: 0 });
  const horizontal = direction === 'horizontal';
  const perPage = columns * rows;
  const pageGap = Math.max(options.pageGap ?? (horizontal ? gap.x : gap.y), 0);

  return (data, room) => {
    const count = data.length;
    const stride = horizontal ? room.width : room.height;
    // Half the page gap is left clear at each end of a page, along the way the pages go.
    const lead = { x: horizontal ? pageGap / 2 : 0, y: horizontal ? 0 : pageGap / 2 };
    const space = { width: Math.max(room.width - 2 * lead.x, 0), height: Math.max(room.height - 2 * lead.y, 0) };
    let item: Size;
    if (card && 'width' in card) {
      item = { width: card.width, height: card.height };
    } else {
      const width = Math.max((space.width - (columns - 1) * gap.x) / columns, 0);
      item = card ? { width, height: width / card.aspect } : { width, height: Math.max((space.height - (rows - 1) * gap.y) / rows, 0) };
    }
    const pitch = { x: item.width + gap.x, y: item.height + gap.y };
    const pageCount = Math.ceil(count / perPage);

    const rectOf = (i: number): Rect => {
      const page = Math.floor(i / perPage);
      const k = i % perPage;
      return {
        x: (horizontal ? page * stride : 0) + lead.x + (k % columns) * pitch.x,
        y: (horizontal ? 0 : page * stride) + lead.y + Math.floor(k / columns) * pitch.y,
        ...item,
      };
    };
    const size = count === 0 ? { width: 0, height: 0 } : horizontal ? { width: pageCount * stride, height: room.height } : { width: room.width, height: pageCount * stride };

    return {
      size,
      pages: { count: pageCount, stride, direction, perPage },
      rectOf,
      indicesIn: (region) => {
        const out: number[] = [];
        if (count === 0) return out;
        if (!(pitch.x > 0 && pitch.y > 0 && stride > 0)) {
          for (let i = 0; i < count; i++) if (intersects(rectOf(i), region)) out.push(i);
          return out;
        }
        const lo = horizontal ? region.x0 : region.y0;
        const hi = horizontal ? region.x1 : region.y1;
        const last = Math.min(Math.ceil(hi / stride) - 1, pageCount - 1);
        for (let page = Math.max(Math.floor(lo / stride), 0); page <= last; page++) {
          // The region in this page's own coordinates.
          const shift = page * stride;
          const [c0, c1] = span(region.x0 - (horizontal ? shift : 0) - lead.x, region.x1 - (horizontal ? shift : 0) - lead.x, item.width, pitch.x, columns);
          const [r0, r1] = span(region.y0 - (horizontal ? 0 : shift) - lead.y, region.y1 - (horizontal ? 0 : shift) - lead.y, item.height, pitch.y, rows);
          for (let row = r0; row <= r1; row++) {
            for (let column = c0; column <= c1; column++) {
              const i = page * perPage + row * columns + column;
              if (i < count) out.push(i);
            }
          }
        }
        return out;
      },
    };
  };
}
