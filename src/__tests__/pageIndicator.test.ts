import { dotLook, edgeMargin, edgeScale, pagesPerPoint, scrubPage, slideStart } from '../pageIndicator';

describe('edgeScale', () => {
  it('is small at the end of the row, and full size from the third dot in', () => {
    expect(edgeScale(0)).toBe(0.55);
    expect(edgeScale(1)).toBe(0.8);
    expect(edgeScale(2)).toBe(1);
    expect(edgeScale(5)).toBe(1);
  });

  it('is continuous, so a sliding row changes smoothly', () => {
    let last = edgeScale(-0.5);
    for (let d = -0.4; d <= 3; d += 0.1) {
      const now = edgeScale(d);
      expect(Math.abs(now - last)).toBeLessThan(0.05);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe('edgeMargin', () => {
  it('keeps the page on screen out of the shrunk dots, and out of the way in a short row', () => {
    expect(edgeMargin(7)).toBe(2);
    expect(edgeMargin(5)).toBe(2);
    expect(edgeMargin(3)).toBe(1);
    expect(edgeMargin(1)).toBe(0);
  });
});

describe('slideStart', () => {
  // A row of 7 dots over 30 pages, the page on screen kept 2 in from its ends.
  const next = (start: number, p: number) => slideStart(start, p, 7, 30, 2);

  it('does not move while the page on screen is inside the row', () => {
    expect(next(0, 0)).toBe(0);
    expect(next(0, 3)).toBe(0);
    expect(next(0, 4)).toBe(0);
    expect(next(10, 12.5)).toBe(10);
  });

  it('carries the row along once the page on screen reaches its end, in step with the swipe', () => {
    // Page 4 is the 5th dot: the last it may be. Past it the row follows.
    expect(next(0, 4)).toBe(0);
    expect(next(0, 4.5)).toBeCloseTo(0.5, 10);
    expect(next(0, 5)).toBe(1);
    expect(next(1, 5.25)).toBeCloseTo(1.25, 10);
  });

  it('slides back the other way too, and holds the page inside the row', () => {
    expect(next(10, 12)).toBe(10);
    expect(next(10, 11.5)).toBeCloseTo(9.5, 10);
    for (let p = 0; p <= 29; p += 0.25) {
      const s = next(next(0, Math.max(p - 1, 0)), p);
      expect(p).toBeGreaterThanOrEqual(s);
      expect(p).toBeLessThanOrEqual(s + 6);
    }
  });

  it('stays within the pages, and still when they all fit', () => {
    expect(next(0, 29)).toBe(23);
    expect(next(23, 0)).toBe(0);
    expect(slideStart(0, 3, 4, 4, 1)).toBe(0);
    expect(slideStart(0, 3, 7, 4, 2)).toBe(0);
  });
});

describe('dotLook', () => {
  it('lights the dot of the page on screen, and none of the others', () => {
    expect(dotLook(3, 3, 0, 7, 30).lit).toBe(1);
    expect(dotLook(2, 3, 0, 7, 30).lit).toBe(0);
    expect(dotLook(4, 3, 0, 7, 30).lit).toBe(0);
  });

  it('hands the light from one dot to the next in step with the swipe', () => {
    for (const p of [3, 3.25, 3.5, 3.75, 4]) {
      const here = dotLook(3, p, 0, 7, 30).lit;
      const there = dotLook(4, p, 0, 7, 30).lit;
      // Half way, both are half lit; the light always adds up to one between two pages.
      expect(here + there).toBeCloseTo(1, 10);
    }
    expect(dotLook(3, 3.5, 0, 7, 30).lit).toBe(0.5);
    expect(dotLook(4, 3.5, 0, 7, 30).lit).toBe(0.5);
  });

  it('places the dots along the row from where it starts', () => {
    expect(dotLook(10, 10, 8, 7, 30).x).toBe(2);
    expect(dotLook(10, 10, 8.5, 7, 30).x).toBe(1.5);
  });

  it('shrinks the dots at an end only where there are more pages beyond it', () => {
    // At the start the first dot is the first page: full size. The last has more beyond it.
    expect(dotLook(0, 0, 0, 7, 30).scale).toBe(1);
    expect(dotLook(6, 0, 0, 7, 30).scale).toBe(edgeScale(0));
    // In the middle both ends shrink.
    expect(dotLook(8, 10, 8, 7, 30).scale).toBe(edgeScale(0));
    expect(dotLook(14, 10, 8, 7, 30).scale).toBe(edgeScale(0));
    expect(dotLook(11, 10, 8, 7, 30).scale).toBe(1);
    // At the end the last dot is the last page: full size.
    expect(dotLook(29, 29, 23, 7, 30).scale).toBe(1);
    expect(dotLook(23, 29, 23, 7, 30).scale).toBe(edgeScale(0));
  });

  it('changes smoothly as the row starts to slide off the first page', () => {
    let last = dotLook(2, 0, 0, 7, 30).scale;
    for (let s = 0.1; s <= 1; s += 0.1) {
      const now = dotLook(2, 0, s, 7, 30).scale;
      expect(Math.abs(now - last)).toBeLessThan(0.1);
      last = now;
    }
  });

  it('fades a dot as it slides out of either end of the row, and shows none that is past it', () => {
    expect(dotLook(5, 7, 6, 7, 30).alpha).toBe(0);
    expect(dotLook(5.5, 7, 6, 7, 30).alpha).toBe(0.5);
    expect(dotLook(6, 7, 6, 7, 30).alpha).toBe(1);
    expect(dotLook(12, 7, 6, 7, 30).alpha).toBe(1);
    expect(dotLook(13, 7, 6, 7, 30).alpha).toBe(0);
    expect(dotLook(12.5, 7, 6, 7, 30).alpha).toBe(0.5);
  });
});

describe('scrubbing', () => {
  // A row of 7 dots, each 16pt apart: 96pt from the first to the last.
  it('has the row stand for all the pages, so a short drag goes a long way', () => {
    expect(scrubPage(0, 96, 52, 7, 16)).toBe(51);
    expect(scrubPage(0, 48, 52, 7, 16)).toBeGreaterThan(24);
    expect(scrubPage(0, 48, 52, 7, 16)).toBeLessThan(28);
    expect(pagesPerPoint(52, 7, 16)).toBeCloseTo(51 / 96, 10);
  });

  it('moves a page for every dot it passes when the pages fit in the row', () => {
    expect(scrubPage(0, 16, 7, 7, 16)).toBe(1);
    expect(scrubPage(2, 32, 7, 7, 16)).toBe(4);
    expect(scrubPage(3, 16, 4, 4, 16)).toBe(3);
    // Fewer pages than dots: still a page a dot.
    expect(scrubPage(0, 16, 3, 3, 16)).toBe(1);
  });

  it('goes back when dragged back, and from where it began, not from the start', () => {
    expect(scrubPage(40, -96, 52, 7, 16)).toBe(0);
    expect(scrubPage(20, -16, 52, 7, 16)).toBeLessThan(20);
    expect(scrubPage(20, 0, 52, 7, 16)).toBe(20);
  });

  it('stays among the pages', () => {
    expect(scrubPage(50, 500, 52, 7, 16)).toBe(51);
    expect(scrubPage(2, -500, 52, 7, 16)).toBe(0);
    expect(scrubPage(0, 100, 1, 1, 16)).toBe(0);
  });

  it('is steady: a drag that comes back to where it began lands where it began', () => {
    for (const start of [0, 7, 25, 51]) expect(scrubPage(start, 0, 52, 7, 16)).toBe(start);
  });
});
