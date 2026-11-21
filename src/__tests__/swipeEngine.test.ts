import type { Rect } from '../layout';
import { SWIPE_HOLD_MS, type SwipeDirection } from '../swipe';
import { SwipeEngine, type SwipeHost, type SwipeTarget, type SwipeView } from '../swipeEngine';

interface Item {
  id: string;
}

const NO_SCROLL = { x: 0, y: 0 };
const last = (values?: number[]) => values?.[values.length - 1];

/** Two cards side by side, each 200 × 100: `a` at the start, `b` after it. */
function setup(overrides: Partial<SwipeView<Item>> = {}, rects?: Record<string, Rect>) {
  const calls: string[] = [];
  const offsets: Record<string, number[]> = {};
  let clock = 0;
  const timers: { run: () => void; at: number }[] = [];
  const cells = new Set(['a', 'b']);
  const data = new Set(['a', 'b']);
  const swiped: { item: string; direction: SwipeDirection }[] = [];

  const host: SwipeHost = {
    now: () => clock,
    setTimeout: (run, ms) => timers.push({ run, at: clock + ms }),
    hasCell: (key) => cells.has(key),
    setOffset: (key, offset) => {
      (offsets[key] ??= []).push(offset);
    },
    flyOff: (key, to, ms) => calls.push(`fly ${key} ${Math.round(to)} ${Math.round(ms)}`),
    springBack: (key) => calls.push(`back ${key}`),
    swipingChanged: (by) => calls.push(`swiping ${by}`),
    log: () => {},
  };

  const slot: Record<string, Rect> = rects ?? {
    a: { x: 0, y: 0, width: 200, height: 100 },
    b: { x: 220, y: 0, width: 200, height: 100 },
  };
  const targets: SwipeTarget<Item>[] = Object.keys(slot).map((key, index) => ({ key, index, item: { id: key }, rect: slot[key]! }));

  const engine = new SwipeEngine<Item>(host);
  engine.view = {
    enabled: true,
    horizontal: false,
    crossStart: 0,
    viewport: { width: 440, height: 800 },
    allowed: { negative: true, positive: true },
    dragging: false,
    itemAt: (page) => targets.find((t) => page.x >= t.rect.x && page.x < t.rect.x + t.rect.width && page.y >= t.rect.y && page.y < t.rect.y + t.rect.height),
    onSwipe: (item, direction) => {
      swiped.push({ item: item.id, direction });
    },
    inData: (key) => data.has(key),
    ...overrides,
  };

  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers.splice(0).filter((x) => x.at <= clock || (timers.push(x), false))) t.run();
  };
  /** A finger down at `from`, moved `by` along x (or y, for `axis: 'y'`) in `steps`, `stepMs` apart. Not yet lifted. */
  const drag = (id: string, from: { x: number; y: number }, by: number, steps = 10, stepMs = 16, axis: 'x' | 'y' = 'x') => {
    engine.touchDown(id, from, NO_SCROLL);
    for (let i = 1; i <= steps; i++) {
      advance(stepMs);
      const d = (by * i) / steps;
      engine.touchMove(id, axis === 'x' ? { x: from.x + d, y: from.y } : { x: from.x, y: from.y + d });
    }
  };
  return { engine, calls, offsets, advance, drag, swiped, cells, data };
}

const onA = { x: 100, y: 50 };
const onB = { x: 320, y: 50 };

describe('SwipeEngine: following a finger', () => {
  it('moves the item with the finger once it has gone across', () => {
    const t = setup();
    t.drag('f', onA, -60);
    expect(last(t.offsets.a)).toBeCloseTo(-60);
    expect(t.calls).toEqual(['swiping 1']);
  });

  it('does nothing while the finger is within the slop', () => {
    const t = setup();
    t.drag('f', onA, -6, 3);
    expect(t.offsets.a).toBeUndefined();
    expect(t.calls).toEqual([]);
  });

  it('leaves a finger going along the scroll to the scroll', () => {
    const t = setup();
    t.drag('f', onA, 80, 10, 16, 'y');
    expect(t.offsets.a).toBeUndefined();
    expect(t.calls).toEqual([]);
  });

  it('does nothing when swipe is not on', () => {
    const t = setup({ enabled: false });
    t.drag('f', onA, -120);
    expect(t.offsets.a).toBeUndefined();
  });

  it('does nothing while an item is lifted: that is a drag', () => {
    const t = setup({ dragging: true });
    t.drag('f', onA, -120);
    expect(t.offsets.a).toBeUndefined();
  });

  it('does nothing for a finger that went down off every item', () => {
    const t = setup();
    t.drag('f', { x: 430, y: 50 }, -120);
    expect(t.offsets).toEqual({});
  });

  it('does nothing for an item that cannot be swiped', () => {
    const t = setup({ canSwipe: (item) => item.id !== 'a' });
    t.drag('f', onA, -120);
    expect(t.offsets.a).toBeUndefined();
    t.drag('g', onB, -120);
    expect(last(t.offsets.b)).toBeCloseTo(-120);
  });
});

describe('SwipeEngine: letting go', () => {
  it('flies an item off when it has gone far enough, and says which way', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([{ item: 'a', direction: 'left' }]);
    // off the start edge: out by its own size and a margin
    expect(t.calls).toEqual(['swiping 1', 'swiping -1', 'fly a -224 120']);
    expect(t.engine.swiped.get('a')).toBe('left');
  });

  it('says right for an item swiped the other way, and flies it clear of the far edge', () => {
    const t = setup();
    t.drag('f', onB, 100, 10, 100);
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([{ item: 'b', direction: 'right' }]);
    // room 440, slot starts at 220: 220 to the edge, and a margin
    expect(t.calls).toContain('fly b 244 120');
  });

  it('flies away a short swipe that is flicked', () => {
    const t = setup();
    t.drag('f', onA, -40, 4, 16);
    t.engine.touchUp('f');
    expect(t.swiped).toHaveLength(1);
  });

  it('springs back a short, slow swipe, and tells nobody', () => {
    const t = setup();
    t.drag('f', onA, -60, 6, 100);
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([]);
    expect(t.calls).toEqual(['swiping 1', 'swiping -1', 'back a']);
    expect(t.engine.swiped.has('a')).toBe(false);
  });

  it('springs back an item the app keeps by returning false', () => {
    const t = setup({ onSwipe: () => false });
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchUp('f');
    expect(t.calls).toEqual(['swiping 1', 'swiping -1', 'back a']);
    expect(t.engine.swiped.has('a')).toBe(false);
  });

  it('springs back a cancelled swipe, and tells nobody', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchCancel('f');
    expect(t.swiped).toEqual([]);
    expect(t.calls).toEqual(['swiping 1', 'swiping -1', 'back a']);
  });

  it('does nothing for a finger that lifts without having moved', () => {
    const t = setup();
    t.engine.touchDown('f', onA, NO_SCROLL);
    t.engine.touchUp('f');
    expect(t.calls).toEqual([]);
  });

  it('does not fly an item that has no cell', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.cells.delete('a');
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([]);
    expect(t.calls).toEqual(['swiping 1', 'swiping -1']);
  });
});

describe('SwipeEngine: an item that is not taken out of data', () => {
  it('comes back after a moment', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchUp('f');
    t.advance(SWIPE_HOLD_MS - 1);
    expect(t.calls).not.toContain('back a');
    t.advance(2);
    expect(t.calls).toContain('back a');
    expect(t.engine.swiped.has('a')).toBe(false);
  });

  it('stays gone when the app took it out of data, and is forgotten', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchUp('f');
    t.data.delete('a');
    t.advance(SWIPE_HOLD_MS + 1);
    expect(t.calls).not.toContain('back a');
    expect(t.engine.swiped.has('a')).toBe(false);
  });

  it('reads the data as the grid has it by then, not as it was at the release', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.engine.touchUp('f');
    // the grid hands the engine a new view on a render, with the item gone
    t.engine.view = { ...t.engine.view, inData: () => false };
    t.advance(SWIPE_HOLD_MS + 1);
    expect(t.calls).not.toContain('back a');
  });
});

describe('SwipeEngine: the ways an item may go', () => {
  const leftOnly = { negative: true, positive: false };

  it('does not pick an item up when the finger starts the way it may not go', () => {
    const t = setup({ allowed: leftOnly });
    t.drag('f', onA, 120);
    expect(t.offsets.a).toBeUndefined();
    expect(t.calls).toEqual([]);
  });

  it('picks it up the way it may', () => {
    const t = setup({ allowed: leftOnly });
    t.drag('f', onA, -120);
    expect(last(t.offsets.a)).toBeCloseTo(-120);
  });

  it('leaves an item at its slot when the finger turns back the way it may not go', () => {
    const t = setup({ allowed: leftOnly });
    t.engine.touchDown('f', onA, NO_SCROLL);
    let x = onA.x;
    for (let i = 0; i < 6; i++) {
      t.advance(30);
      x -= 20;
      t.engine.touchMove('f', { x, y: onA.y });
    }
    for (let i = 0; i < 14; i++) {
      t.advance(30);
      x += 20;
      t.engine.touchMove('f', { x, y: onA.y });
    }
    const seen = t.offsets.a!;
    expect(Math.min(...seen)).toBe(-120);
    expect(Math.max(...seen)).toBe(0);
    expect(last(seen)).toBe(0);
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([]);
  });
});

describe('SwipeEngine: several fingers', () => {
  it('moves two items at once, each with its own finger', () => {
    const t = setup();
    t.engine.touchDown('f', onA, NO_SCROLL);
    t.engine.touchDown('g', onB, NO_SCROLL);
    for (let i = 1; i <= 10; i++) {
      t.advance(16);
      t.engine.touchMove('f', { x: onA.x - 10 * i, y: onA.y });
      t.engine.touchMove('g', { x: onB.x + 12 * i, y: onB.y });
    }
    expect(last(t.offsets.a)).toBe(-100);
    expect(last(t.offsets.b)).toBe(120);
    expect(t.calls.filter((c) => c === 'swiping 1')).toHaveLength(2);
    t.engine.touchUp('f');
    t.engine.touchUp('g');
    expect(t.swiped.map((s) => s.item).sort()).toEqual(['a', 'b']);
    expect(t.calls.filter((c) => c === 'swiping -1')).toHaveLength(2);
  });

  it('does not let a second finger take an item a finger already has', () => {
    const t = setup();
    t.drag('f', onA, -60, 6, 100);
    t.drag('g', { x: 150, y: 50 }, -100, 10, 100);
    // g is on item a too: it moves nothing
    expect(last(t.offsets.a)).toBeCloseTo(-60);
    expect(t.calls.filter((c) => c === 'swiping 1')).toHaveLength(1);
    t.engine.touchUp('g');
    expect(t.calls.filter((c) => c === 'swiping -1')).toHaveLength(0);
    t.engine.touchUp('f');
    expect(t.calls.filter((c) => c === 'swiping -1')).toHaveLength(1);
  });

  it('keeps the count balanced however the swipes end', () => {
    const t = setup();
    t.drag('f', onA, -100, 10, 100);
    t.drag('g', onB, 100, 10, 100);
    t.engine.touchCancel('f');
    t.engine.touchUp('g');
    const sum = t.calls.reduce((n, c) => (c === 'swiping 1' ? n + 1 : c === 'swiping -1' ? n - 1 : n), 0);
    expect(sum).toBe(0);
  });
});

describe('SwipeEngine: a sideways grid', () => {
  // Cards 100 across, 200 tall, in rows that start 50 in from the top of the grid.
  const rects = { a: { x: 0, y: 0, width: 100, height: 200 }, b: { x: 120, y: 0, width: 100, height: 200 } };

  it('swipes up and down, and says which', () => {
    const t = setup({ horizontal: true, crossStart: 50, viewport: { width: 400, height: 700 } }, rects);
    t.drag('f', { x: 50, y: 100 }, -100, 10, 100, 'y');
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([{ item: 'a', direction: 'up' }]);
  });

  it('flies clear of the top edge, from where the slot starts in the grid', () => {
    const t = setup({ horizontal: true, crossStart: 50, viewport: { width: 400, height: 700 } }, rects);
    t.drag('f', { x: 50, y: 100 }, -100, 10, 100, 'y');
    t.engine.touchUp('f');
    // slot starts 50 (crossStart) down, 200 tall: out by 250 and a margin
    // 174 pt to go at the least speed: 124 ms
    expect(t.calls).toContain('fly a -274 124');
  });

  it('flies clear of the bottom edge going down', () => {
    const t = setup({ horizontal: true, crossStart: 50, viewport: { width: 400, height: 700 } }, rects);
    t.drag('f', { x: 50, y: 100 }, 100, 10, 100, 'y');
    t.engine.touchUp('f');
    expect(t.swiped).toEqual([{ item: 'a', direction: 'down' }]);
    // room 700, slot starts at 50: 650 to the edge, and a margin
    // 574 pt to go: longer than the longest flight, so that
    expect(t.calls).toContain('fly a 674 280');
  });

  it('leaves a finger going along the scroll, sideways, to the scroll', () => {
    const t = setup({ horizontal: true, crossStart: 50 }, rects);
    t.drag('f', { x: 50, y: 100 }, -80, 10, 16, 'x');
    expect(t.offsets.a).toBeUndefined();
  });
});
