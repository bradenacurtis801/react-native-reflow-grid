# Roadmap

## Native drag and drop

Drag works today through JavaScript (above). Using each platform's own drag-and-drop API (UIKit's on iOS, `DragEvent` on Android) would add what JS can't: items that carry typed payloads other views and apps understand, and drags between apps.

**Architecture**

- **Core stays pure TypeScript** (layout, windowing, reflow animation, preview order, commit), so it keeps working without a dev build.
- **Drivers.** A driver turns platform drag input into `{ phase, location, session }`; the core owns everything visual. Native drivers would ship as an optional add-on, iOS first, then Android. The touch and web adapters that exist are drivers of this kind, and stay as the fallback where no native driver exists.
- **Native delegates can't wait for JS.** The platform's drop callbacks must answer synchronously, so the grid pushes declarative data to native ahead of time (slot rects, payload descriptors, accepted types, a drop-intent policy) and receives asynchronous notifications back (`onDragHover`, `onDrop`, `onReorder`). Until `data` catches up after a drop, the grid keeps its own pending order.

**Joining** (dropping an item onto another to combine them, as into a folder) is opt-in. It's a second drop intent, `{ type: 'into', key }`, beside `{ type: 'insert', index }`.

- **Off, the default:** the whole of every slot means insert, so the others reflow as soon as the finger enters a slot (the hysteresis margin only stops flicker on the line between two slots).
- **On:** a slot that accepts what's being dragged has a center zone as well as an edge band. The edge band inserts and reflows; in the center nothing reflows, and after a dwell the slot highlights and a drop reports `into`. A slot that doesn't accept it is a plain insert slot.
- **Who can join whom is per item, and declarative.** Each item has a descriptor, `{ kind, accepts }`, from a `joinPolicy(item)` prop; a dragged item can join a target when its `kind` is in the target's `accepts`. For several items dragged together, all must be accepted. It's data, not a callback, because a native drop delegate has to answer synchronously, so native evaluates it itself from the descriptors of the visible slots and the dragged items.
- One zone function serves both modes; the only difference is whether a slot has a center zone. The dwell time is one setting for the grid to start with.

**Decisions to make before 1.0** (each would be a breaking change later)

1. **A drag is a session of items, not a key.** *Done:* `onDragStart` and `onReorder` carry a `DragSession`, `{ origin, items: [{ key?, types, local? }] }`, because a drop may carry items that aren't in `data` (another app, another grid) and platform sessions already carry a list of items. The grid still lifts one internal item, so multi-item stacking can follow without a breaking change.
2. **Layouts recompute from the first change.** *Done:* layouts see the data and are queried lazily (`rectOf`, `indicesIn`), so only the visible region, the dragged item and the hover target are evaluated, and `masonryLayout` carries on from the first item that changed instead of placing every item again. Its `indicesIn` still scans every rect; a per-column search is possible if that shows up in a profile.

**Scope**

- **Next:** a configurable long-press and drag-handle regions; checking touch dragging on iOS and Android devices.
- **v1:** reorder inside one grid on iOS through the platform drag session, with typed payloads.
- **v1.x:** joining, lifting several items together, an external drop-zone API (trash, eject).
- **Later:** Android native driver, cross-grid and cross-app polish.
