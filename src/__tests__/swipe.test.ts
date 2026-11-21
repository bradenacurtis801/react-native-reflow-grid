import { SLOP } from '../dragEngine';
import { classifyMove, exitDuration, exitTarget, limitOffset, moveVelocity, startVelocity, swipeAllowed, swipeDirection, swipeOutcome } from '../swipe';

describe('classifyMove', () => {
  it('waits while the finger is within the slop', () => {
    expect(classifyMove(SLOP / 2, 0)).toBe('wait');
    expect(classifyMove(0, -SLOP)).toBe('wait');
  });

  it('is a swipe when the finger goes across the scroll', () => {
    expect(classifyMove(30, 4)).toBe('swipe');
    expect(classifyMove(-30, 4)).toBe('swipe');
  });

  it('is a scroll when the finger goes along it', () => {
    expect(classifyMove(4, 30)).toBe('scroll');
    expect(classifyMove(4, -30)).toBe('scroll');
  });

  it('is a scroll on a diagonal, which has to be clearly across to be a swipe', () => {
    expect(classifyMove(20, 20)).toBe('scroll');
    expect(classifyMove(22, 20)).toBe('scroll');
    expect(classifyMove(26, 20)).toBe('swipe');
  });
});

describe('swipeOutcome', () => {
  it('commits past two fifths of the size', () => {
    expect(swipeOutcome(-81, 0, 200)).toBe('commit');
    expect(swipeOutcome(81, 0, 200)).toBe('commit');
  });

  it('springs back short of that, let go slowly', () => {
    expect(swipeOutcome(-60, 0, 200)).toBe('return');
    expect(swipeOutcome(60, -50, 200)).toBe('return');
  });

  it('commits a flick the way it went, even a short one', () => {
    expect(swipeOutcome(-40, -900, 200)).toBe('commit');
    expect(swipeOutcome(40, 900, 200)).toBe('commit');
  });

  it('does not commit a flick back the way it came, or one that has hardly moved', () => {
    expect(swipeOutcome(-40, 900, 200)).toBe('return');
    expect(swipeOutcome(-10, -900, 200)).toBe('return');
  });
});

describe('swipeDirection', () => {
  it('is left or right along x', () => {
    expect(swipeDirection(-5, true)).toBe('left');
    expect(swipeDirection(5, true)).toBe('right');
  });

  it('is up or down along y', () => {
    expect(swipeDirection(-5, false)).toBe('up');
    expect(swipeDirection(5, false)).toBe('down');
  });
});

describe('swipeAllowed', () => {
  it('is either way when no directions are given', () => {
    expect(swipeAllowed(undefined, true)).toEqual({ negative: true, positive: true });
    expect(swipeAllowed(undefined, false)).toEqual({ negative: true, positive: true });
  });

  it('reads left and right along x', () => {
    expect(swipeAllowed(['left'], true)).toEqual({ negative: true, positive: false });
    expect(swipeAllowed(['right'], true)).toEqual({ negative: false, positive: true });
    expect(swipeAllowed(['left', 'right'], true)).toEqual({ negative: true, positive: true });
  });

  it('reads up and down along y', () => {
    expect(swipeAllowed(['up'], false)).toEqual({ negative: true, positive: false });
    expect(swipeAllowed(['down'], false)).toEqual({ negative: false, positive: true });
  });

  it('ignores directions that are not along the swipe', () => {
    expect(swipeAllowed(['up', 'down'], true)).toEqual({ negative: false, positive: false });
    expect(swipeAllowed(['left'], false)).toEqual({ negative: false, positive: false });
  });

  it('allows nothing for an empty list', () => {
    expect(swipeAllowed([], true)).toEqual({ negative: false, positive: false });
  });
});

describe('limitOffset', () => {
  const leftOnly = { negative: true, positive: false };

  it('lets an item go the way it may', () => {
    expect(limitOffset(-120, leftOnly)).toBe(-120);
  });

  it('holds it at its slot the way it may not', () => {
    expect(limitOffset(120, leftOnly)).toBe(0);
    expect(limitOffset(-120, { negative: false, positive: true })).toBe(0);
  });

  it('leaves zero alone, and lets either way go when both are allowed', () => {
    expect(limitOffset(0, leftOnly)).toBe(0);
    expect(limitOffset(75, { negative: true, positive: true })).toBe(75);
    expect(limitOffset(-75, { negative: true, positive: true })).toBe(-75);
  });
});

describe('exitTarget', () => {
  // A slot 200 across, 20 in from the start edge, in a grid 400 across.
  it('flies clear of the start edge, going that way', () => {
    expect(exitTarget(-100, 20, 200, 400)).toBe(-(20 + 200 + 24));
  });

  it('flies clear of the end edge, going that way', () => {
    expect(exitTarget(100, 20, 200, 400)).toBe(400 - 20 + 24);
  });

  it('goes further from a slot that is further from the edge it goes to', () => {
    expect(exitTarget(-100, 220, 200, 400)).toBeLessThan(exitTarget(-100, 20, 200, 400));
  });
});

describe('exitDuration', () => {
  it('is shorter the faster it was let go, down to a least', () => {
    expect(exitDuration(300, 700)).toBeGreaterThan(exitDuration(300, 3000));
    expect(exitDuration(300, 100000)).toBe(120);
  });

  it('is at most the longest, however slowly it was let go or far it has to go', () => {
    expect(exitDuration(3000, 0)).toBe(280);
  });

  it('is the same either way it goes', () => {
    expect(exitDuration(-300, -900)).toBe(exitDuration(300, 900));
  });
});

describe('moveVelocity', () => {
  it('is zero before any move', () => {
    expect(startVelocity(0, 1000).v).toBe(0);
  });

  it('is the speed of the first move', () => {
    // 20pt in 20ms
    expect(moveVelocity(startVelocity(0, 1000), 20, 1020).v).toBeCloseTo(1000);
  });

  it('follows the recent moves more than the old', () => {
    let v = startVelocity(0, 0);
    v = moveVelocity(v, 20, 20); // 1000 pt/s
    v = moveVelocity(v, 20, 40); // stopped
    expect(v.v).toBeCloseTo(400);
    v = moveVelocity(v, 20, 60);
    expect(v.v).toBeCloseTo(160);
  });

  it('ignores a move at the same time', () => {
    const v = moveVelocity(startVelocity(0, 100), 10, 100);
    expect(v.v).toBe(0);
    expect(v.pos).toBe(10);
  });
});
