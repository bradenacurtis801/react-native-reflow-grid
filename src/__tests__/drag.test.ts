import { beginDrag, edgeVelocity, endDrag, hoverIndex, moveKeys, slotAt, updateDrag, type DragSession } from '../drag';
import { gridLayout, layoutFromRects, pagedLayout } from '../layout';

const keys = (n: number) => Array.from({ length: n }, (_, i) => String(i));
const session = (...dragged: string[]): DragSession => ({ origin: 'internal', items: dragged.map((key) => ({ key, types: ['text/plain'] })) });

// 3 columns of 100 × 100 cards with 10pt gaps, in a 320-wide room: a slot's origin is (110 × column, 110 × row).
const layout = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 1 } })(keys(8), { width: 320, height: 600 });
/** The centre of slot `i`. */
const centre = (i: number) => {
  const r = layout.rectOf(i);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

describe('moveKeys', () => {
  it('puts one key at an index, the others closing up behind it', () => {
    expect(moveKeys(keys(5), ['1'], 3)).toEqual(['0', '2', '3', '1', '4']);
    expect(moveKeys(keys(5), ['3'], 1)).toEqual(['0', '3', '1', '2', '4']);
  });

  it('keeps several together, in the order they had', () => {
    expect(moveKeys(keys(6), ['4', '1'], 3)).toEqual(['0', '2', '3', '1', '4', '5']);
  });

  it('clamps the index to the ends', () => {
    expect(moveKeys(keys(4), ['1'], 99)).toEqual(['0', '2', '3', '1']);
    expect(moveKeys(keys(4), ['2'], -5)).toEqual(['2', '0', '1', '3']);
    expect(moveKeys(keys(4), ['0', '1'], 99)).toEqual(['2', '3', '0', '1']);
  });
});

describe('slotAt', () => {
  it('finds the slot a point is over', () => {
    expect(slotAt(layout, 8, centre(4))).toBe(4);
    expect(slotAt(layout, 8, { x: 1, y: 1 })).toBe(0);
  });

  it('finds the nearest slot from a gap or from off the content', () => {
    expect(slotAt(layout, 8, { x: 105, y: 50 })).toBeDefined(); // the gap between 0 and 1
    expect(slotAt(layout, 8, { x: 150, y: 2000 })).toBe(7);
    expect(slotAt(layout, 8, { x: -500, y: -500 })).toBe(0);
  });

  it('has none when there are no items', () => {
    expect(slotAt(gridLayout({ flow: 'vertical', lines: 3 })([], { width: 300, height: 300 }), 0, { x: 5, y: 5 })).toBeUndefined();
  });

  it('only looks at the slots near the point', () => {
    const asked: number[] = [];
    const many = gridLayout({ flow: 'vertical', lines: 3, gap: 10, card: { aspect: 1 } })(keys(30000), { width: 320, height: 600 });
    const spy = { ...many, indicesIn: (region: Parameters<typeof many.indicesIn>[0]) => (asked.push((region.x1 - region.x0) * (region.y1 - region.y0)), many.indicesIn(region)) };
    expect(slotAt(spy, 30000, { x: 5, y: 600_000 })).toBe(many.indicesIn({ x0: 0, x1: 1, y0: 600_000, y1: 600_001 })[0]);
    // A handful of small regions, never one covering the lot.
    expect(asked.length).toBeLessThan(30);
  });
});

describe('hoverIndex', () => {
  it('takes the slot the finger is over when there is none to stay in', () => {
    expect(hoverIndex(layout, 8, centre(5))).toBe(5);
  });

  it('stays in the current slot while the finger is only just inside the next', () => {
    // Slot 1 starts at x = 110: 5pt in is inside it, but not by a quarter of its width.
    expect(hoverIndex(layout, 8, { x: 115, y: 50 }, 0)).toBe(0);
    expect(hoverIndex(layout, 8, { x: 140, y: 50 }, 0)).toBe(1);
  });

  it('moves at once to a far slot, however near its edge the finger is', () => {
    // Slot 7 starts at y = 220; 5pt into it is nowhere near deep, but slot 0 is far behind.
    expect(hoverIndex(layout, 8, { x: 150, y: 225 }, 0)).toBe(7);
  });

  it('stays put in a gap between slots', () => {
    expect(hoverIndex(layout, 8, { x: 105, y: 50 }, 0)).toBe(0);
    expect(hoverIndex(layout, 8, { x: 105, y: 50 }, 1)).toBe(1);
  });

  it('follows the finger straight off the content, to the nearest slot', () => {
    expect(hoverIndex(layout, 8, { x: 150, y: 5000 }, 0)).toBe(7);
  });

  it('keeps the current one when there are no slots', () => {
    const empty = gridLayout({ flow: 'vertical', lines: 3 })([], { width: 300, height: 300 });
    expect(hoverIndex(empty, 0, { x: 5, y: 5 }, 2)).toBe(2);
  });
});

describe('beginDrag', () => {
  it('starts with the dragged item in its own slot, nothing moved', () => {
    const state = beginDrag(keys(5), session('3'))!;
    expect(state.target).toBe(3);
    expect(state.dragged).toEqual(['3']);
    expect(state.preview).toEqual(keys(5));
  });

  it('keeps several dragged items in the order they have in the grid', () => {
    expect(beginDrag(keys(5), session('4', '1'))!.dragged).toEqual(['1', '4']);
  });

  it('ignores items that are not in the grid, and has no state for a drag with none of its own', () => {
    expect(beginDrag(keys(5), { origin: 'external', items: [{ types: ['public.url'] }] })).toBeUndefined();
    expect(beginDrag(keys(5), session('nope'))).toBeUndefined();
    expect(beginDrag(keys(5), { origin: 'internal', items: [{ key: '2', types: [] }, { types: [] }] })!.dragged).toEqual(['2']);
  });
});

describe('updateDrag and endDrag', () => {
  const all = keys(8);

  it('moves the preview as the finger crosses slots, and hands back the same state when it has not moved on', () => {
    const begun = beginDrag(all, session('1'))!;
    const over4 = updateDrag(begun, layout, centre(4));
    expect(over4.preview).toEqual(['0', '2', '3', '4', '1', '5', '6', '7']);
    expect(updateDrag(over4, layout, centre(4))).toBe(over4);
    expect(updateDrag(over4, layout, { x: centre(4).x + 2, y: centre(4).y })).toBe(over4);
  });

  it('can be dragged back, and then drops as a no-op', () => {
    let state = beginDrag(all, session('1'))!;
    state = updateDrag(state, layout, centre(6));
    state = updateDrag(state, layout, centre(1));
    expect(state.preview).toEqual(all);
    expect(endDrag(state)).toBeUndefined();
  });

  it('reports what a drop changed', () => {
    let state = beginDrag(all, session('1'))!;
    state = updateDrag(state, layout, centre(4));
    expect(endDrag(state)).toEqual({ keys: ['0', '2', '3', '4', '1', '5', '6', '7'], moved: ['1'], from: 1, to: 4 });
  });

  it('reports nothing for a cancelled drag', () => {
    const state = updateDrag(beginDrag(all, session('1'))!, layout, centre(4));
    expect(endDrag(state, true)).toBeUndefined();
  });

  it('moves a block of several, landing the first of them on the target', () => {
    let state = beginDrag(all, session('1', '2'))!;
    state = updateDrag(state, layout, centre(5));
    expect(state.preview).toEqual(['0', '3', '4', '5', '6', '1', '2', '7']);
    expect(endDrag(state)).toEqual({ keys: state.preview, moved: ['1', '2'], from: 1, to: 5 });
  });

  it('puts a block that is dragged past the end at the end', () => {
    let state = beginDrag(all, session('0', '1'))!;
    state = updateDrag(state, layout, { x: 150, y: 5000 });
    expect(state.preview).toEqual(['2', '3', '4', '5', '6', '7', '0', '1']);
  });

  it('hit-tests the layout it was given, not the preview, so the target does not flip under a resting finger', () => {
    let state = beginDrag(all, session('0'))!;
    const rest = centre(3);
    state = updateDrag(state, layout, rest);
    const settled = state;
    for (let i = 0; i < 5; i++) state = updateDrag(state, layout, rest);
    expect(state).toBe(settled);
  });

  it('works on a layout that answers from an array of rects', () => {
    const rects = Array.from({ length: 4 }, (_, i) => ({ x: i * 50, y: 0, width: 40, height: 40 }));
    const strip = layoutFromRects(rects, { width: 190, height: 40 });
    const state = updateDrag(beginDrag(keys(4), session('0'))!, strip, { x: 170, y: 20 });
    expect(state.preview).toEqual(['1', '2', '3', '0']);
  });
});

describe('edgeVelocity', () => {
  // A view from 100 to 600, a 50pt band, 1000pt/s at most.
  const at = (pos: number) => edgeVelocity(pos, 100, 600, 50, 1000);

  it('is still in the middle, and in the bands only just not touching them', () => {
    expect(at(350)).toBe(0);
    expect(at(150)).toBe(0);
    expect(at(550)).toBe(0);
  });

  it('scrolls towards the start near the start, and towards the end near the end', () => {
    expect(at(125)).toBeLessThan(0);
    expect(at(575)).toBeGreaterThan(0);
  });

  it('speeds up towards the edge, and holds the top speed at it and beyond', () => {
    expect(Math.abs(at(110))).toBeGreaterThan(Math.abs(at(125)));
    expect(at(100)).toBe(-1000);
    expect(at(-400)).toBe(-1000);
    expect(at(600)).toBe(1000);
    expect(at(9000)).toBe(1000);
  });

  it('keeps each band to a third of a small view, so there is a middle that stays still', () => {
    expect(edgeVelocity(150, 100, 190, 50, 1000)).toBe(0);
    expect(edgeVelocity(104, 100, 190, 50, 1000)).toBeLessThan(0);
  });

  it('has nothing to scroll in a view with no room', () => {
    expect(edgeVelocity(5, 10, 10)).toBe(0);
    expect(edgeVelocity(5, 20, 10)).toBe(0);
  });
});

describe('in a paged layout', () => {
  // Two pages side by side, 2 × 2 cards a page, in a 200 × 200 room: a card is 100 × 100, page two starts at x = 200.
  const pages = pagedLayout({ direction: 'horizontal', columns: 2, rows: 2 })(keys(6), { width: 200, height: 200 });

  it('looks only among the slots of the page the point is on', () => {
    // Just inside page two, but nearer the right edge of page one's cards than page two's own.
    expect(slotAt(pages, 6, { x: 201, y: 50 })).toBe(4);
    expect(slotAt(pages, 6, { x: 199, y: 50 })).toBe(1);
  });

  it('finds a slot on the last page, partly empty, from the empty part of it', () => {
    // Page two holds items 4 and 5 only; its lower half is empty.
    expect(slotAt(pages, 6, { x: 250, y: 190 })).toBe(4);
    expect(slotAt(pages, 6, { x: 350, y: 190 })).toBe(5);
  });

  it('takes the last page for a point beyond the end', () => {
    expect(slotAt(pages, 6, { x: 5000, y: 50 })).toBe(5);
  });

  it('drags an item to another page by being over it', () => {
    let state = beginDrag(keys(6), session('0'))!;
    state = updateDrag(state, pages, { x: 350, y: 50 });
    expect(state.preview).toEqual(['1', '2', '3', '4', '5', '0']);
  });
});
