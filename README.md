# react-native-reflow-grid

A grid for React Native where **items glide to their new places** when one is added, removed, or the layout changes — like a collection view's delete animation — while **only the items on screen are mounted**.

- **Windowed.** Off-screen items exist only as slots in the layout; just what's visible (plus a buffer) is mounted.
- **Animated reflow.** Remove an item and it shrinks away while the rest spring into the gap. Change the layout (3 columns → 1, vertical → horizontal) and everything glides.
- **Pluggable layouts.** A layout is just `(count, container) => { rects, size }`. `gridLayout` covers grids, lists and strips; write your own for any arrangement that depends only on the item count and the container's size (layouts that depend on item sizes, like masonry, are planned — see the roadmap).
- **Reliable multi-touch.** Presses are decided by the grid, not by per-item `Pressable`, so a second finger's tap isn't dropped while another finger holds the responder.
- Vertical, horizontal, or two-axis scrolling. iOS, Android and web.

Built on `react-native-reanimated` v4 and `react-native-worklets`. Pure TypeScript — no native code.

## Demo

| Columns | Rows |
| --- | --- |
| ![Columns layout](demo/col-layout.gif) | ![Rows layout](demo/row-layout.gif) |

## Install

```sh
npm install react-native-reflow-grid react-native-reanimated react-native-worklets
```

## Usage

```tsx
import { gridLayout, ReflowGrid } from 'react-native-reflow-grid';

const layout = useMemo(() => gridLayout({ flow: 'vertical', lines: 3, gap: 12 }), []);

<ReflowGrid
  style={{ flex: 1 }}
  data={items}
  layout={layout}
  keyExtractor={(item) => item.id}
  renderItem={(item) => <Tile item={item} />}
  touchRegions={(item, { size }) => [
    { key: 'remove', rect: { x: size.width - 40, y: 0, width: 40, height: 40 }, onPress: () => remove(item.id) },
  ]}
/>
```

`renderItem` draws; it takes no touches. Pressable parts are declared in `touchRegions` (in the item's own space), and the grid fires `onPress` when a finger that went down inside one lifts without having moved.

Memoize `layout` and `touchRegions`: a new function lays everything out again.

### `gridLayout(options)`

| Option | Description |
| --- | --- |
| `flow` | `'vertical'` fills a row, then the next below. `'horizontal'` fills a column, then the next beside it. |
| `lines` | Columns (vertical flow) or rows (horizontal). |
| `gap` | A number, or `{ x, y }`. Default `0`. |
| `card` | `{ aspect }` (width ÷ height, default `0.75`), `{ length }` (fixed along the scroll axis), or `{ width, height }` (fixed on both; the grid then scrolls on both axes). |

### `<ReflowGrid>` props

| Prop | Description |
| --- | --- |
| `data`, `keyExtractor`, `renderItem` | As in a list. Keys decide who stays, enters and leaves. |
| `layout` | A `ReflowLayout`. |
| `touchRegions` | Pressable parts of an item. |
| `axis` | `'vertical'` (default), `'horizontal'`, or `'both'`. |
| `startInset`, `endInset` | Space the scrolled content must clear at the start/end of the scroll axis (e.g. a header and a tab bar). Content scrolls beneath and rests clear. Default `0`. |
| `crossStartInset`, `crossEndInset` | For horizontal grids: space rows clear at the top and bottom. |
| `onMounted` | Called with how many cells are mounted after each change. |

### Custom layouts

```ts
import type { ReflowLayout } from 'react-native-reflow-grid';

const stack: ReflowLayout = (count, container) => ({
  rects: Array.from({ length: count }, (_, i) => ({ x: 0, y: i * 60, width: container.width, height: 56 })),
  size: { width: container.width, height: count * 60 },
});
```

## Example

A runnable Expo app in [`example/`](example): switch between 3 columns, a list, one or two rows, and a fixed-size two-axis grid; add or remove tiles (tap the ✕, with as many fingers as you like); add 300 and watch the mounted count stay small.

```sh
cd example
npm install
npx expo install --fix
npx expo run:ios   # or run:android — reanimated needs a dev build, not Expo Go
```

## Roadmap

### Drag and drop

Drag and drop will use each platform's own drag-and-drop API (UIKit's drag and drop on iOS, `DragEvent` on Android, HTML5 drag and drop on web), so items can carry typed payloads that other views and apps understand. It will feel like `UICollectionView`'s interactive movement: press and hold an item to lift it, drag it, the others glide aside to make room, drop it and the new order is reported back. The grid stays controlled — you update `data`.

**Architecture**

- **Core stays pure TypeScript** (layout, windowing, reflow animation, preview order, commit), so it keeps working without a dev build.
- **Drivers.** A driver turns platform drag input into `{ phase, location, session }`; the core owns everything visual. Native drivers ship as an optional add-on, iOS first, then web, then Android. A JS-gesture driver may follow as a fallback for in-grid reorder where no native driver exists.
- **Native delegates can't wait for JS.** The platform's drop callbacks must answer synchronously, so the grid pushes declarative data to native ahead of time (slot rects, payload descriptors, accepted types, a drop-intent policy) and receives asynchronous notifications back (`onDragHover`, `onDrop`, `onReorder`). Until `data` catches up after a drop, the grid keeps its own pending order.

**Decisions to make before 1.0** (each would be a breaking change later)

1. **Layouts see the data and are queried lazily.** `layout(data, container)` instead of `layout(count, container)`, so layouts can depend on item sizes (masonry, text cards). It returns a query object — `{ size, rectOf(i), indicesIn(window) }` — rather than an array of every rect, so only the visible window, the dragged item and the hover target are ever evaluated, and native drivers only receive those rects. `gridLayout` computes these analytically; data-aware layouts cache and recompute from the first changed index. A drag preview is the layout of the reordered data, hit-tested against the layout without the dragged item (with hysteresis) so it can't oscillate under the finger. A built-in `masonryLayout` will show the pattern.
2. **A drag is a session of items, not a key.** `{ origin: 'internal' | 'external', items: [{ key?, types, local? }] }`: a drop may carry items that aren't in `data` (another app, another grid), and platform sessions already carry a list of items. v1 behavior caps a drag at one internal item, so multi-item stacking can follow without a breaking change.

**Scope**

- **v1:** reorder inside one grid on iOS through the platform drag session, with typed payloads. Drag lifecycle callbacks and a `dragging` flag in `renderItem`; a configurable long-press and drag-handle regions; auto-scroll near the edges; per-item opt-out (like `canMoveItemAt`).
- **v1.x:** an `{ type: 'into', key }` drop intent with a dwell time (folders, combine), multi-item sessions, an external drop-zone API (trash, eject), web driver.
- **Later:** Android driver, cross-grid and cross-app polish, paging.

## License

MIT
