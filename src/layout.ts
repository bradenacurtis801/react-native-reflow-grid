export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Where `count` items go in a container, and how big the whole of them is. */
export interface ReflowResult {
  /** One per item, in order. */
  rects: Rect[];
  /** What they take up together: what the content view is sized to. */
  size: Size;
}

/**
 * A layout is a function from how many items there are to where each goes.
 * That is all `ReflowGrid` asks of one, so any arrangement works — a grid
 * (`gridLayout`), a stack, a spiral — by being written as one. It sees
 * only the count and the container, not the items, so what it places can't
 * depend on their sizes. It's called
 * again whenever the count or the container changes, and the items glide to
 * their new places.
 */
export type ReflowLayout = (count: number, container: Size) => ReflowResult;

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

/** Items in rows and columns, as `GridLayoutOptions` says. */
export function gridLayout(options: GridLayoutOptions): ReflowLayout {
  const { flow, lines } = options;
  if (!Number.isInteger(lines) || lines < 1) throw new Error(`gridLayout: lines must be a whole number of 1 or more, got ${lines}`);
  const gap = typeof options.gap === 'number' ? { x: options.gap, y: options.gap } : (options.gap ?? { x: 0, y: 0 });
  const card = options.card ?? DEFAULT_CARD;
  if ('width' in card && !(card.width > 0 && card.height > 0)) {
    throw new Error(`gridLayout: a card's width and height must be above 0, got ${card.width} × ${card.height}`);
  }
  const horizontal = flow === 'horizontal';

  return (count, room) => {
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

    const rects = [];
    for (let i = 0; i < count; i++) {
      // Vertical flow: across a row, then down. Horizontal: down a column, then across.
      const column = horizontal ? Math.floor(i / lines) : i % lines;
      const row = horizontal ? i % lines : Math.floor(i / lines);
      rects.push({ x: column * (item.width + gap.x), y: row * (item.height + gap.y), ...item });
    }

    const columns = horizontal ? Math.ceil(count / lines) : lines;
    const rows = horizontal ? lines : Math.ceil(count / lines);
    return {
      rects,
      size: {
        width: count === 0 ? 0 : columns * item.width + (columns - 1) * gap.x,
        height: count === 0 ? 0 : rows * item.height + (rows - 1) * gap.y,
      },
    };
  };
}
