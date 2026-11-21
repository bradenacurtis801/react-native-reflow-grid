import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { DragEngine, type DragHost } from './dragEngine';

const host: DragHost = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * The drag engine, for a grid: the engine itself (which the grid gives its
 * `view` to on every render, and feeds its pointer events), and what to draw
 * from it. `items` is `data` in the order to show.
 */
export function useDragReorder<T>(data: readonly T[]) {
  const [engine] = useState(() => new DragEngine<T>(host));
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  useEffect(() => () => engine.dispose(), [engine]);

  const order = engine.order(data);
  const items = useMemo(() => engine.itemsFor(data, order), [engine, data, order]);
  const draggedKeys = useMemo(() => new Set(snap.drag?.dragged), [snap.drag?.dragged]);
  // The index of the item a finger has lifted, which is drawn wherever the finger is.
  const lifted = snap.drag && snap.floating ? snap.drag.preview.indexOf(snap.drag.dragged[0]!) : -1;

  return { engine, snap, items, draggedKeys, lifted };
}
