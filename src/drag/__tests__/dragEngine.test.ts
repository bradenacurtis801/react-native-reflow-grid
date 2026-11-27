import { DragCarrier } from '../carrier';
import type { DragSession, JoinPolicy, JoinResult } from '../drag';
import { DRAG_EXIT_MS, DragEngine, HOLD_MS, LONG_PRESS_MS, PAGE_DWELL_MS, PAGE_EDGE_BAND, PAGE_TURN_MS, SLOP, SPRING_LOAD_MS, type DragHost, type DragView, type Offset } from '../dragEngine';
import { HAPTIC_GAPS, type HapticEvent } from '../../support/haptics';
import { gridLayout, pagedLayout, type ReflowLayout } from '../../layout';

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
  joinOf?: (item: number) => JoinPolicy | undefined;
  /** What `onJoin` returns. */
  joinReturns?: string | false;
}

/** An engine on a grid of `count` numbers, with every call it makes of the grid recorded. */
function setup({ count = 12, layout, room = { width: 320, height: 300 }, offset = { x: 0, y: 0 }, axis = 'vertical', web = false, instant = false, canDrag, enabled = true, inset, joinOf, joinReturns }: Options = {}) {
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
    joins: [] as JoinResult[],
    started: [] as DragSession[],
    lifted: [] as string[],
    haptics: [] as HapticEvent[],
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
    joinOf,
    onJoin: joinOf
      ? (result) => {
          calls.joins.push(result);
          return joinReturns;
        }
      : undefined,
    onDragStart: (session) => calls.started.push(session),
    onLift: (id) => calls.lifted.push(id),
    haptic: (event) => calls.haptics.push(event),
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
    expect(calls.started).toEqual([{ origin: 'internal', items: [{ key: '4', types: ['text/plain'], local: 4 }] }]);
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
    expect(calls.reorders).toEqual([
      {
        session: { origin: 'internal', items: [{ key: '4', types: ['text/plain'], local: 4 }] },
        keys: ['0', '1', '2', '3', '5', '6', '7', '4', '8', '9', '10', '11'],
        moved: ['4'],
        from: 4,
        to: 7,
      },
    ]);
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

describe('haptics', () => {
  const lift = (t: ReturnType<typeof setup>, at = centre(4)) => {
    t.engine.touchDown('a', at);
    t.advance(LONG_PRESS_MS + 20);
  };

  it('gives one for a lift, by a finger or a mouse', () => {
    const finger = setup();
    lift(finger);
    expect(finger.calls.haptics).toEqual(['lift']);
    const mouse = setup();
    mouse.engine.osStart(centre(4));
    expect(mouse.calls.haptics).toEqual(['lift']);
  });

  it('gives none for a press that is not held, or on an item that cannot be dragged', () => {
    const quick = setup();
    quick.engine.touchDown('a', centre(4));
    quick.advance(100);
    quick.engine.touchUp('a');
    expect(quick.calls.haptics).toEqual([]);
    const no = setup({ canDrag: () => false });
    lift(no);
    expect(no.calls.haptics).toEqual([]);
  });

  it('gives one when the item moves to another slot, and none while it stays in one', () => {
    const t = setup();
    lift(t);
    t.engine.touchMove('a', { x: centre(4).x + 3, y: centre(4).y });
    expect(t.calls.haptics).toEqual(['lift']);
    t.engine.touchMove('a', centre(7));
    expect(t.calls.haptics).toEqual(['lift', 'move']);
    t.engine.touchMove('a', { x: centre(7).x + 3, y: centre(7).y });
    expect(t.calls.haptics).toEqual(['lift', 'move']);
  });

  it('limits the moves that come in a rush, and lets one through once the gap has passed', () => {
    const t = setup();
    lift(t);
    // Three slots in no time at all: one buzz, not three.
    t.engine.touchMove('a', centre(5));
    t.engine.touchMove('a', centre(6));
    t.engine.touchMove('a', centre(7));
    expect(t.calls.haptics.filter((e) => e === 'move')).toHaveLength(1);
    t.advance(HAPTIC_GAPS.move! + 20);
    t.engine.touchMove('a', centre(8));
    expect(t.calls.haptics.filter((e) => e === 'move')).toHaveLength(2);
  });

  it('gives one for a drop that changed the order, and none for a cancel or a drop where it began', () => {
    const dropped = setup();
    lift(dropped);
    dropped.engine.touchMove('a', centre(7));
    dropped.engine.touchUp('a');
    expect(dropped.calls.haptics).toEqual(['lift', 'move', 'drop']);

    const cancelled = setup();
    lift(cancelled);
    cancelled.engine.touchMove('a', centre(7));
    cancelled.engine.touchCancel('a');
    expect(cancelled.calls.haptics).toEqual(['lift', 'move']);

    const back = setup();
    lift(back);
    back.engine.touchMove('a', centre(7));
    back.advance(HAPTIC_GAPS.move! + 20);
    back.engine.touchMove('a', centre(4));
    back.engine.touchUp('a');
    expect(back.calls.haptics).not.toContain('drop');
  });

  it('gives one for each page a drag turns', () => {
    const t = setup({
      count: 40,
      room: { width: 300, height: 200 },
      axis: 'horizontal',
      layout: pagedLayout({ direction: 'horizontal', columns: 3, rows: 2, gap: 0 }),
    });
    t.engine.touchDown('a', { x: 50, y: 50 });
    t.advance(LONG_PRESS_MS + 20);
    t.engine.touchMove('a', { x: 290, y: 100 });
    expect(t.calls.haptics.filter((e) => e === 'pageTurn')).toHaveLength(0);
    t.advance(PAGE_DWELL_MS * 2 + 100);
    expect(t.calls.haptics.filter((e) => e === 'pageTurn')).toHaveLength(2);
  });

  it('limits the scrub of the page dots like the moves, and says nothing if there is nothing to give', () => {
    const t = setup();
    t.engine.haptic('scrub');
    t.engine.haptic('scrub');
    expect(t.calls.haptics).toEqual(['scrub']);
    t.advance(HAPTIC_GAPS.scrub! + 20);
    t.engine.haptic('scrub');
    expect(t.calls.haptics).toEqual(['scrub', 'scrub']);

    const silent = setup();
    silent.view.haptic = undefined;
    expect(() => {
      silent.engine.touchDown('a', centre(4));
      silent.advance(LONG_PRESS_MS + 20);
      silent.engine.touchMove('a', centre(7));
      silent.engine.touchUp('a');
    }).not.toThrow();
  });
});

describe('joining', () => {
  // Every item takes every other, but for 5, which takes none.
  const joinOf = (n: number): JoinPolicy => ({ kind: 'app', accepts: n === 5 ? [] : ['app'] });
  /** Item 0 lifted, ready to be moved. */
  const lifted = (options: Options = {}) => {
    const t = setup({ joinOf, ...options });
    t.engine.touchDown('a', centre(0));
    t.advance(LONG_PRESS_MS + 20);
    return t;
  };
  /** A point past item `i`'s middle, coming from the left: in its slot, outside its join zone. */
  const edge = (i: number) => ({ x: centre(i).x + 45, y: centre(i).y });

  it('names the item the finger covers at once, and nothing makes room', () => {
    const { engine, calls } = lifted();
    engine.touchMove('a', centre(1));
    expect(engine.getSnapshot().drag?.join).toBe('1');
    expect(engine.getSnapshot().drag?.preview).toEqual(engine.getSnapshot().drag?.keys);
    expect(calls.haptics).toEqual(['lift', 'join']);
  });

  it('joins on a drop there, and does not reorder', () => {
    const { engine, calls, advance } = lifted();
    engine.touchMove('a', centre(1));
    advance(20);
    engine.touchUp('a');
    expect(calls.joins).toMatchObject([{ dragged: ['0'], target: '1' }]);
    expect(calls.reorders).toEqual([]);
    expect(engine.dragging).toBe(false);
    // The dragged item goes to the middle of the target.
    expect(engine.joined.get('0')).toEqual({ into: '1', at: { x: 50, y: 50 } });
    expect(engine.replaced).toBeUndefined();
  });

  it('goes into the item that takes the target’s place', () => {
    const { engine, advance } = lifted({ joinReturns: 'folder' });
    engine.touchMove('a', centre(1));
    advance(20);
    engine.touchUp('a');
    expect(engine.joined.get('0')?.into).toBe('folder');
    expect(engine.replaced).toEqual({ from: '1', to: 'folder' });
  });

  it('keeps nothing of a join that is refused', () => {
    const { engine, calls, advance } = lifted({ joinReturns: false });
    engine.touchMove('a', centre(1));
    advance(20);
    engine.touchUp('a');
    expect(engine.joined.size).toBe(0);
    expect(calls.haptics).not.toContain('drop');
  });

  it('lets go of the item when the finger leaves it', () => {
    const { engine, advance } = lifted();
    engine.touchMove('a', centre(1));
    advance(20);
    engine.touchMove('a', edge(1));
    expect(engine.getSnapshot().drag?.join).toBeUndefined();
  });

  /** A point in item `i`'s slot on the near side of its join zone, coming from the left, and on the left of any item. */
  const left = (i: number) => ({ x: centre(i).x - 45, y: centre(i).y });

  it('stays put on the near side of a neighbour, and takes its slot past it', () => {
    const { engine } = lifted();
    engine.touchMove('a', left(1));
    expect(engine.getSnapshot().drag?.target).toBe(0);
    engine.touchMove('a', edge(1));
    expect(engine.getSnapshot().drag?.target).toBe(1);
  });

  it('makes room at once up to an item further on, which stays where it is', () => {
    const { engine } = lifted();
    engine.touchMove('a', left(4));
    expect(engine.getSnapshot().drag?.target).toBe(3);
    expect(engine.getSnapshot().drag?.preview[4]).toBe('4');
    engine.touchMove('a', centre(4));
    expect(engine.getSnapshot().drag?.target).toBe(3);
    expect(engine.getSnapshot().drag?.join).toBe('4');
  });

  it('does the same coming from after the item', () => {
    const t = setup({ joinOf });
    t.engine.touchDown('a', centre(4));
    t.advance(LONG_PRESS_MS + 20);
    // Item 1 is before the one lifted: its right is the near side.
    t.engine.touchMove('a', edge(1));
    expect(t.engine.getSnapshot().drag?.target).toBe(2);
    expect(t.engine.getSnapshot().drag?.preview[1]).toBe('1');
    t.engine.touchMove('a', left(1));
    expect(t.engine.getSnapshot().drag?.target).toBe(1);
  });

  it('goes by above and below in a list', () => {
    const t = lifted({ layout: gridLayout({ flow: 'vertical', lines: 1, gap: 10, card: { length: 100 } }), room: { width: 320, height: 600 } });
    t.engine.touchMove('a', { x: 160, y: 225 });
    expect(t.engine.getSnapshot().drag?.target).toBe(1);
    t.engine.touchMove('a', { x: 160, y: 315 });
    expect(t.engine.getSnapshot().drag?.target).toBe(2);
  });

  it('makes room at once beside an item that takes nothing', () => {
    const { engine, advance } = lifted();
    engine.touchMove('a', centre(5));
    expect(engine.getSnapshot().drag?.target).toBe(5);
    advance(20);
    expect(engine.getSnapshot().drag?.join).toBeUndefined();
  });

  it('joins the item the preview shows in a slot', () => {
    const { engine, advance } = lifted();
    // Moved to 5's slot, the others close up: item 2 is now in slot 1.
    engine.touchMove('a', centre(5));
    engine.touchMove('a', centre(1));
    advance(20);
    expect(engine.getSnapshot().drag?.join).toBe('2');
  });

  it('takes the zone the policy gives', () => {
    const { engine, advance } = lifted({ joinOf: () => ({ kind: 'app', accepts: ['app'], zone: { x: 0, y: 0, width: 20, height: 20 } }) });
    engine.touchMove('a', { x: 110 + 10, y: 10 });
    advance(20);
    expect(engine.getSnapshot().drag?.join).toBe('1');
    engine.touchUp('a');
    expect(engine.joined.get('0')?.at).toEqual({ x: 10, y: 10 });
  });

  it('forgets a wait when the drag is cancelled', () => {
    const { engine, calls, advance, pendingTimers } = lifted();
    engine.touchMove('a', edge(1));
    engine.touchCancel('a');
    expect(pendingTimers()).toBe(0);
    advance(SPRING_LOAD_MS * 2);
    expect(engine.dragging).toBe(false);
    expect(calls.joins).toEqual([]);
  });
});

describe('opening an item under a drag', () => {
  const joinOf = (): JoinPolicy => ({ kind: 'app', accepts: ['app'] });
  /** Item 0 lifted and held on item 1, in a grid that opens what's held on. */
  const held = (returns?: string | false) => {
    const t = setup({ joinOf });
    const carrier = new DragCarrier();
    const opened: JoinResult[] = [];
    t.view.carrier = carrier;
    t.view.renderCarried = () => () => null;
    t.view.onSpringLoad = (result) => {
      opened.push(result);
      return returns;
    };
    t.engine.touchDown('a', centre(0));
    t.advance(LONG_PRESS_MS + 20);
    t.engine.touchMove('a', centre(1));
    return { ...t, carrier, opened };
  };
  /** A second grid, with the same items, taking over. */
  const taker = (carrier: DragCarrier) => {
    const t = setup();
    carrier.offer(t.engine);
    return t;
  };

  it('asks for the item to be opened once the finger has stayed', () => {
    const { advance, opened, carrier, engine } = held();
    advance(SPRING_LOAD_MS - 40);
    expect(opened).toEqual([]);
    advance(60);
    expect(opened).toMatchObject([{ dragged: ['0'], target: '1' }]);
    expect(carrier.getSnapshot()).toMatchObject({ key: '0', size: { width: 100, height: 100 }, grab: { x: 50, y: 50 } });
    expect(engine.getSnapshot()).toMatchObject({ drag: undefined, carrying: true });
    expect(engine.handedOff.has('0')).toBe(true);
  });

  it('does not once the finger has left', () => {
    const { advance, opened, engine } = held();
    advance(SPRING_LOAD_MS / 2);
    engine.touchMove('a', { x: centre(1).x + 45, y: centre(1).y });
    advance(SPRING_LOAD_MS);
    expect(opened).toEqual([]);
  });

  it('leaves the drag where it is when nothing is opened', () => {
    const { advance, carrier, engine } = held(false);
    advance(SPRING_LOAD_MS + 20);
    expect(carrier.getSnapshot()).toBeUndefined();
    expect(engine.getSnapshot().drag?.join).toBe('1');
  });

  it('notes what takes the target’s place', () => {
    const { advance, engine } = held('folder');
    advance(SPRING_LOAD_MS + 20);
    expect(engine.replaced).toEqual({ from: '1', to: 'folder' });
  });

  it('goes on in the grid that takes it over, which reports the drop', () => {
    const { advance, carrier, engine, calls } = held();
    advance(SPRING_LOAD_MS + 20);
    const other = taker(carrier);
    expect(other.engine.getSnapshot()).toMatchObject({ floating: true });
    // The finger is still the first grid's: it passes the moves on.
    engine.touchMove('a', centre(5));
    expect(other.engine.getSnapshot().drag?.target).toBe(5);
    engine.touchUp('a');
    expect(other.calls.reorders).toMatchObject([{ moved: ['0'], to: 5 }]);
    expect(calls.reorders).toEqual([]);
    expect(carrier.getSnapshot()).toBeUndefined();
    expect(engine.getSnapshot().carrying).toBe(false);
  });

  it('ends cleanly when the finger lifts before any grid has taken it', () => {
    const { advance, carrier, engine } = held();
    advance(SPRING_LOAD_MS + 20);
    engine.touchUp('a');
    expect(carrier.getSnapshot()).toBeUndefined();
    expect(engine.getSnapshot().carrying).toBe(false);
  });

  it('is not taken by a grid without the item', () => {
    const { advance, carrier } = held();
    advance(SPRING_LOAD_MS + 20);
    const other = setup({ count: 0 });
    carrier.offer(other.engine);
    expect(other.engine.dragging).toBe(false);
  });
});

describe('leaving a grid under a drag', () => {
  // The room is 320 × 300: below it is outside.
  const out = { x: 150, y: 400 };
  /** A grid that can be left, with item 0 lifted. */
  const leavable = (returns?: false) => {
    const t = setup();
    const carrier = new DragCarrier();
    const exits: (readonly string[])[] = [];
    t.view.carrier = carrier;
    t.view.renderCarried = () => () => null;
    t.view.onDragExit = ({ dragged }) => {
      exits.push(dragged);
      return returns;
    };
    t.engine.touchDown('a', centre(0));
    t.advance(LONG_PRESS_MS + 20);
    return { ...t, carrier, exits };
  };

  it('asks to leave once the finger has stayed outside', () => {
    const { engine, advance, exits, carrier } = leavable();
    engine.touchMove('a', out);
    advance(DRAG_EXIT_MS - 40);
    expect(exits).toEqual([]);
    advance(60);
    expect(exits).toEqual([['0']]);
    expect(carrier.getSnapshot()?.key).toBe('0');
    expect(engine.getSnapshot()).toMatchObject({ drag: undefined, carrying: true });
  });

  it('says where the finger is, after the delay the grid asks for', () => {
    const { engine, view, advance } = leavable();
    const asked: unknown[] = [];
    view.exitDelay = 60;
    view.onDragExit = ({ point }) => {
      asked.push(point);
      return false;
    };
    engine.touchMove('a', out);
    advance(80);
    expect(asked).toEqual([out]);
  });

  it('does not make room or scroll while the finger is out', () => {
    const { engine, advance, calls } = leavable();
    engine.touchMove('a', out);
    advance(100);
    expect(engine.getSnapshot().drag?.target).toBe(0);
    expect(calls.scrollTo).toEqual([]);
  });

  it('stays if the finger comes back in time', () => {
    const { engine, advance, exits } = leavable();
    engine.touchMove('a', out);
    advance(DRAG_EXIT_MS / 2);
    engine.touchMove('a', centre(4));
    advance(DRAG_EXIT_MS);
    expect(exits).toEqual([]);
    expect(engine.getSnapshot().drag?.target).toBe(4);
  });

  it('keeps the drag when the app says so', () => {
    const { engine, advance, carrier } = leavable(false);
    engine.touchMove('a', out);
    advance(DRAG_EXIT_MS + 20);
    expect(carrier.getSnapshot()).toBeUndefined();
    expect(engine.dragging).toBe(true);
  });

  it('is taken by another grid, which drops it, and the end is told', () => {
    const { engine, advance, carrier } = leavable();
    let ended = 0;
    carrier.onEnd = () => ended++;
    engine.touchMove('a', out);
    advance(DRAG_EXIT_MS + 20);
    const other = setup();
    carrier.offer(other.engine);
    engine.touchMove('a', centre(5));
    engine.touchUp('a');
    expect(other.calls.reorders).toMatchObject([{ moved: ['0'], to: 5 }]);
    expect(ended).toBe(1);
  });

  it('can leave the grid that took it, and be taken back by the first', () => {
    const { engine, advance, carrier } = leavable();
    engine.touchMove('a', out);
    advance(DRAG_EXIT_MS + 20);
    const other = setup();
    other.view.carrier = carrier;
    other.view.renderCarried = () => () => null;
    other.view.onDragExit = () => {};
    carrier.offer(other.engine);
    engine.touchMove('a', out);
    other.advance(DRAG_EXIT_MS + 20);
    expect(other.engine.dragging).toBe(false);
    expect(carrier.getSnapshot()?.key).toBe('0');
    engine.touchMove('a', centre(0));
    carrier.offer(engine);
    expect(engine.dragging).toBe(true);
    engine.touchMove('a', centre(5));
    engine.touchUp('a');
    expect(carrier.getSnapshot()).toBeUndefined();
    expect(engine.dragging).toBe(false);
  });
});

describe('the edge of a page', () => {
  const layout = pagedLayout({ direction: 'horizontal', columns: 3, rows: 3 });
  const held = (x: number) => {
    const t = setup({ count: 18, layout, axis: 'horizontal' });
    t.engine.touchDown('a', { x: 50, y: 50 });
    t.advance(LONG_PRESS_MS + 20);
    t.engine.touchMove('a', { x, y: 150 });
    t.advance(PAGE_DWELL_MS + 100);
    return t.calls.scrollTo.length;
  };

  it('turns the page only close to it', () => {
    // The room is 320 wide.
    expect(held(320 - PAGE_EDGE_BAND - 10)).toBe(0);
    expect(held(320 - 4)).toBeGreaterThan(0);
  });
});

describe('joining an item the grid does not have', () => {
  const joinOf = (): JoinPolicy => ({ kind: 'app', accepts: ['app'] });
  /** A drag carried from elsewhere, and a grid taking it only to join. */
  const visit = () => {
    const carrier = new DragCarrier();
    carrier.start({ key: 'x', item: 99, size: { width: 100, height: 100 }, grab: { x: 50, y: 50 }, render: () => null }, centre(11));
    const t = setup({ joinOf });
    t.view.carrier = carrier;
    carrier.offer(t.engine, true);
    return { ...t, carrier };
  };

  it('is not taken by a grid that only continues drags of its own items', () => {
    const carrier = new DragCarrier();
    carrier.start({ key: 'x', item: 99, size: { width: 100, height: 100 }, grab: { x: 50, y: 50 }, render: () => null }, centre(1));
    const t = setup({ joinOf });
    carrier.offer(t.engine);
    expect(t.engine.dragging).toBe(false);
  });

  it('highlights the item covered, and nothing makes room', () => {
    const { engine, carrier } = visit();
    carrier.move({ x: centre(4).x + 45, y: centre(4).y });
    expect(engine.getSnapshot().drag?.preview).toEqual(engine.getSnapshot().drag?.keys);
    carrier.move(centre(4));
    expect(engine.getSnapshot().drag?.join).toBe('4');
  });

  it('joins on a drop there', () => {
    const { carrier, calls, engine } = visit();
    carrier.move(centre(4));
    carrier.end(false);
    expect(calls.joins).toMatchObject([{ dragged: ['x'], target: '4' }]);
    expect(engine.dragging).toBe(false);
  });

  it('does nothing on a drop beside', () => {
    const { carrier, calls } = visit();
    carrier.move({ x: centre(4).x + 45, y: centre(4).y });
    carrier.end(false);
    expect(calls.joins).toEqual([]);
    expect(calls.reorders).toEqual([]);
  });

  it('opens an item held on, and can be left', () => {
    const { carrier, advance, view, engine } = visit();
    const opened: unknown[] = [];
    view.renderCarried = () => () => null;
    view.onSpringLoad = (r) => void opened.push(r);
    carrier.move(centre(4));
    advance(SPRING_LOAD_MS + 20);
    expect(opened).toHaveLength(1);
    expect(engine.dragging).toBe(false);
    expect(carrier.getSnapshot()?.key).toBe('x');
  });

  it('is let go when the finger goes outside', () => {
    const { carrier, advance, view, engine } = visit();
    view.renderCarried = () => () => null;
    view.onDragExit = () => {};
    carrier.move({ x: 150, y: 400 });
    advance(DRAG_EXIT_MS + 20);
    expect(engine.dragging).toBe(false);
    expect(carrier.getSnapshot()?.key).toBe('x');
  });
});
