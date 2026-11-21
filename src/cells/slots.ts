/** The cells (`slot`s) to draw, and who is in each. */
export interface SlotAssignment {
  /** The slot of each wanted key, in the order given. */
  slots: number[];
  /** Slots still mounted whose item is out of the window: they wait to be reused, and are drawn as they were. */
  stale: { slot: number; key: string }[];
}

/** No fewer than this many cells may wait to be reused. */
const MIN_STALE = 6;

/** How many may wait, for a window of `wanted` cells: more than that go, down to half of it. */
const staleLimit = (wanted: number) => Math.max(MIN_STALE, Math.ceil(wanted / 2));

/**
 * Which cell (slot) shows which item, so cells are reused rather than mounted
 * and unmounted as a scroll moves the window along.
 *
 * A cell is a slot: its views, animated values and effects. An item that
 * comes into the window takes a slot; one that leaves keeps its slot, drawn as
 * it was and out of sight, until an item that comes in needs one. Then the
 * slot that has been out of the window longest goes to it — the item shown in it
 * changes, and nothing is mounted. A scroll that turns round meets its old items
 * still there. Only when more than a half window's worth of slots wait, as when
 * the window shrinks, are the longest-waiting let go, all at once.
 *
 * A key belongs to one slot at a time. `assign` may be called again with the same
 * arguments (a render that is thrown away and run again): it changes nothing then.
 */
export class SlotPool {
  private owner: (string | undefined)[] = [];
  private used: number[] = [];
  private slotOf = new Map<string, number>();
  private tick = 0;

  /** The slot an item is in, if any: a cell that is leaving carries on in the one it was in. */
  slotFor(key: string): number | undefined {
    return this.slotOf.get(key);
  }

  /**
   * `want`: the keys in the window, which must each have a slot. `pinned`: keys
   * that must keep theirs though they're not in the window (a cell shrinking away).
   * `isLive`: whether an item is still in the data; one that isn't, and isn't pinned, gives its slot up.
   * `discardWaiting`: the places the waiting cells were drawn at can't be trusted (the layout, or the items, changed), so none of them waits.
   */
  assign(
    want: readonly string[],
    pinned: ReadonlySet<string>,
    isLive: (key: string) => boolean,
    discardWaiting = false,
  ): SlotAssignment {
    this.tick += 1;
    const wanted = new Set(want);
    const waiting = (key: string | undefined): key is string => key !== undefined && !wanted.has(key) && !pinned.has(key);

    if (discardWaiting) {
      for (let slot = 0; slot < this.owner.length; slot++) if (waiting(this.owner[slot])) this.release(slot);
    }

    for (let slot = 0; slot < this.owner.length; slot++) {
      const key = this.owner[slot];
      if (waiting(key) && !isLive(key)) this.release(slot);
    }

    const missing: string[] = [];
    for (const key of want) {
      const slot = this.slotOf.get(key);
      if (slot === undefined) missing.push(key);
      else this.used[slot] = this.tick;
    }

    if (missing.length > 0) {
      // Reuse a cell that's mounted (out of the window the longest first) before making one.
      const stale: number[] = [];
      const free: number[] = [];
      this.owner.forEach((key, slot) => {
        if (key === undefined) free.push(slot);
        else if (waiting(key)) stale.push(slot);
      });
      stale.sort((a, b) => this.used[a]! - this.used[b]!);
      for (const key of missing) {
        let slot = stale.shift() ?? free.shift();
        if (slot === undefined) {
          slot = this.owner.length;
          this.owner.push(undefined);
          this.used.push(0);
        }
        this.release(slot);
        this.owner[slot] = key;
        this.slotOf.set(key, slot);
        this.used[slot] = this.tick;
      }
    }

    // Too many waiting (the window shrank): let the longest-waiting go, to half the limit, in one go.
    const waits: number[] = [];
    this.owner.forEach((key, slot) => {
      if (waiting(key)) waits.push(slot);
    });
    const limit = staleLimit(want.length);
    if (waits.length > limit) {
      waits.sort((a, b) => this.used[a]! - this.used[b]!);
      for (const slot of waits.slice(0, waits.length - Math.ceil(limit / 2))) this.release(slot);
    }

    return {
      slots: want.map((key) => this.slotOf.get(key)!),
      stale: this.owner.flatMap((key, slot) => (waiting(key) ? [{ slot, key }] : [])),
    };
  }

  private release(slot: number) {
    const key = this.owner[slot];
    if (key !== undefined) this.slotOf.delete(key);
    this.owner[slot] = undefined;
  }
}
