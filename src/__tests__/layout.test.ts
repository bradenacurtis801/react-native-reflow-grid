import { gridLayout } from '../layout';

describe('gridLayout, vertical flow', () => {
  // 3 columns across a 340pt room with 10pt gaps: each card is (340 - 20) / 3 wide.
  const CARD_W = 320 / 3;
  const layout = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 0.75 } });
  const room = { width: 340, height: 600 };

  it('fills a row across, then starts the next one under it', () => {
    const { rects } = layout(5, room);
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
    const { size, rects } = layout(3, room);
    expect(size.width).toBeCloseTo(340, 5);
    expect(rects[0]!.width).toBeCloseTo(CARD_W, 5);
  });

  it('takes its length from the aspect ratio', () => {
    expect(layout(1, room).rects[0]!.height).toBeCloseTo(CARD_W / 0.75, 5);
  });

  it('is empty with no items', () => {
    expect(layout(0, room)).toEqual({ rects: [], size: { width: 0, height: 0 } });
  });

  it('uses a fixed length when given', () => {
    const fixed = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { length: 140 } });
    expect(fixed(1, room).rects[0]!.height).toBe(140);
    expect(fixed(4, room).size.height).toBe(140 * 2 + 10);
  });
});

describe('gridLayout, horizontal flow', () => {
  // 2 rows down a 124pt-high room with a 4pt gap: each row is (124 - 4) / 2 = 60 tall.
  const room = { width: 300, height: 124 };

  it('fills a column down, then starts the next one beside it', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { length: 80 } });
    const { rects } = layout(5, room);
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
    expect(layout(1, room).size.height).toBe(124);
  });

  it('takes its width from the aspect ratio', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 1, card: { aspect: 0.5 } });
    expect(layout(2, { width: 300, height: 100 }).rects[0]!.width).toBe(50);
  });

  it('keeps its full height with one item, and grows wider as columns are added', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { length: 80 } });
    expect(layout(1, room).size).toEqual({ width: 80, height: 124 });
    expect(layout(5, room).size).toEqual({ width: 256, height: 124 });
  });
});

describe('gridLayout, one line', () => {
  it('makes a list from one column', () => {
    const list = gridLayout({ flow: 'vertical', lines: 1, gap: 6, card: { length: 40 } });
    expect(list(3, { width: 300, height: 600 }).rects.map((r) => r.y)).toEqual([0, 46, 92]);
  });

  it('makes a strip from one row', () => {
    const strip = gridLayout({ flow: 'horizontal', lines: 1, gap: 5, card: { length: 50 } });
    expect(strip(3, { width: 300, height: 100 }).rects.map((r) => r.x)).toEqual([0, 55, 110]);
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
    const { rects, size } = layout(5, tiny);
    expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual([
      [0, 0, 100, 50],
      [110, 0, 100, 50],
      [0, 60, 100, 50],
      [110, 60, 100, 50],
      [0, 120, 100, 50],
    ]);
    expect(size).toEqual({ width: 210, height: 170 });
  });

  it('places a horizontal grid by columns, and sizes the content to its cards', () => {
    const layout = gridLayout({ flow: 'horizontal', lines: 2, gap: { x: 8, y: 4 }, card: { width: 80, height: 40 } });
    const { rects, size } = layout(5, tiny);
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [0, 44],
      [88, 0],
      [88, 44],
      [176, 0],
    ]);
    expect(size).toEqual({ width: 256, height: 84 });
  });

  it('refuses a card with no size', () => {
    expect(() => gridLayout({ flow: 'vertical', lines: 1, card: { width: 0, height: 10 } })).toThrow();
  });
});
