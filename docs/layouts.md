# Layouts

A layout is a function from the items and the container to where each item goes. `gridLayout`, `masonryLayout` and `pagedLayout` come with the grid, and you can write your own. Back to the [README](../README.md).

## `gridLayout(options)`

| Option | Description |
| --- | --- |
| `flow` | `'vertical'` fills a row, then the next below. `'horizontal'` fills a column, then the next beside it. |
| `lines` | Columns (vertical flow) or rows (horizontal). |
| `gap` | A number, or `{ x, y }`. Default `0`. |
| `card` | `{ aspect }` (width ÷ height, default `0.75`), `{ length }` (fixed along the scroll axis), or `{ width, height }` (fixed on both; the grid then scrolls on both axes). |

## `masonryLayout(options)`

Columns of equal width, items of any height: each item goes under the shortest column so far. Or, with `flow: 'horizontal'`, rows of equal height, items of any width, for a grid that scrolls sideways: each item goes after the shortest row so far.

```ts
import { masonryLayout } from 'react-native-reflow-grid';

const layout = useMemo(
  () => masonryLayout<Photo>({ columns: 2, gap: 8, heightOf: (photo, width) => width / photo.aspect }),
  [],
);
```

```ts
// Three rows of photos of any width, scrolling sideways: <ReflowGrid axis="horizontal" ... />
const layout = useMemo(
  () => masonryLayout<Photo>({ flow: 'horizontal', rows: 3, gap: 8, widthOf: (photo, height) => height * photo.aspect }),
  [],
);
```

| Option | Description |
| --- | --- |
| `flow` | `'vertical'` (default): columns, scrolled down. `'horizontal'`: rows, scrolled along (use `axis="horizontal"`). |
| `columns` | Vertical flow: how many columns share the room's width (any whole number of 1 or more). |
| `rows` | Horizontal flow: how many rows share the room's height. |
| `gap` | A number, or `{ x, y }`. Default `0`. |
| `heightOf` | Vertical flow: `(item, width, index) => height`: an item's height, given the width its column gives it. It must depend only on its arguments. |
| `widthOf` | Horizontal flow: `(item, height, index) => width`: an item's width, given the height its row gives it. The same rule. |

The layout remembers its last result: when `data` changes, the items before the first one that differs (by reference) keep their places and `heightOf` (or `widthOf`) isn't asked about them again. Adding at the end, or changing one item far down a long list, costs only what follows. So replace an item to change its height; changing it in place isn't noticed. A change of the container's size across the lines (the width for columns, the height for rows) places everything again. Memoize the layout, as a new one starts with nothing remembered.

## `pagedLayout(options)`

Pages of `columns × rows` cells, each as big as the container, scrolled one page at a time (the grid snaps to them).

```ts
const layout = useMemo(() => pagedLayout({ direction: 'horizontal', columns: 3, rows: 4, gap: 12 }), []);
// <ReflowGrid axis="horizontal" layout={layout} ... />
```

| Option | Description |
| --- | --- |
| `direction` | `'horizontal'`: pages side by side (use `axis="horizontal"`). `'vertical'`: one under another. |
| `columns`, `rows` | Cells in a page; they share the page equally. |
| `gap` | A number, or `{ x, y }`. Default `0`. |
| `pageGap` | Space between one page's cells and the next page's, along `direction`; half is left clear at each end of a page, so the pages' edge cells don't touch while you swipe between them. Default: the `gap` along `direction`. The pages are still a container apart, so snapping is unchanged. |
| `card` | By default each cell takes an equal share of the page. `{ aspect }` (width ÷ height) or `{ width, height }` (fixed) instead; the cells then sit at the start of the page. |

Use no inset along the way it pages. See [Drag to reorder](drag-to-reorder.md) for how dragging behaves between pages.
## Custom layouts

A layout is a function from the items and the container's size to a result that answers two questions, so only what's needed is worked out: where item `i` goes (`rectOf`), and which items meet a region of the content (`indicesIn`, called with what's on screen plus a buffer). `gridLayout` answers both from the index alone, with nothing built per item.

```ts
import { layoutFromRects, type ReflowLayout } from 'react-native-reflow-grid';

// The simple way: build a rect for every item and let `layoutFromRects` answer the questions with a scan.
const stack: ReflowLayout = (data, container) =>
  layoutFromRects(
    data.map((_, i) => ({ x: 0, y: i * 60, width: container.width, height: 56 })),
    { width: container.width, height: data.length * 60 },
  );
```

Write `rectOf` and `indicesIn` yourself when you can work them out without a pass over every item, as `gridLayout` does.
