import { gridLayout, intersects, layoutFromRects, masonryLayout, pagedLayout, type Rect, type ReflowLayout, type ReflowResult, type Region } from '..';

/** `n` items for a layout to place (a grid ignores what they are). */
const items = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Every item's rect, from the first to the `n`th. */
const rectsOf = (result: ReflowResult, n: number): Rect[] => Array.from({ length: n }, (_, i) => result.rectOf(i));

describe('gridLayout, vertical flow', () => {
  // 3 columns across a 340pt room with 10pt gaps: each card is (340 - 20) / 3 wide.
  const CARD_W = 320 / 3;
  const layout = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 0.75 } });
  const room = { width: 340, height: 600 };

  it('fills a row across, then starts the next one under it', () => {
    const rects = rectsOf(layout(items(5), room), 5);
    const down = CARD_W / 0.75 + 10;
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [CARD_W + 10, 0],
      [2 * (CARD_W + 10), 0],
      [0, down],
      [CARD_W + 10, down],
    ].map(([x, y]) => [expect.closeTo(x!, 5), expect.closeTo(y!, 5)]));
  });

  it('gives its columns the whole width of the room', () => {
    const result = layout(items(3), room);
    expect(result.size.width).toBeCloseTo(340, 5);
    expect(result.rectOf(0).width).toBeCloseTo(CARD_W, 5);
  });

  it('takes its length from the aspect ratio', () => {
    expect(layout(items(1), room).rectOf(0).height).toBeCloseTo(CARD_W / 0.75, 5);
  });

  it('is empty with no items', () => {
    const result = layout([], room);
    expect(result.size).toEqual({ width: 0, height: 0 });
    expect(result.indicesIn({ x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 })).toEqual([]);
  });

  it('uses a fixed length when given', () => {
    const fixed = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { length: 140 } });
    expect(fixed(items(1), room).rectOf(0).height).toBe(140);
    expect(fixed(items(4), room).size.height).toBe(140 * 2 + 10);
  });
});

describe('gridLayout, horizontal flow', () => {
  // 2 rows down a 124pt-high room with a 4pt gap: each row is (124 - 4) / 2 = 60 tall.
  const room = { width: 300, height: 124 };

  it('fills a column down, then starts the next one beside it', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { length: 80 } });
    const rects = rectsOf(layout(items(5), room), 5);
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [0, 64],
      [88, 0],
      [88, 64],
      [176, 0],
    ]);
    expect(rects[0]!.height).toBe(60);
  });

  it('fills the room across its rows, so no row overflows the room', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { aspect: 0.75 } });
    expect(layout(items(1), room).size.height).toBe(124);
  });

  it('takes its width from the aspect ratio', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 1, card: { aspect: 0.5 } });
    expect(layout(items(2), { width: 300, height: 100 }).rectOf(0).width).toBe(50);
  });

  it('keeps its full height with one item, and grows wider as columns are added', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { length: 80 } });
    expect(layout(items(1), room).size).toEqual({ width: 80, height: 124 });
    expect(layout(items(5), room).size).toEqual({ width: 256, height: 124 });
  });
});

describe('gridLayout, one line', () => {
  it('makes a list from one column', () => {
    const list = gridLayout({ flow: 'vertical', lines: 1, gap: 6, card: { length: 40 } });
    expect(rectsOf(list(items(3), { width: 300, height: 600 }), 3).map((r) => r.y)).toEqual([0, 46, 92]);
  });

  it('makes a strip from one row', () => {
    const strip = gridLayout({ flow: 'horizontal', lines: 1, gap: 5, card: { length: 50 } });
    expect(rectsOf(strip(items(3), { width: 300, height: 100 }), 3).map((r) => r.x)).toEqual([0, 55, 110]);
  });
});

it('refuses a line count that is not a whole number of 1 or more', () => {
  expect(() => gridLayout({ flow: 'vertical', lines: 0 })).toThrow();
  expect(() => gridLayout({ flow: 'vertical', lines: 1.5 })).toThrow();
});

describe('gridLayout, fixed width and height', () => {
  // The room is ignored: a fixed card is its own size, and the content is as big as its cards.
  const tiny = { width: 10, height: 10 };

  it('places a vertical grid by columns, and sizes the content to its cards', () => {
    const layout = gridLayout({ flow: 'vertical', lines: 2, gap: 10, card: { width: 100, height: 50 } });
    const result = layout(items(5), tiny);
    expect(rectsOf(result, 5).map((r) => [r.x, r.y, r.width, r.height])).toEqual([
      [0, 0, 100, 50],
      [110, 0, 100, 50],
      [0, 60, 100, 50],
      [110, 60, 100, 50],
      [0, 120, 100, 50],
    ]);
    expect(result.size).toEqual({ width: 210, height: 170 });
  });

  it('places a horizontal grid by columns, and sizes the content to its cards', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { width: 80, height: 40 } });
    const result = layout(items(5), tiny);
    expect(rectsOf(result, 5).map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [0, 44],
      [88, 0],
      [88, 44],
      [176, 0],
    ]);
    expect(result.size).toEqual({ width: 256, height: 84 });
  });

  it('refuses a card with no size', () => {
    expect(() => gridLayout({ flow: 'vertical', lines: 1, card: { width: 0, height: 10 } })).toThrow();
  });
});

/** The slow way to find what's in a region: look at every rect. */
const scan = (result: ReflowResult, n: number, region: Region) =>
  rectsOf(result, n).flatMap((r, i) => (intersects(r, region) ? [i] : []));

describe('indicesIn', () => {
  // A fixed sequence of regions, odd sizes and positions, some off the content altogether.
  const regions: Region[] = Array.from({ length: 60 }, (_, k) => {
    const x0 = ((k * 37) % 400) - 60;
    const y0 = ((k * 91) % 700) - 80;
    return { x0, x1: x0 + 20 + ((k * 53) % 300), y0, y1: y0 + 20 + ((k * 29) % 500) };
  });
  const layouts: [string, ReflowLayout][] = [
    ['vertical grid', gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 0.75 } })],
    ['vertical list', gridLayout({ flow: 'vertical', lines: 1, gap: 6, card: { length: 40 } })],
    ['horizontal grid', gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { aspect: 0.75 } })],
    ['horizontal strip', gridLayout({ flow: 'horizontal', lines: 1, gap: 5, card: { length: 50 } })],
    ['fixed cards', gridLayout({ flow: 'vertical', lines: 4, gap: 7, card: { width: 90, height: 60 } })],
  ];

  it.each(layouts)('finds the same items as a scan, for a %s', (_name, layout) => {
    for (const count of [0, 1, 5, 23, 100]) {
      const result = layout(items(count), { width: 340, height: 300 });
      for (const region of regions) expect(result.indicesIn(region)).toEqual(scan(result, count, region));
    }
  });

  it('is in ascending order', () => {
    const result = gridLayout({ flow: 'horizontal', lines: 3, gap: 4 })(items(50), { width: 300, height: 300 });
    const found = result.indicesIn({ x0: 0, x1: 400, y0: 0, y1: 400 });
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });

  it('looks at each item when the room has no size to divide', () => {
    const result = gridLayout({ flow: 'vertical', lines: 2 })(items(4), { width: 0, height: 0 });
    expect(result.indicesIn({ x0: -1, x1: 1, y0: -1, y1: 1 })).toEqual(scan(result, 4, { x0: -1, x1: 1, y0: -1, y1: 1 }));
  });
});

describe('layoutFromRects', () => {
  it('answers from the array it is given', () => {
    const rects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 50, y: 0, width: 10, height: 10 },
    ];
    const result = layoutFromRects(rects, { width: 60, height: 10 });
    expect(result.rectOf(1)).toEqual(rects[1]);
    expect(result.indicesIn({ x0: 40, x1: 100, y0: 0, y1: 10 })).toEqual([1]);
    expect(result.size).toEqual({ width: 60, height: 10 });
  });
});

describe('masonryLayout', () => {
  // 2 columns across a 210pt room with a 10pt gap: each is 100 wide.
  const room = { width: 210, height: 600 };
  const heights = [50, 30, 20, 40, 10];
  const layout = masonryLayout<number>({ columns: 2, gap: 10, heightOf: (h) => h });

  it('puts each item under the shortest column so far', () => {
    const rects = rectsOf(layout(heights, room), heights.length);
    expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual([
      [0, 0, 100, 50], // column 0 is now 60 down
      [110, 0, 100, 30], // column 1 is now 40 down
      [110, 40, 100, 20], // column 1 is shorter: now 70
      [0, 60, 100, 40], // column 0 is shorter: now 110
      [110, 70, 100, 10], // column 1 is shorter: now 90
    ]);
  });

  it('sizes the content to the tallest column', () => {
    expect(layout(heights, room).size).toEqual({ width: 210, height: 100 });
  });

  it('hands each item the width its column gives it, and its index', () => {
    const seen: [number, number, number][] = [];
    masonryLayout<number>({ columns: 2, gap: 10, heightOf: (item, width, index) => (seen.push([item, width, index]), 10) })(
      [7, 8],
      room,
    );
    expect(seen).toEqual([
      [7, 100, 0],
      [8, 100, 1],
    ]);
  });

  it('finds the items in a region', () => {
    const result = layout(heights, room);
    expect(result.indicesIn({ x0: 0, x1: 210, y0: 65, y1: 200 })).toEqual([3, 4]);
  });

  it('is empty with no items', () => {
    expect(layout([], room).size).toEqual({ width: 0, height: 0 });
  });

  it('refuses a column count that is not a whole number of 1 or more', () => {
    expect(() => masonryLayout({ columns: 0, heightOf: () => 1 })).toThrow();
  });

  describe('carrying on from the first change', () => {
    interface Card {
      h: number;
    }
    const card = (h: number): Card => ({ h });
    /** A layout that records which indices it was asked the height of. */
    const counting = (columns = 3) => {
      const asked: number[] = [];
      const layout = masonryLayout<Card>({ columns, gap: 10, heightOf: (c, _w, i) => (asked.push(i), c.h) });
      return { layout, asked, take: () => asked.splice(0) };
    };
    const room3 = { width: 320, height: 600 };
    /** What a layout with nothing remembered makes of `data`. */
    const fresh = (data: readonly Card[], columns = 3, size = room3) =>
      masonryLayout<Card>({ columns, gap: 10, heightOf: (c) => c.h })(data, size);
    const same = (a: ReflowResult, b: ReflowResult, n: number) => {
      expect(a.size).toEqual(b.size);
      expect(rectsOf(a, n)).toEqual(rectsOf(b, n));
    };
    // Enough of them to cross several of its checkpoints.
    const cards = Array.from({ length: 150 }, (_, i) => card(20 + ((i * 37) % 80)));

    it('asks about every item the first time', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      expect(take()).toEqual(cards.map((_, i) => i));
    });

    it('asks only about what is added at the end', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      take();
      const more = [...cards, card(55), card(65)];
      const result = layout(more, room3);
      expect(take()).toEqual([150, 151]);
      same(result, fresh(more), more.length);
    });

    it('asks from the item that changed, not before it', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      take();
      for (const at of [0, 1, 63, 64, 65, 100, 149]) {
        const changed = cards.map((c, i) => (i === at ? card(c.h + 33) : c));
        const result = layout(changed, room3);
        expect(take()).toEqual(Array.from({ length: 150 - at }, (_, k) => at + k));
        same(result, fresh(changed), 150);
        // Back again: the same as the first.
        same(layout(cards, room3), fresh(cards), 150);
        take();
      }
    });

    it('asks from where one was put in the middle, as everything after it moved', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      take();
      const put = [...cards.slice(0, 70), card(45), ...cards.slice(70)];
      const result = layout(put, room3);
      expect(take()).toEqual(Array.from({ length: 81 }, (_, k) => 70 + k));
      same(result, fresh(put), put.length);
    });

    it('asks nothing when items are taken off the end', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      take();
      for (const n of [149, 128, 127, 64, 63, 1, 0]) {
        const fewer = cards.slice(0, n);
        const result = layout(fewer, room3);
        expect(take()).toEqual([]);
        same(result, fresh(fewer), n);
      }
    });

    it('asks nothing, and gives the same result, for the same items in a new array', () => {
      const { layout, take } = counting();
      const first = layout(cards, room3);
      take();
      expect(layout([...cards], room3)).toBe(first);
      expect(take()).toEqual([]);
    });

    it('places everything again when the width changes', () => {
      const { layout, take } = counting();
      layout(cards, room3);
      take();
      const narrow = { width: 200, height: 600 };
      const result = layout(cards, narrow);
      expect(take()).toHaveLength(150);
      same(result, fresh(cards, 3, narrow), 150);
      // A change of height alone is no change.
      layout(cards, { width: 200, height: 900 });
      expect(take()).toEqual([]);
    });

    it('does not change a result it gave before', () => {
      const { layout } = counting();
      const before = layout(cards, room3);
      const was = rectsOf(before, 150);
      layout([...cards.slice(0, 10), card(500), ...cards.slice(11)], room3);
      layout(cards.slice(0, 5), room3);
      expect(rectsOf(before, 150)).toEqual(was);
      expect(before.size).toEqual(fresh(cards).size);
    });

    it('comes to the same as starting afresh through any run of changes', () => {
      for (const columns of [1, 2, 3, 5]) {
        const { layout } = counting(columns);
        let data = cards.slice(0, 40);
        // A fixed sequence of edits, so a failure can be had again.
        let seed = columns * 7919;
        const random = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
        for (let step = 0; step < 60; step++) {
          const at = random(data.length + 1);
          switch (random(4)) {
            case 0:
              data = [...data, card(10 + random(90))];
              break;
            case 1:
              data = [...data.slice(0, at), card(10 + random(90)), ...data.slice(at)];
              break;
            case 2:
              data = [...data.slice(0, at), ...data.slice(at + 1)];
              break;
            default:
              data = data.map((c, i) => (i === at ? card(10 + random(90)) : c));
          }
          if (step % 9 === 0) data = [...data, ...cards.slice(0, random(80))];
          same(layout(data, room3), fresh(data, columns), data.length);
        }
      }
    });
  });
});

describe('pagedLayout', () => {
  // 2 columns × 3 rows a page, in a 200 × 300 room with 10pt gaps: a card is 95 × 93.33.
  const room = { width: 200, height: 300 };
  const horizontal = pagedLayout({ direction: 'horizontal', columns: 2, rows: 3, gap: 10, pageGap: 0 });
  const vertical = pagedLayout({ direction: 'vertical', columns: 2, rows: 3, gap: 10, pageGap: 0 });
  const CARD_H = (300 - 20) / 3;

  it('fills a page a row at a time, then starts the next one a room further along', () => {
    const rects = rectsOf(horizontal(items(8), room), 8);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 95, height: expect.closeTo(CARD_H, 5) });
    expect(rects[1]!.x).toBe(105);
    expect(rects[2]!.y).toBeCloseTo(CARD_H + 10, 5);
    // The seventh item starts the second page.
    expect(rects[6]).toMatchObject({ x: 200, y: 0 });
    expect(rects[7]).toMatchObject({ x: 305, y: 0 });
  });

  it('puts the pages one under another when vertical', () => {
    const rects = rectsOf(vertical(items(8), room), 8);
    expect(rects[6]).toMatchObject({ x: 0, y: 300 });
    expect(rects[7]).toMatchObject({ x: 105, y: 300 });
  });

  it('sizes the content to whole pages, and says how they are laid out', () => {
    const h = horizontal(items(8), room);
    expect(h.size).toEqual({ width: 400, height: 300 });
    expect(h.pages).toEqual({ count: 2, stride: 200, direction: 'horizontal', perPage: 6 });
    const v = vertical(items(13), room);
    expect(v.size).toEqual({ width: 200, height: 900 });
    expect(v.pages).toMatchObject({ count: 3, stride: 300, direction: 'vertical' });
  });

  it('is empty with no items', () => {
    const result = horizontal([], room);
    expect(result.size).toEqual({ width: 0, height: 0 });
    expect(result.indicesIn({ x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 })).toEqual([]);
  });

  it('leaves a page gap between the items of one page and the next, half at each end of a page', () => {
    // The default is the gap along the way the pages go: 10. Items sit 5 in from each end of a page.
    const result = pagedLayout({ direction: 'horizontal', columns: 2, rows: 3, gap: 10 })(items(8), room);
    const rects = rectsOf(result, 8);
    expect(rects[0]).toMatchObject({ x: 5, width: 90 });
    expect(rects[1]).toMatchObject({ x: 105, width: 90 });
    // Page one's right edge is at 195; page two's items start at 205: a gap of 10, as between its own columns.
    expect(rects[6]!.x - (rects[1]!.x + rects[1]!.width)).toBe(10);
    // The pages are still a room apart, so the grid snaps to them as it did.
    expect(result.pages).toMatchObject({ stride: 200 });
    expect(result.size).toEqual({ width: 400, height: 300 });
  });

  it('takes the page gap from the option, and only along the way the pages go', () => {
    const wide = pagedLayout({ direction: 'horizontal', columns: 2, rows: 3, gap: 10, pageGap: 40 })(items(8), room);
    expect(wide.rectOf(0)).toMatchObject({ x: 20, y: 0, width: 75 });
    const down = pagedLayout({ direction: 'vertical', columns: 2, rows: 3, gap: 10, pageGap: 40 })(items(8), room);
    expect(down.rectOf(0)).toMatchObject({ x: 0, y: 20, width: 95 });
    expect(down.rectOf(6)).toMatchObject({ y: 320 });
    // Cards of a fixed size sit in from the start of a page, too.
    const fixed = pagedLayout({ direction: 'horizontal', columns: 2, rows: 1, gap: 10, pageGap: 20, card: { width: 30, height: 30 } })(items(3), room);
    expect(fixed.rectOf(0).x).toBe(10);
    expect(fixed.rectOf(2).x).toBe(210);
  });

  it('can give the cards an aspect ratio or a fixed size', () => {
    const aspect = pagedLayout({ direction: 'horizontal', columns: 2, rows: 2, card: { aspect: 0.5 } })(items(1), room);
    expect(aspect.rectOf(0)).toMatchObject({ width: 100, height: 200 });
    const fixed = pagedLayout({ direction: 'vertical', columns: 3, rows: 2, gap: 4, pageGap: 0, card: { width: 40, height: 30 } })(items(4), room);
    expect(rectsOf(fixed, 4).map((r) => [r.x, r.y, r.width, r.height])).toEqual([
      [0, 0, 40, 30],
      [44, 0, 40, 30],
      [88, 0, 40, 30],
      [0, 34, 40, 30],
    ]);
  });

  it('finds the same items in a region as a scan does', () => {
    const regions: Region[] = Array.from({ length: 80 }, (_, k) => {
      const x0 = ((k * 53) % 900) - 100;
      const y0 = ((k * 71) % 700) - 80;
      return { x0, x1: x0 + 15 + ((k * 37) % 400), y0, y1: y0 + 15 + ((k * 23) % 500) };
    });
    const spaced = [
      pagedLayout({ direction: 'horizontal', columns: 2, rows: 3, gap: 10 }),
      pagedLayout({ direction: 'vertical', columns: 3, rows: 2, gap: { x: 4, y: 8 }, pageGap: 30 }),
    ];
    for (const layout of [horizontal, vertical, ...spaced]) {
      for (const count of [0, 1, 6, 7, 20, 50]) {
        const result = layout(items(count), room);
        for (const region of regions) expect(result.indicesIn(region)).toEqual(scan(result, count, region));
      }
    }
  });

  it('refuses columns or rows that are not whole numbers of 1 or more, and a card with no size', () => {
    expect(() => pagedLayout({ direction: 'horizontal', columns: 0, rows: 2 })).toThrow();
    expect(() => pagedLayout({ direction: 'horizontal', columns: 2, rows: 1.5 })).toThrow();
    expect(() => pagedLayout({ direction: 'horizontal', columns: 2, rows: 2, card: { width: 0, height: 5 } })).toThrow();
  });
});
