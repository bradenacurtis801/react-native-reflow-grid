import { SlotPool } from '../slots';

const live = () => true;
const none = new Set<string>();
const keys = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `k${from + i}`);

describe('SlotPool', () => {
  it('gives each wanted key a cell of its own', () => {
    const pool = new SlotPool();
    const { slots, stale } = pool.assign(keys(1, 5), none, live);
    expect(new Set(slots).size).toBe(5);
    expect(stale).toEqual([]);
  });

  it('changes nothing when asked again for the same keys', () => {
    const pool = new SlotPool();
    const first = pool.assign(keys(1, 5), none, live);
    expect(pool.assign(keys(1, 5), none, live)).toEqual(first);
  });

  it('gives an item that comes in the cell of one that went out, so nothing is made', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    // k1 leaves the window, k5 enters: k5 takes k1's cell.
    const after = pool.assign(keys(2, 5), none, live);
    expect(after.slots[3]).toBe(before.slots[0]);
    expect(Math.max(...after.slots, ...after.stale.map((s) => s.slot))).toBeLessThan(4);
  });

  it('keeps an item that left in its cell, to draw it as it was', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    const after = pool.assign(keys(2, 4), none, live);
    expect(after.stale).toEqual([{ slot: before.slots[0], key: 'k1' }]);
  });

  it('meets an item that comes back where it left it', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    pool.assign(keys(2, 4), none, live);
    const back = pool.assign(keys(1, 4), none, live);
    expect(back.slots).toEqual(before.slots);
    expect(back.stale).toEqual([]);
  });

  it('reuses the cell that has been out of the window the longest first', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    pool.assign(keys(2, 4), none, live); // k1 out
    pool.assign(keys(3, 4), none, live); // k2 out too, after k1
    const after = pool.assign(keys(3, 5), none, live); // k5 comes in
    expect(after.slots[2]).toBe(before.slots[0]);
  });

  it('gives up the cell of an item that is gone from the data', () => {
    const pool = new SlotPool();
    pool.assign(keys(1, 4), none, live);
    const after = pool.assign(keys(2, 4), none, (key) => key !== 'k1');
    expect(after.stale).toEqual([]);
    expect(pool.slotFor('k1')).toBeUndefined();
  });

  it('keeps a pinned item in its cell, though it is out of the window and gone from the data', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    const after = pool.assign(keys(2, 4), new Set(['k1']), (key) => key !== 'k1');
    expect(pool.slotFor('k1')).toBe(before.slots[0]);
    expect(after.stale).toEqual([]);
  });

  it('does not take a pinned item\'s cell for one that comes in', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    const after = pool.assign(keys(2, 5), new Set(['k1']), live);
    expect(after.slots[3]).not.toBe(before.slots[0]);
  });

  it('lets none wait when asked to discard them, but the ones in the window keep their cells', () => {
    const pool = new SlotPool();
    const before = pool.assign(keys(1, 4), none, live);
    const after = pool.assign(keys(2, 4), none, live, true);
    expect(after.stale).toEqual([]);
    expect(after.slots).toEqual(before.slots.slice(1));
  });

  it('lets the longest-waiting cells go, together, when the window shrinks', () => {
    const pool = new SlotPool();
    pool.assign(keys(1, 20), none, live);
    // Two wanted: 18 wait, over the limit of 6; they go down to 3.
    const after = pool.assign(keys(19, 20), none, live);
    expect(after.stale).toHaveLength(3);
    // The ones kept are the last to have left.
    expect(after.stale.map((s) => s.key).sort()).toEqual(['k16', 'k17', 'k18']);
  });

  it('does not let go of any while few wait', () => {
    const pool = new SlotPool();
    pool.assign(keys(1, 20), none, live);
    const after = pool.assign(keys(5, 20), none, live);
    expect(after.stale).toHaveLength(4);
  });

  it('keeps a scroll along a list to the cells it started with, plus the few that wait', () => {
    const pool = new SlotPool();
    const made = new Set<number>();
    for (let from = 1; from <= 80; from++) {
      const a = pool.assign(keys(from, from + 14), none, live);
      a.slots.forEach((s) => made.add(s));
      a.stale.forEach((s) => made.add(s.slot));
    }
    expect(made.size).toBeLessThanOrEqual(16);
  });
});
