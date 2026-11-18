import { gridLayout, intersects, layoutFromRects, masonryLayout, type Rect, type ReflowLayout, type ReflowResult, type Region } from '../layout';

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
});
