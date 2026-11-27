# Roadmap

## Joining and dragging between grids

*Proposed: none of this is built, and the names may change.* The aim is what a home screen does: drop an app on another to make a folder, hold it over a folder until the folder opens, and drag between the pages, the dock and an open folder. It's built on the JavaScript drag there is today, so it doesn't wait for the native drivers, which would later feed the same core.

### 1. Joining, within one grid

Dropping an item onto another to combine them is opt-in. It's a second drop intent, `{ type: 'into', key }`, beside `{ type: 'insert', index }`.

```tsx
<ReflowGrid
  joinPolicy={(item) => ({ kind: item.kind, accepts: ['app'], zone: ICON_RECT })}
  onJoin={({ session, target }) => combine(session, target)}
  renderItem={(item, { joinTarget }) => <Icon entry={item} highlighted={joinTarget} />}
/>
```

- **Off, the default:** the whole of every slot means insert, as today.
- **On:** a slot whose item accepts what's dragged has a center zone and an edge band around it. In the center nothing reflows, and after a dwell the item is highlighted (`joinTarget`) and a drop reports `into`. A slot that doesn't accept it is a plain insert slot.
- **Who can join whom is declarative.** `joinPolicy(item)` gives `{ kind, accepts, zone? }`; a dragged item can join a target when its `kind` is in the target's `accepts` (all of them, for several). `zone` is the center zone in the item's own space, like a touch region (a home screen's is the icon, not the name under it). It's data, not a callback, because a native drop delegate has to answer synchronously.
- **The edge band waits too.** Inserting at once would move the target away from a finger on its way to the center. So in a slot that can be joined, the others make room only after the finger has rested in the edge band (about 200 ms). Zones belong to slots, which don't move; the item to join is whichever the preview shows in that slot.
- **`onJoin` changes `data`:** it takes the dragged item out and updates the target. If the combined item has a new key (two apps become a folder), `onJoin` returns it, and the new item takes the target's cell without one shrinking away and another growing in. The dragged item goes into the target rather than shrinking where it was.

### 2. Dragging between grids

```tsx
<ReflowDragProvider onDragEnd={…}>
  <ReflowGrid dragGroup="home" onInsert={…} onRemove={…} />
  <ReflowGrid dragGroup="home" onInsert={…} onRemove={…} dropPolicy={{ accepts: ['app', 'folder'], capacity: 4 }} />
</ReflowDragProvider>
```

- **One drag, owned by the provider.** Today a `DragEngine` per grid both follows the pointer and works out where the item lands. It splits in two: the session (the pointer, what's lifted, the dwell), one per provider, and a target per grid (hit testing, preview order, edge scroll and page turns). A grid with no provider makes its own, and behaves as it does today.
- **A layer above the grids.** The provider draws the lifted item over everything inside it, so it passes over any grid or overlay. (A native modal would still be above it.) The layer calls the source grid's `renderItem` again, so state held inside an item doesn't carry over: a playing video starts again.
- **Which grid.** Grids in the same `dragGroup` exchange items. Where two overlap (a folder open over the pages), `dropPriority` decides, and `dropEnabled={false}` takes a grid out. `dropPolicy` is declarative for the same reason `joinPolicy` is: the kinds a grid accepts, and how many items it holds.
- **The preview.** The grid under the pointer opens a gap for the item, laying it out with its own `layout` (so keys are unique across a group, and its layout must cope with the item). The source closes up.
- **The drop.** The item springs to its slot in the target, then the target draws it. The target's `onInsert({ session, index })` and the source's `onRemove({ session, keys })` are called together, so the app changes both in one render. A drop nowhere puts it back. `onReorder` stays what it is: a drop in the grid the item came from.

### 3. Folders that open under a drag

- **`onSpringLoad({ key })`:** the pointer has stayed in a joinable item's center well past the highlight (about 700 ms, as a page turn takes). The app opens the folder; its grid registers with the provider as it appears, and the drag goes on into it.
- **`onDragExit()`:** the pointer has stayed outside a grid for a moment. The app closes the folder, and the drag goes on in the pages.
- **The source stays mounted until the drop.** The touch belongs to the view it began in. An app dragged out of a folder needs that folder's grid kept mounted, hidden, until `onDragEnd`. *To prove on a device first: that the touch goes on while its view is hidden or covered.*

### To decide

1. **Insert delay in joinable slots** (above). Proposed: yes, and only there, so plain reordering stays immediate.
2. **What the lifted item looks like over another grid.** An icon from the pages has a name and one in the dock doesn't. Proposed: the source's `renderItem` throughout, the target's from the drop; later, perhaps, a flag in `renderItem`'s info for the grid it's over.
3. **`dragOverflow`** (not yet released). With a provider the layer does its job. Either it ships for the single grid that wants its item's state kept, or it's dropped before the next release and a single grid uses a provider.
4. **Web with a mouse.** The browser's drag and drop feeds the same session, but its drag image can't change size or open folders smoothly. Proposed: touch first.

## Native drag and drop

Drag works today through JavaScript (above). Using each platform's own drag-and-drop API (UIKit's on iOS, `DragEvent` on Android) would add what JS can't: items that carry typed payloads other views and apps understand, and drags between apps.

**Architecture**

- **Core stays pure TypeScript** (layout, windowing, reflow animation, preview order, commit), so it keeps working without a dev build.
- **Drivers.** A driver turns platform drag input into `{ phase, location, session }`; the core owns everything visual. Native drivers would ship as an optional add-on, iOS first, then Android. The touch and web adapters that exist are drivers of this kind, and stay as the fallback where no native driver exists.
- **Native delegates can't wait for JS.** The platform's drop callbacks must answer synchronously, so the grid pushes declarative data to native ahead of time (slot rects, payload descriptors, accepted types, a drop-intent policy) and receives asynchronous notifications back (`onDragHover`, `onDrop`, `onReorder`). Until `data` catches up after a drop, the grid keeps its own pending order.

**Decisions to make before 1.0** (each would be a breaking change later)

1. **A drag is a session of items, not a key.** *Done:* `onDragStart` and `onReorder` carry a `DragSession`, `{ origin, items: [{ key?, types, local? }] }`, because a drop may carry items that aren't in `data` (another app, another grid) and platform sessions already carry a list of items. The grid still lifts one internal item, so multi-item stacking can follow without a breaking change.
2. **Layouts recompute from the first change.** *Done:* layouts see the data and are queried lazily (`rectOf`, `indicesIn`), so only the visible region, the dragged item and the hover target are evaluated, and `masonryLayout` carries on from the first item that changed instead of placing every item again. Its `indicesIn` still scans every rect; a per-column search is possible if that shows up in a profile.

**Scope**

- **Next:** joining within one grid, then dragging between grids, then folders that open under a drag (above), each tried in the home screen example; a configurable long-press and drag-handle regions; checking touch dragging on iOS and Android devices.
- **v1:** reorder inside one grid on iOS through the platform drag session, with typed payloads.
- **v1.x:** lifting several items together, an external drop-zone API (trash, eject).
- **Later:** Android native driver, drags between apps.
