/**
 * A moment the grid can give feedback for:
 *  - `lift`: an item is lifted to be dragged.
 *  - `move`: the dragged item has moved to another slot.
 *  - `join`: it has been held on an item it can join, and a drop would now.
 *  - `drop`: it was dropped, and the order changed or it joined an item.
 *  - `pageTurn`: a drag held at an edge has turned the page.
 *  - `scrub`: dragging along the page dots has reached another page.
 */
export type HapticEvent = 'lift' | 'move' | 'join' | 'drop' | 'pageTurn' | 'scrub';

/**
 * Feedback for the grid's moments. `true` (the default): `expo-haptics`, when the
 * app has it, and nothing otherwise (nor on web). `false`: none. A function:
 * yours, called with each moment, to use whatever you like.
 */
export type HapticsOption = boolean | ((event: HapticEvent) => void);

/** A moment that comes often (a fast drag crosses many slots) gives feedback at most this often (ms). The others always do. */
export const HAPTIC_GAPS: Partial<Record<HapticEvent, number>> = { move: 60, scrub: 50 };

/** The part of `expo-haptics` the grid uses. */
export interface ExpoHapticsLike {
  impactAsync(style: unknown): Promise<void>;
  selectionAsync(): Promise<void>;
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown };
}

/**
 * The grid's feedback through `expo-haptics`, or `undefined` when the app doesn't
 * have it. A medium tap for a lift, a light one for the item moving to another
 * slot and for a drop, and a selection tick (the lightest) for a page turning and
 * for scrubbing. Calls aren't waited for,
 * and one that fails is ignored: feedback must never get in a drag's way.
 */
export function expoHaptics(load: () => ExpoHapticsLike | undefined): ((event: HapticEvent) => void) | undefined {
  const haptics = load();
  if (!haptics) return undefined;
  const fire = (call: () => Promise<void>) => {
    try {
      Promise.resolve(call()).catch(() => {});
    } catch {
      // A module that is there but can't buzz (a simulator, say).
    }
  };
  return (event) => {
    if (event === 'lift') fire(() => haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium));
    else if (event === 'move' || event === 'join' || event === 'drop') fire(() => haptics.impactAsync(haptics.ImpactFeedbackStyle.Light));
    else fire(() => haptics.selectionAsync());
  };
}

/** What `haptics` says to do: nothing, the app's own function, or (the default) whatever `auto` finds. */
export function resolveHaptics(
  option: HapticsOption | undefined,
  auto: () => ((event: HapticEvent) => void) | undefined,
): ((event: HapticEvent) => void) | undefined {
  if (option === false) return undefined;
  if (typeof option === 'function') return option;
  return auto();
}
