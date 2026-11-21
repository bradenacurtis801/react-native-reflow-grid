import { expoHaptics, HAPTIC_GAPS, resolveHaptics, type ExpoHapticsLike, type HapticEvent } from '../haptics';
import { loadExpoHaptics } from '../loadExpoHaptics';

const MEDIUM = { style: 'medium' };
const LIGHT = { style: 'light' };

/** An `expo-haptics` that records what it was asked for. */
function fakeModule() {
  const calls: string[] = [];
  const module: ExpoHapticsLike = {
    impactAsync: (style) => (calls.push(style === MEDIUM ? 'impact:medium' : style === LIGHT ? 'impact:light' : 'impact:?'), Promise.resolve()),
    selectionAsync: () => (calls.push('selection'), Promise.resolve()),
    ImpactFeedbackStyle: { Light: LIGHT, Medium: MEDIUM },
  };
  return { module, calls };
}

describe('expoHaptics', () => {
  it('has nothing to give when the app does not have expo-haptics', () => {
    expect(expoHaptics(() => undefined)).toBeUndefined();
  });

  it('gives a medium tap for a lift, a light one for a move and a drop, and a tick for the rest', () => {
    const { module, calls } = fakeModule();
    const give = expoHaptics(() => module)!;
    for (const event of ['lift', 'move', 'drop', 'pageTurn', 'scrub'] as HapticEvent[]) give(event);
    expect(calls).toEqual(['impact:medium', 'impact:light', 'impact:light', 'selection', 'selection']);
  });

  it('ignores a call that fails, however it fails, so a drag is never got in the way of', async () => {
    const rejecting: ExpoHapticsLike = {
      impactAsync: () => Promise.reject(new Error('no taptic engine')),
      selectionAsync: () => {
        throw new Error('not a promise');
      },
      ImpactFeedbackStyle: { Light: 1, Medium: 2 },
    };
    const give = expoHaptics(() => rejecting)!;
    expect(() => give('lift')).not.toThrow();
    expect(() => give('move')).not.toThrow();
    // A rejection that nobody awaits mustn't surface as an unhandled one.
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('resolveHaptics', () => {
  const auto = jest.fn(() => (() => {}) as (event: HapticEvent) => void);
  beforeEach(() => auto.mockClear());

  it('is the app function when it gives one', () => {
    const mine = jest.fn();
    expect(resolveHaptics(mine, auto)).toBe(mine);
    expect(auto).not.toHaveBeenCalled();
  });

  it('is nothing when switched off', () => {
    expect(resolveHaptics(false, auto)).toBeUndefined();
    expect(auto).not.toHaveBeenCalled();
  });

  it('looks for expo-haptics by default, whether `true` or not said at all', () => {
    expect(resolveHaptics(true, auto)).toBeDefined();
    expect(resolveHaptics(undefined, auto)).toBeDefined();
    expect(auto).toHaveBeenCalledTimes(2);
  });

  it('is nothing by default when there is nothing to find', () => {
    expect(resolveHaptics(undefined, () => undefined)).toBeUndefined();
  });
});

describe('loadExpoHaptics', () => {
  it('says there is none, rather than throwing, when the package is not installed', () => {
    expect(() => loadExpoHaptics()).not.toThrow();
    expect(loadExpoHaptics()).toBeUndefined();
  });
});

describe('HAPTIC_GAPS', () => {
  it('limits only the moments that come often', () => {
    expect(HAPTIC_GAPS.move).toBeGreaterThan(0);
    expect(HAPTIC_GAPS.scrub).toBeGreaterThan(0);
    expect(HAPTIC_GAPS.lift).toBeUndefined();
    expect(HAPTIC_GAPS.drop).toBeUndefined();
    expect(HAPTIC_GAPS.pageTurn).toBeUndefined();
  });
});
