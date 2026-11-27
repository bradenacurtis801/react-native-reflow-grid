# react-native-reflow-grid

[![npm](https://img.shields.io/npm/v/react-native-reflow-grid)](https://www.npmjs.com/package/react-native-reflow-grid)
[![license](https://img.shields.io/npm/l/react-native-reflow-grid)](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/LICENSE)

A grid for React Native where **items glide to their new places** when one is added, removed, reordered, or the layout changes — in the spirit of a collection view's updates and Safari's tab overview — while **only the items on screen are mounted**.

- **Windowed.** Off-screen items exist only as slots in the layout; just what's visible (plus a buffer) is mounted.
- **Animated reflow.** Remove an item and it shrinks away while the rest spring into the gap. Change the layout (3 columns → 1, vertical → horizontal) and everything glides.
- **Pluggable layouts.** A layout is just `(data, container) => { size, rectOf, indicesIn }`: it sees the items, so it can depend on their sizes. `gridLayout` covers grids, lists and strips, `masonryLayout` columns (or, scrolling sideways, rows) of items of any size; write your own for anything else (see [Layouts](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/layouts.md)).
- **Drag to reorder.** Hold an item (or drag it with a mouse on web) and the others glide aside to make room. Dragging scrolls at the edges and turns pages. See [Drag to reorder](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/drag-to-reorder.md).
- **Paged layouts.** `pagedLayout` snaps to pages, with page dots you can tap or scrub, as in a home screen.
- **Reliable multi-touch.** Presses are decided by the grid, not by per-item `Pressable`, so a second finger's tap isn't dropped while another finger holds the responder.
- Optional haptic feedback (through `expo-haptics`), reduce-motion support, and vertical, horizontal or two-axis scrolling. iOS, Android and web.

Built on `react-native-reanimated` v4 and `react-native-worklets`. Pure TypeScript — no native code.


## Demo

| Columns | Rows |
| --- | --- |
| ![Columns layout](https://raw.githubusercontent.com/bradenacurtis801/react-native-reflow-grid/main/demo/col-layout.gif) | ![Rows layout](https://raw.githubusercontent.com/bradenacurtis801/react-native-reflow-grid/main/demo/row-layout.gif) |

Drag to reorder, across arrangements:

| 3 columns | 1 column | Masonry |
| --- | --- | --- |
| ![Dragging in 3 columns](https://raw.githubusercontent.com/bradenacurtis801/react-native-reflow-grid/main/demo/reflow-drag-3cols.gif) | ![Dragging in 1 column](https://raw.githubusercontent.com/bradenacurtis801/react-native-reflow-grid/main/demo/reflow-drag-1col.gif) | ![Dragging in masonry](https://raw.githubusercontent.com/bradenacurtis801/react-native-reflow-grid/main/demo/reflow-drag-masonry.gif) |

More demos: [paging](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/drag-to-reorder.md), and real content in the [examples](#examples).

## Install

```sh
npm install react-native-reflow-grid react-native-reanimated react-native-worklets
```

For haptic feedback while dragging, also have [`expo-haptics`](https://docs.expo.dev/versions/latest/sdk/haptics/) (`npx expo install expo-haptics`). It's optional: the grid uses it when it's there, and an app without it bundles and runs as before.

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

`renderItem` draws; it takes no touches. Keep it stable: define it outside the component, or wrap it in `useCallback`. A new function on every render makes every mounted item draw again each time your component renders, which is most of the cost of a removal in a long list of heavy items. It's given `{ index, size, dragging, joinTarget }`; `dragging` is true for an item being dragged (its slot also dims), and `joinTarget` for one a drop would join the dragged item to. Pressable parts are declared in `touchRegions` (in the item's own space), and the grid fires `onPress` when a finger that went down inside one lifts without having moved.

Memoize `layout` and `touchRegions`: a new function lays everything out again.

## Layouts

A layout says where each item goes. Three come with the grid, and a layout is a plain function, so you can write your own.

| Layout | For |
| --- | --- |
| `gridLayout` | Grids, lists and strips: equal cells, in rows or columns, scrolling either way, or on both axes with a fixed cell size. |
| `masonryLayout` | Items of different sizes: columns of equal width and any height, or, with `flow: 'horizontal'`, rows of equal height and any width. |
| `pagedLayout` | Pages of cells that snap, vertically or horizontally, with page dots. |

```ts
const layout = useMemo(() => masonryLayout<Photo>({ columns: 2, gap: 8, heightOf: (photo, width) => width / photo.aspect }), []);
```

Every option, and how to write your own, is in [docs/layouts.md](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/layouts.md).

## `<ReflowGrid>` props

| Prop | Description |
| --- | --- |
| `data`, `keyExtractor`, `renderItem` | As in a list. Keys decide who stays, enters and leaves. |
| `settleDelay`, `renderPlaceholder` | A cell that's given another item (it scrolled into view, or you jumped) calls `renderItem` only once it has kept that item for `settleDelay` ms (default `150`; `0` draws at once). Until then it shows `renderPlaceholder` (nothing by default; keep it cheap). In a fast scroll or a drag of the scroll bar the cells get other items faster than anyone sees them, and drawing each one (an image asking to load, a video player) is what slows the scroll: a cell that doesn't hold its item this long is never drawn. The first draw of a cell, and a lifted or leaving item, aren't held back. |
| `layout` | A `ReflowLayout` (see [Layouts](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/layouts.md)). Memoize it. |
| `touchRegions` | Pressable parts of an item. |
| `axis` | `'vertical'` (default), `'horizontal'`, or `'both'`. |
| `initialSize` | `{ width, height }` the grid is going to be, if known: it draws its cells in its first render instead of after layout. For a grid that appears in an animation, such as an opening folder. |
| `scrollEnabled` | `false`: a finger can't scroll the grid, and it doesn't bounce, for items that all fit and should stay put (a dock). Default `true`. |
| `startInset`, `endInset` | Space the scrolled content must clear at the start/end of the scroll axis (e.g. a header and a tab bar). Content scrolls beneath and rests clear. Default `0`. |
| `crossStartInset`, `crossEndInset` | For horizontal grids: space rows clear at the top and bottom. |
| `reduceMotion` | `ReduceMotion.System` (default) jumps animations to their end when the device's reduce-motion setting is on, and so does a page turn during a drag; `ReduceMotion.Never` always animates (on web the grid animates the page turn itself, since the browser's own smooth scrolling is switched off by that setting). |
| `onReorder` | Turns on drag to reorder. On web a mouse drags through the browser's own drag and drop; a finger, on any platform, holds on an item for a moment to lift it, and the item then follows the finger *(touch is new, and so far only tried in a browser, not on a device)*. Called on a drop that changed the order with `{ keys, moved, from, to }`: the new order of the keys. Put `data` in that order; the grid shows the new order meanwhile, so a `data` that follows a moment later doesn't flicker. |
| `canDrag` | `(item, index) => boolean`: whether an item can be dragged. Default: all can. |
| `onSwipe` | Turns on swipe to remove (see [Swipe to remove](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/swipe-to-remove.md)): `(item, direction) => boolean \| void`. Called when an item is swiped away; take it out of `data`, or return `false` to keep it. |
| `canSwipe` | `(item, index) => boolean`: whether an item can be swiped. Default: all can. |
| `swipeDirections` | The ways an item may be swiped: `'left'` and `'right'` in a vertical grid, `'up'` and `'down'` in a horizontal one. Default: either way. An item can't be pulled a way that isn't listed. |
| `pageIndicator` | For a paged layout: dots, one per page and lit for the one on screen, shown where the scroll indicator along the pages would be (the bottom edge for pages side by side, the right edge for pages one under another), in place of it. `{ color, activeColor, size, spacing, maxDots, scrub }` style them; the colours default to light dots on a dark screen and dark on a light one. The dots follow the swipe: as you drag towards the next page the dot you're leaving shrinks and dims while the next one grows and brightens, in step with your finger. With more pages than `maxDots` (7) the row slides along with the swipe when the page on screen reaches its end, the dots at its ends shrinking to say there are more. **Tap a dot** to go to its page (an animated scroll when it's next door, at once when it's further). **Drag along the dots to scrub** through the pages: movement is relative to where you grabbed, and it goes by how fast you drag, as scrubbing a video does. Slowly, it's a page for every dot's width, so the dots follow your finger and you can stop on any page; flick, and a drag across the screen goes through all of them. A label (`27 / 52`) says where you are. The dots sit on a bigger touch area than they show, and touches there don't reach the grid beneath. `scrub: false` makes them display only. `false`: no dots, and the scroll indicator stays. Default `true`. |
| `haptics` | Feedback for the grid's moments. **On by default**: with `expo-haptics` installed the grid taps when an item is lifted (medium), taps lightly as it moves to another slot and on a drop that changed the order, and ticks (the lightest feedback) when a page turns during a drag or you scrub the page dots. Without `expo-haptics`, and on web, it does nothing. `false` turns it off; a function `(event) => void` gets each moment (`'lift' \| 'move' \| 'join' \| 'drop' \| 'pageTurn' \| 'scrub'`) to give feedback with whatever you use. The frequent ones (`move`, `scrub`) are limited to one every 60 / 50 ms. |
| `joinPolicy`, `onJoin` | Dropping an item onto another to combine them, as into a folder. `joinPolicy(item, info)` gives `{ kind, accepts, zone? }`; an item held on one that accepts it makes that one the `joinTarget` (in `renderItem`'s info), and the drop calls `onJoin({ session, dragged, target })`. See [Joining](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/drag-to-reorder.md#joining). |
| `onSpringLoad`, `onDragExit`, `dragExitDelay`, `continuesDrag` | A drag held on a `joinTarget` asks for it to be opened, and one held outside a grid asks to leave it; a grid with `continuesDrag` takes the drag over. They need a `<ReflowDragProvider>` around the grids. See [Opening under a drag](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/drag-to-reorder.md#opening-under-a-drag). |
| `dragOverflow` | `'visible'` lets an item lifted by a finger be drawn outside the grid, from the lift until it has settled after the drop. Cells just past the grid's edges show then too. Default `'hidden'`. |
| `onDragStart` | Called with the drag's `DragSession` (what was lifted) when a drag begins. |
| `onMounted` | Called with how many cells are mounted after each change. |
| `onScroll` | Called as the grid scrolls, with `{ x, y }`: how far it has scrolled from where it rests (`0, 0` at the start, whatever the insets and platform). It runs on the JS thread on each scroll event, so keep it cheap. To tell what's on screen, run your `layout` on your data and look up the items at that offset. |

## Guides

- [Layouts](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/layouts.md): `gridLayout`, `masonryLayout`, `pagedLayout`, and writing your own.
- [Drag to reorder](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/drag-to-reorder.md): `onReorder`, how dragging behaves, auto-scroll and paging.
- [Swipe to remove](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/docs/swipe-to-remove.md): `onSwipe`, directions, live progress.
- [Roadmap](https://github.com/bradenacurtis801/react-native-reflow-grid/blob/main/ROADMAP.md): native drag and drop, and what's decided before 1.0.

## Examples

Three small Expo apps in [`example/`](example), each on its own, each with its own README:

| Example | Shows |
| --- | --- |
| [`tiles`](https://github.com/bradenacurtis801/react-native-reflow-grid/tree/main/example/tiles) | The grid itself: every layout, drag to reorder, add and remove, and the mounted count staying small. |
| [`photos`](https://github.com/bradenacurtis801/react-native-reflow-grid/tree/main/example/photos) | Real content: remote photos in 2 to 4 columns or rows, and a grid of playing videos. |
| [`safari`](https://github.com/bradenacurtis801/react-native-reflow-grid/tree/main/example/safari) | Safari's tab overview: tap a card and its page grows to fill the screen, with glass bars. |

```sh
cd example/tiles   # or photos, or safari
npm install
npx expo install --fix
npx expo run:ios   # or run:android: reanimated needs a dev build, not Expo Go
```

## License

MIT
