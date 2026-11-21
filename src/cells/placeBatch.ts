import { Platform } from 'react-native';
import { scheduleOnUI } from 'react-native-worklets';

import { now, perfLog, perfOn } from '../support/perfLog';
import type { CellValues } from './ReflowCell';

/** Where a cell reused for another item goes: at its place at once, at rest. */
export interface Placement {
  v: CellValues;
  x: number;
  y: number;
  w: number;
  h: number;
  /** What the slot is dimmed to: 1 unless an item is being dragged from it. */
  dim: number;
}

function apply(batch: Placement[]) {
  'worklet';
  for (let i = 0; i < batch.length; i++) {
    const { v, x, y, w, h, dim } = batch[i]!;
    v.swipe.value = 0;
    v.x.value = x;
    v.y.value = y;
    v.w.value = w;
    v.h.value = h;
    v.lifted.value = 0;
    v.dim.value = dim;
    v.scale.value = 1;
    v.opacity.value = 1;
  }
}

let queue: Placement[] = [];
let waiting = false;

/**
 * Puts a reused cell at its place. Setting a shared value from the JS thread is a trip to the UI thread of its own, and a cell
 * moved to another item sets nine: a jump that reuses every cell made over two hundred, which took most of the render. So the
 * placements of one commit are collected and sent in one, once the cells' effects have all run.
 */
export function placeAtOnce(p: Placement) {
  if (Platform.OS === 'web') {
    // Shared values are plain JS here and set at once: there's no thread to cross, and a batch would only wait for the next frame.
    const { v, x, y, w, h, dim } = p;
    v.swipe.set(0);
    v.x.set(x);
    v.y.set(y);
    v.w.set(w);
    v.h.set(h);
    v.lifted.set(0);
    v.dim.set(dim);
    v.scale.set(1);
    v.opacity.set(1);
    return;
  }
  queue.push(p);
  if (waiting) return;
  waiting = true;
  void Promise.resolve().then(() => {
    waiting = false;
    const batch = queue;
    queue = [];
    const at = perfOn() ? now() : 0;
    scheduleOnUI(apply, batch);
    if (perfOn()) perfLog(`placed ${batch.length} reused cells in one UI call: ${(now() - at).toFixed(1)}ms`);
  });
}
