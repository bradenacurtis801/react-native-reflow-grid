import { dotLook, edgeMargin, edgeScale, parseColor, readableOn, SCRUB_FAST, SCRUB_SLOW, scrubGain, scrubStep, slideStart, tapPage } from '../pageIndicator';

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
  // Dots 16pt apart; a coarse drag across 400pt covers all the pages.
  const gain = (speed: number, count = 52) => scrubGain(speed, count, 16, 400);

  it('follows the dots when slow: a page for every dot width', () => {
    expect(gain(0)).toBeCloseTo(1 / 16, 10);
    expect(gain(SCRUB_SLOW)).toBeCloseTo(1 / 16, 10);
    expect(scrubStep(10, 16, 200, 52, 16, 400)).toBeCloseTo(11, 10);
  });

  it('goes further when fast, until a drag across the track covers all the pages', () => {
    expect(gain(SCRUB_FAST)).toBeCloseTo(51 / 400, 10);
    expect(gain(SCRUB_FAST * 5)).toBeCloseTo(51 / 400, 10);
    // 400pt in one flick is 51 pages: the whole of it.
    expect(scrubStep(0, 400, 100, 52, 16, 400)).toBeCloseTo(51, 6);
  });

  it('speeds up smoothly with the finger, never slows as it gets faster', () => {
    let last = gain(0);
    for (let speed = 0.05; speed <= 2; speed += 0.05) {
      const now = gain(speed);
      expect(now).toBeGreaterThanOrEqual(last - 1e-12);
      last = now;
    }
  });

  it('is far gentler than a row-length map: a 16pt twitch is a page or so, not eight', () => {
    // The old mapping gave 52 pages over a 96pt row: 8.5 pages for a 16pt movement.
    expect(scrubStep(20, 16, 100, 52, 16, 400)).toBeLessThan(22);
  });

  it('stays the same however fast when the pages fit the dots', () => {
    expect(gain(0, 7)).toBe(gain(SCRUB_FAST, 7));
    expect(gain(0, 20)).toBe(gain(SCRUB_FAST, 20));
  });

  it('goes back when dragged back, and stays among the pages', () => {
    expect(scrubStep(10, -16, 200, 52, 16, 400)).toBeCloseTo(9, 10);
    expect(scrubStep(1, -500, 50, 52, 16, 400)).toBe(0);
    expect(scrubStep(50, 500, 50, 52, 16, 400)).toBe(51);
    expect(scrubStep(0, 100, 50, 1, 16, 400)).toBe(0);
  });

  it('does not move when the finger does not', () => {
    for (const start of [0, 7, 25, 51]) expect(scrubStep(start, 0, 16, 52, 16, 400)).toBe(start);
  });

  it('can stop on any page with a careful drag', () => {
    // Fingers move a few points at a time, slowly: every page is reached in order.
    let position = 20;
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      position = scrubStep(position, 2, 30, 52, 16, 400);
      seen.add(Math.round(position));
    }
    for (let page = 21; page < 28; page++) expect(seen.has(page)).toBe(true);
  });
});

describe('tapPage', () => {
  // A row of dots 16pt apart, the row starting at page 0, then at page 10.
  it('is the page of the dot touched', () => {
    expect(tapPage(8, 0, 52, 16)).toBe(0);
    expect(tapPage(24, 0, 52, 16)).toBe(1);
    expect(tapPage(104, 0, 52, 16)).toBe(6);
    expect(tapPage(8, 10, 52, 16)).toBe(10);
    expect(tapPage(104, 10, 52, 16)).toBe(16);
  });

  it('takes a touch between two dots to the nearer, and follows a row that is sliding', () => {
    // The first dot's slot runs to 16: a touch at 15 is still on it, and 17 is on the second.
    expect(tapPage(15, 0, 52, 16)).toBe(0);
    expect(tapPage(17, 0, 52, 16)).toBe(1);
    // With the row half a dot along, page 2's slot is -8 to 8 and page 3's 8 to 24.
    expect(tapPage(2, 2.5, 52, 16)).toBe(2);
    expect(tapPage(14, 2.5, 52, 16)).toBe(3);
    expect(tapPage(30, 2.5, 52, 16)).toBe(4);
  });

  it('stays among the pages, even for a touch on the padding around the dots', () => {
    expect(tapPage(-30, 0, 52, 16)).toBe(0);
    expect(tapPage(500, 40, 52, 16)).toBe(51);
    expect(tapPage(5, 0, 1, 16)).toBe(0);
  });
});

describe('readableOn', () => {
  it('puts black on a light colour and white on a dark one, whatever the screen is set to', () => {
    expect(readableOn('#fff')).toBe('#000');
    expect(readableOn('#ffffff')).toBe('#000');
    expect(readableOn('white')).toBe('#000');
    expect(readableOn('#000')).toBe('#fff');
    expect(readableOn('black')).toBe('#fff');
    expect(readableOn('rgba(0,0,0,0.9)')).toBe('#fff');
    expect(readableOn('rgb(250, 250, 250)')).toBe('#000');
  });

  it('judges by the light a colour gives, not by its numbers', () => {
    // A strong yellow is light; a strong blue is dark; mid greys are the edge.
    expect(readableOn('#ffd400')).toBe('#000');
    expect(readableOn('#1a3cff')).toBe('#fff');
    expect(readableOn('#7a1020')).toBe('#fff');
    expect(readableOn('#3ccf8e')).toBe('#000');
  });

  it('understands hex in its short and long forms, with or without alpha, and rgb()', () => {
    expect(parseColor('#abc')).toEqual([170, 187, 204]);
    expect(parseColor('#aabbcc')).toEqual([170, 187, 204]);
    expect(parseColor('#aabbccdd')).toEqual([170, 187, 204]);
    expect(parseColor('#abcd')).toEqual([170, 187, 204]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
  });

  it('has no answer for a colour it does not understand, so a default can step in', () => {
    expect(readableOn('hsl(10, 50%, 50%)')).toBeUndefined();
    expect(readableOn('PlatformColor')).toBeUndefined();
    expect(readableOn('')).toBeUndefined();
  });
});
