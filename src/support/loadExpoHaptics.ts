import type { ExpoHapticsLike } from './haptics';

declare const require: (id: string) => unknown;

/**
 * `expo-haptics`, if the app has it. It's an optional peer dependency: the
 * `require` is in a `try`, which the bundler (Metro, with its optional
 * dependencies on, as Expo's and React Native's configs have it) allows to name a
 * package that isn't installed, so an app without it still bundles and this
 * returns `undefined`.
 */
export function loadExpoHaptics(): ExpoHapticsLike | undefined {
  try {
    return require('expo-haptics') as ExpoHapticsLike;
  } catch {
    return undefined;
  }
}
