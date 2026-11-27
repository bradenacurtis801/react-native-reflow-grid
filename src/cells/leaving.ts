import { useState } from 'react';

/** An item taken out of `data` that stays drawn until it has gone from sight. */
export interface Leaving<T> {
  key: string;
  item: T;
}

/**
 * What's leaving once `data` has replaced `seen`: the items that were in `seen` and aren't in `data` now, and
 * those already on their way out that haven't come back.
 */
export function leavingAfter<T>(
  seen: readonly T[],
  data: readonly T[],
  leaving: readonly Leaving<T>[],
  keyOf: (item: T, index: number) => string,
  /** Whether a key that's gone isn't to be seen going: another item has taken its place, or it has been carried elsewhere. */
  unseen?: (key: string) => boolean,
): Leaving<T>[] {
  const keys = new Set(data.map(keyOf));
  return [
    ...leaving.filter((l) => !keys.has(l.key)),
    ...seen.flatMap((item, i) => {
      const key = keyOf(item, i);
      return keys.has(key) || unseen?.(key) ? [] : [{ key, item }];
    }),
  ];
}

/**
 * Items taken out of `data` stay drawn until they've shrunk away. Worked out as `data` changes, in render:
 * after the commit they'd be gone for a frame.
 *
 * `leavingNow` is what's leaving in this render. When `data` has just changed that's the new list, not
 * `leaving` (the state only has it from the render that follows): the cells of the items just removed must be
 * known as leaving now, or they're taken for ones waiting to be reused, and let go of. `taking` is that case.
 */
export function useLeaving<T>(data: readonly T[], keyOf: (item: T, index: number) => string, unseen?: (key: string) => boolean) {
  const [seen, setSeen] = useState(data);
  const [leaving, setLeaving] = useState<Leaving<T>[]>([]);
  const taking = seen !== data;
  let leavingNow = leaving;
  if (taking) {
    leavingNow = leavingAfter(seen, data, leaving, keyOf, unseen);
    setSeen(data);
    setLeaving(leavingNow);
  }
  return { leaving, leavingNow, taking, setLeaving };
}
