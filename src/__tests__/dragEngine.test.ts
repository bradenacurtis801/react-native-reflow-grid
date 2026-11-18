import { DragEngine, HOLD_MS, LONG_PRESS_MS, PAGE_DWELL_MS, PAGE_TURN_MS, SLOP, type DragHost, type DragView, type Offset } from '../dragEngine';
import { gridLayout, pagedLayout, type ReflowLayout } from '../layout';

/** A clock the test turns by hand: timers and frames run when it's advanced. */
function fakeHost() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, (time: number) => void>();
  const host: DragHost = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    requestFrame: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => void frames.delete(id),
  };
  /** Moves time on by `ms`, running whatever falls due, a 16ms frame at a time. */
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(now + 16, end);
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.callback();
        }
      }
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(now);
      }
    }
  };
  return { host, advance, pendingFrames: () => frames.size, pendingTimers: () => timers.size };
}

interface Options {
  count?: number;
  layout?: ReflowLayout;
  room?: { width: number; height: number };
  offset?: Offset;
  axis?: DragView<number>['axis'];
  inset?: DragView<number>['inset'];
  web?: boolean;
  instant?: boolean;
  canDrag?: (item: number, index: number) => boolean;
  enabled?: boolean;
}

/** An engine on a grid of `count` numbers, with every call it makes of the grid recorded. */
function setup({ count = 12, layout, room = { width: 320, height: 300 }, offset = { x: 0, y: 0 }, axis = 'vertical', web = false, instant = false, canDrag, enabled = true, inset }: Options = {}) {
  const { host, advance, pendingFrames, pendingTimers } = fakeHost();
  const engine = new DragEngine<number>(host);
  const data = Array.from({ length: count }, (_, i) => i);
  const arrange = layout ?? gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 1 } });
  const state = { offset: { ...offset } };
  const calls = {
    scrollTo: [] as { to: Offset; animated: boolean }[],
    track: [] as Offset[],
    finger: [] as { x: number; y: number }[],
    grabs: [] as { x: number; y: number }[],
    reorders: [] as unknown[],
    started: [] as (readonly string[])[],
    lifted: [] as string[],
  };
  const view: DragView<number> = {
    data,
    items: data,
    keyOf: (n) => String(n),
    canDrag,
    enabled,
    placed: arrange(data, room),
    viewport: room,
    axis,
    inset: inset ?? { x: { start: 0, end: 0 }, y: { start: 0, end: 0 } },
    offset: () => state.offset,
    // The test's pages are the content: no origin, no insets.
    toContent: (p) => ({ x: p.x + state.offset.x, y: p.y + state.offset.y }),
    toRoot: (p) => p,
    scrollTo: (to, animated) => {
      calls.scrollTo.push({ to, animated });
      // The scroll view reports the position it's at: the engine's own `track` when it moved it.
      state.offset = { ...to };
    },
    track: (to) => {
      calls.track.push(to);
      state.offset = { ...to };
    },
    setFinger: (point, grab) => {
      calls.finger.push(point);
      if (grab) calls.grabs.push(grab);
    },
    instant,
    web,
    onReorder: (result) => calls.reorders.push(result),
    onDragStart: (keys) => calls.started.push(keys),
    onLift: (id) => calls.lifted.push(id),
  };
  engine.view = view;
  return { engine, view, data, calls, advance, pendingFrames, pendingTimers, state };
}

// 3 columns of 100 × 100 cards in a 320-wide room with 10pt gaps: item i is at (110 × column, 110 × row).
const centre = (i: number) => ({ x: (i % 3) * 110 + 50, y: Math.floor(i / 3) * 110 + 50 });

describe('a finger', () => {
  it('lifts an item it is held still on', () => {
    const { engine, calls, advance } = setup();
    engine.touchDown('a', centre(4));
    expect(engine.dragging).toBe(false);
    advance(LONG_PRESS_MS - 20);
    expect(engine.dragging).toBe(false);
    advance(40);
    const { drag, floating } = engine.getSnapshot();
    expect(drag?.dragged).toEqual(['4']);
    expect(floating).toBe(true);
    expect(calls.started).toEqual([['4']]);
    expect(calls.lifted).toEqual(['a']);
    // It holds the item where the finger is on it: 50 across and down.
    expect(calls.grabs).toEqual([{ x: 50, y: 50 }]);
    expect(calls.finger[0]).toEqual(centre(4));
  });

  it('is scrolling, not lifting, when it moves before the hold is up', () => {
    const { engine, advance, pendingTimers } = setup();
    engine.touchDown('a', centre(4));
    advance(100);
    engine.touchMove('a', { x: centre(4).x, y: centre(4).y + SLOP + 1 });
    advance(LONG_PRESS_MS * 2);
    expect(engine.dragging).toBe(false);
    expect(pendingTimers()).toBe(0);
  });

  it('still lifts after a wobble smaller than the slop', () => {
    const { engine, advance } = setup();
    engine.touchDown('a', centre(4));
    engine.touchMove('a', { x: centre(4).x + SLOP - 1, y: centre(4).y });
    advance(LONG_PRESS_MS + 20);
    expect(engine.dragging).toBe(true);
  });

  it('lifts nothing in a gap, or when the item cannot be dragged, or when drag is off', () => {
    const gap = setup();
    gap.engine.touchDown('a', { x: 105, y: 50 });
    gap.advance(LONG_PRESS_MS + 20);
    expect(gap.engine.dragging).toBe(false);

    const no = setup({ canDrag: (n) => n !== 4 });
    no.engine.touchDown('a', centre(4));
    no.advance(LONG_PRESS_MS + 20);
    expect(no.engine.dragging).toBe(false);

    const off = setup({ enabled: false });
    off.engine.touchDown('a', centre(4));
    expect(off.pendingTimers()).toBe(0);
  });

  it('reorders as the item is dragged, and reports the new order on a drop', () => {
    const { engine, calls, advance } = setup();
    engine.touchDown('a', centre(4));
    advance(LONG_PRESS_MS + 20);
    engine.touchMove('a', centre(7));
    expect(engine.getSnapshot().drag?.preview).toEqual(['0', '1', '2', '3', '5', '6', '7', '4', '8', '9', '10', '11']);
    // The lifted item follows the finger.
    expect(calls.finger[calls.finger.length - 1]).toEqual(centre(7));
    engine.touchUp('a');
    expect(calls.reorders).toEqual([{ keys: ['0', '1', '2', '3', '5', '6', '7', '4', '8', '9', '10', '11'], moved: ['4'], from: 4, to: 7 }]);
    expect(engine.dragging).toBe(false);
    expect(engine.getSnapshot().floating).toBe(false);
  });

  it('reports nothing for a cancelled touch, or a drop where it started', () => {
    const cancelled = setup();
    cancelled.engine.touchDown('a', centre(4));
    cancelled.advance(LONG_PRESS_MS + 20);
    cancelled.engine.touchMove('a', centre(7));
    cancelled.engine.touchCancel('a');
    expect(cancelled.calls.reorders).toEqual([]);
    expect(cancelled.engine.dragging).toBe(false);

    const back = setup();
    back.engine.touchDown('a', centre(4));
    back.advance(LONG_PRESS_MS + 20);
    back.engine.touchMove('a', centre(7));
    back.engine.touchMove('a', centre(4));
    back.engine.touchUp('a');
    expect(back.calls.reorders).toEqual([]);
  });

  it('ignores another finger', () => {
    const { engine, advance } = setup();
    engine.touchDown('a', centre(4));
    engine.touchDown('b', centre(1));
    advance(LONG_PRESS_MS + 20);
    engine.touchMove('b', centre(8));
    engine.touchUp('b');
    expect(engine.getSnapshot().drag?.dragged).toEqual(['4']);
    expect(engine.getSnapshot().drag?.target).toBe(4);
  });
});

describe('the order shown', () => {
  it('is the preview during a drag, and the new order after a drop until data follows', () => {
    const { engine, data, advance } = setup();
    expect(engine.order(data)).toBeUndefined();
    engine.touchDown('a', centre(4));
    advance(LONG_PRESS_MS + 20);
    engine.touchMove('a', centre(7));
    const during = engine.order(data);
    expect(during?.[7]).toBe('4');
    expect(engine.itemsFor(data, during)[7]).toBe(4);
    engine.touchUp('a');
    expect(engine.order(data)).toEqual(during);
    // Data follows with a new array: the held order no longer applies.
    expect(engine.order([...data])).toBeUndefined();
  });

  it('is only held for a moment if data never follows', () => {
    const { engine, data, advance } = setup();
    engine.touchDown('a', centre(4));
    advance(LONG_PRESS_MS + 20);
    engine.touchMove('a', centre(7));
    engine.touchUp('a');
    expect(engine.order(data)).toBeDefined();
    advance(HOLD_MS + 50);
    expect(engine.order(data)).toBeUndefined();
  });

  it('tells subscribers when it changes, and only then', () => {
    const { engine, advance } = setup();
    let notified = 0;
    engine.subscribe(() => notified++);
    engine.touchDown('a', centre(4));
    expect(notified).toBe(0);
    advance(LONG_PRESS_MS + 20);
    expect(notified).toBe(1);
    engine.touchMove('a', centre(4));
    expect(notified).toBe(1);
    engine.touchMove('a', centre(7));
    expect(notified).toBe(2);
  });
});

describe('a mouse, through the browser', () => {
  it('lifts the item under the pointer without floating it, and reorders on a drop', () => {
    const { engine, calls } = setup();
    const hit = engine.osStart(centre(4));
    expect(hit).toEqual({ key: '4', grab: { x: 50, y: 50 } });
    expect(engine.getSnapshot().floating).toBe(false);
    expect(engine.osMove(centre(7))).toBe(true);
    expect(engine.osDrop()).toBe(true);
    expect(calls.reorders).toHaveLength(1);
    // The browser's end-of-drag, after a drop, does nothing more.
    engine.osEnd();
    expect(calls.reorders).toHaveLength(1);
  });

  it('refuses to start over a gap, for an item that cannot be dragged, or while a finger has it', () => {
    const { engine } = setup();
    expect(engine.osStart({ x: 105, y: 50 })).toBeUndefined();
    expect(setup({ canDrag: () => false }).engine.osStart(centre(4))).toBeUndefined();
    engine.touchDown('a', centre(4));
    expect(engine.osStart(centre(4))).toBeUndefined();
  });

  it('is not a drag that can land when it began elsewhere', () => {
    const { engine } = setup();
    expect(engine.osMove(centre(7))).toBe(false);
    expect(engine.osDrop()).toBe(false);
  });

  it('is cancelled when it ends without a drop', () => {
    const { engine, calls } = setup();
    engine.osStart(centre(4));
    engine.osMove(centre(7));
    engine.osEnd();
    expect(engine.dragging).toBe(false);
    expect(calls.reorders).toEqual([]);
  });
});

describe('scrolling at an edge', () => {
  // 40 items in 3 columns is 14 rows of 110: far taller than the 300 room.
  const tall = () => setup({ count: 40 });
  const lift = (t: ReturnType<typeof setup>, at: { x: number; y: number }) => {
    t.engine.touchDown('a', at);
    t.advance(LONG_PRESS_MS + 20);
  };

  it('scrolls a still finger held at the bottom edge, faster the longer it is held', () => {
    const t = tall();
    lift(t, centre(4));
    t.engine.touchMove('a', { x: 150, y: 295 });
    t.advance(500);
    const early = t.state.offset.y;
    expect(early).toBeGreaterThan(0);
    t.advance(1000);
    const late = t.state.offset.y - early;
    // The same time again, further: it ramps up.
    expect(late).toBeGreaterThan(early * 1.5 - 1);
    expect(t.calls.scrollTo.every((c) => c.animated === false)).toBe(true);
  });

  it('works the target out again as the content moves under a still finger', () => {
    const t = tall();
    lift(t, centre(4));
    t.engine.touchMove('a', { x: 150, y: 295 });
    const before = t.engine.getSnapshot().drag?.target;
    t.advance(1500);
    expect(t.engine.getSnapshot().drag?.target).toBeGreaterThan(before!);
  });

  it('stops when the finger leaves the edge, and when the drag ends', () => {
    const t = tall();
    lift(t, centre(4));
    t.engine.touchMove('a', { x: 150, y: 295 });
    t.advance(300);
    t.engine.touchMove('a', { x: 150, y: 150 });
    t.advance(100);
    const stopped = t.state.offset.y;
    t.advance(500);
    expect(t.state.offset.y).toBe(stopped);
    t.engine.touchMove('a', { x: 150, y: 295 });
    t.advance(200);
    t.engine.touchUp('a');
    expect(t.pendingFrames()).toBe(0);
  });

  it('does not scroll past the end of the content', () => {
    const t = setup({ count: 12 });
    lift(t, centre(4));
    t.engine.touchMove('a', { x: 150, y: 299 });
    t.advance(6000);
    // 4 rows of 110, less the last gap, in a 300 room.
    expect(t.state.offset.y).toBeLessThanOrEqual(430 - 300 + 1);
  });

  it('keeps the lifted item scrolling for a mouse only while the pointer keeps sending events', () => {
    const t = tall();
    t.engine.osStart(centre(4));
    t.engine.osMove({ x: 150, y: 295 });
    t.advance(300);
    expect(t.state.offset.y).toBeGreaterThan(0);
    // The browser goes quiet (the pointer left the window): it stops.
    t.advance(700);
    const stopped = t.state.offset.y;
    t.advance(500);
    expect(t.state.offset.y).toBe(stopped);
  });
});

describe('paged layouts', () => {
  // Pages of 3 × 2 in a 300 × 200 room, side by side: 40 items is 7 pages.
  const pages = (extra: Options = {}) =>
    setup({
      count: 40,
      room: { width: 300, height: 200 },
      axis: 'horizontal',
      layout: pagedLayout({ direction: 'horizontal', columns: 3, rows: 2, gap: 0 }),
      ...extra,
    });
  const lift = (t: ReturnType<typeof setup>) => {
    t.engine.touchDown('a', { x: 50, y: 50 });
    t.advance(LONG_PRESS_MS + 20);
    t.engine.touchMove('a', { x: 290, y: 100 });
  };

  it('turns the page once the finger has dwelt at the edge, not before', () => {
    const t = pages();
    lift(t);
    t.advance(PAGE_DWELL_MS - 100);
    expect(t.state.offset.x).toBe(0);
    t.advance(200);
    // Native: one animated scroll to the next page.
    expect(t.calls.scrollTo).toEqual([{ to: { x: 300, y: 0 }, animated: true }]);
  });

  it('turns another after another dwell, and retargets on the new page', () => {
    const t = pages();
    lift(t);
    t.advance(PAGE_DWELL_MS * 2 + 100);
    expect(t.calls.scrollTo.map((c) => c.to.x)).toEqual([300, 600]);
    // Over page three's slot under the finger, not the first page's.
    expect(t.engine.getSnapshot().drag?.target).toBeGreaterThanOrEqual(12);
  });

  it('does not turn past the last page', () => {
    // 7 items at 6 a page: two pages, the last starting at 300.
    const t = pages({ count: 7 });
    lift(t);
    t.advance(PAGE_DWELL_MS * 5);
    expect(Math.max(...t.calls.scrollTo.map((c) => c.to.x))).toBe(300);
  });

  it('does not turn when the finger leaves the edge before the dwell is up', () => {
    const t = pages();
    lift(t);
    t.advance(PAGE_DWELL_MS - 100);
    t.engine.touchMove('a', { x: 150, y: 100 });
    t.advance(PAGE_DWELL_MS * 2);
    expect(t.calls.scrollTo).toEqual([]);
  });

  it('jumps when asked for no motion, on native', () => {
    const t = pages({ instant: true });
    lift(t);
    t.advance(PAGE_DWELL_MS + 100);
    expect(t.calls.scrollTo).toEqual([{ to: { x: 300, y: 0 }, animated: false }]);
  });

  describe('on web, where the engine steps the turn itself', () => {
    it('eases the scroll position over a short while, with scroll snap held off', () => {
      const t = pages({ web: true });
      const turning: boolean[] = [];
      t.engine.subscribe(() => turning.push(t.engine.getSnapshot().turning));
      lift(t);
      t.advance(PAGE_DWELL_MS + 32);
      expect(t.engine.getSnapshot().turning).toBe(true);
      t.advance(PAGE_TURN_MS / 2);
      const middle = t.state.offset.x;
      expect(middle).toBeGreaterThan(0);
      expect(middle).toBeLessThan(300);
      t.advance(PAGE_TURN_MS);
      expect(t.state.offset.x).toBe(300);
      expect(t.engine.getSnapshot().turning).toBe(false);
      expect(t.calls.scrollTo.every((c) => c.animated === false)).toBe(true);
      expect(turning).toContain(true);
    });

    it('needs another dwell before the next turn, even when held on', () => {
      const t = pages({ web: true });
      lift(t);
      t.advance(PAGE_DWELL_MS + PAGE_TURN_MS + 200);
      expect(t.state.offset.x).toBe(300);
      t.advance(PAGE_DWELL_MS - 300);
      expect(t.state.offset.x).toBe(300);
      t.advance(PAGE_TURN_MS + 400);
      expect(t.state.offset.x).toBe(600);
    });

    it('lands a turn at once when the drag ends part of the way', () => {
      const t = pages({ web: true });
      lift(t);
      t.advance(PAGE_DWELL_MS + 32 + PAGE_TURN_MS / 3);
      expect(t.state.offset.x).toBeLessThan(300);
      t.engine.touchUp('a');
      expect(t.state.offset.x).toBe(300);
      expect(t.engine.getSnapshot().turning).toBe(false);
    });

    it('jumps when asked for no motion', () => {
      const t = pages({ web: true, instant: true });
      lift(t);
      t.advance(PAGE_DWELL_MS + 100);
      expect(t.calls.scrollTo).toEqual([{ to: { x: 300, y: 0 }, animated: false }]);
      expect(t.engine.getSnapshot().turning).toBe(false);
    });
  });
});

describe('dispose', () => {
  it('cancels what is pending', () => {
    const t = setup({ count: 40 });
    t.engine.touchDown('a', centre(4));
    t.advance(LONG_PRESS_MS + 20);
    t.engine.touchMove('a', { x: 150, y: 295 });
    t.engine.touchUp('a');
    t.engine.touchDown('b', centre(4));
    t.engine.dispose();
    expect(t.pendingTimers()).toBe(0);
    expect(t.pendingFrames()).toBe(0);
  });
});
