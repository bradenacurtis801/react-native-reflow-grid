import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { useMetrics } from './metrics';

/** The hues of a wash: its first pool's, and its second's. */
export type Hues = readonly [number, number];
/** The hues the backdrop rests on, until some tabs' take over: magenta and teal. */
const DEFAULT_HUES: Hues = [320, 180];
const same = (a: Hues, b: Hues) => a[0] === b[0] && a[1] === b[1];

/** How long the colour takes to give way to the next. */
const FADE = { duration: 800, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.Never };
/** How solid a pool is at its middle. */
const ALPHA = 0.85;

/** A soft pool of colour: a radial gradient that has faded out by the edge of its square, so no edge shows. */
const pool = (hue: number, saturation = 85, lightness = 58) =>
  `radial-gradient(circle at center, hsla(${hue}, ${saturation}%, ${lightness}%, ${ALPHA}) 0%, hsla(${hue}, ${saturation}%, ${lightness}%, 0) 70%)`;

/** The pools drift across the screen, slowly and in opposite ways, to and fro: how big they are, and where each is. */
function useDrift() {
  const { width, height } = useMetrics();
  // 0 to 1 and back, forever.
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 16000, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.Never }), -1, true));
  }, [t]);
  const first = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.1 + t.get() * width * 0.5 }, { translateY: height * 0.05 + t.get() * height * 0.25 }] }));
  const second = useAnimatedStyle(() => ({ transform: [{ translateX: width * 0.5 - t.get() * width * 0.5 }, { translateY: height * 0.6 - t.get() * height * 0.25 }] }));
  return { size: Math.max(width, height) * 1.1, first, second };
}
type Drift = ReturnType<typeof useDrift>;

/**
 * Hues that fade in over the ones before. `base` is the wash beneath, always shown; `top` fades in over it (`mix`, 0 to 1) and, once all
 * the way in, becomes the base. Hues that arrive mid-fade wait for it to end. Nothing is mounted or dropped, and the swap can't be seen:
 * it happens when the two are the same.
 */
function useCrossfade(goal: Hues) {
  const [base, setBase] = useState(goal);
  const [top, setTop] = useState(goal);
  const mix = useSharedValue(0);
  const fading = useRef(false);
  const waiting = useRef<Hues | null>(null);
  const latest = useRef(goal);

  const arrived = useCallback((to: Hues) => setBase(to), []);
  const fadeTo = useCallback(
    (to: Hues) => {
      fading.current = true;
      setTop(to);
      mix.set(withTiming(1, FADE, (done) => done && runOnJS(arrived)(to)));
    },
    [mix, arrived],
  );
  useEffect(() => {
    if (same(goal, latest.current)) return;
    latest.current = goal;
    if (fading.current) waiting.current = goal;
    else fadeTo(goal);
  }, [goal, fadeTo]);
  // Once the wash beneath is the new one (the render is in), the one over it can go, and the next hues, if any came meanwhile, begin.
  useEffect(() => {
    mix.set(0);
    fading.current = false;
    const next = waiting.current;
    waiting.current = null;
    if (next !== null && !same(next, base)) fadeTo(next);
  }, [base, mix, fadeTo]);

  return { base, top, mix };
}

/**
 * Two pools, one in each of `hues`. In a fade (`mix`, 0 to 1) the wash beneath goes out in step with `mix`, and the one over it comes in
 * as fast as keeps the two together as solid as one: two pools of 0.85 laid one over the other are denser than either, and that density
 * going when the fade ends would be a step in the colour.
 */
function Wash({ hues, drift, mix, over }: { hues: Hues; drift: Drift; mix: SharedValue<number>; over?: boolean }) {
  const fade = useAnimatedStyle(() => {
    const m = mix.get();
    return { opacity: over ? (1 - (1 - ALPHA) / (1 - ALPHA * (1 - m))) / ALPHA : 1 - m };
  });
  const { size } = drift;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]}>
      <Animated.View style={[styles.pool, { width: size, height: size, backgroundImage: pool(hues[0]) }, drift.first]} />
      <Animated.View style={[styles.pool, { width: size, height: size, backgroundImage: pool(hues[1]) }, drift.second]} />
    </Animated.View>
  );
}

/**
 * What the tab overview sits on: indigo to near-black, with two pools of colour drifting slowly across it, in `hues` (those of the cards
 * at the two sides of the middle of the screen). The glass bars show what's behind them, so this is where their colour comes from (the
 * glass itself stays untinted). Private Browsing fades to a darker backdrop.
 */
export function Backdrop({ isPrivate, hues }: { isPrivate: boolean; hues: Hues | null }) {
  const drift = useDrift();
  const { base, top, mix } = useCrossfade(hues ?? DEFAULT_HUES);

  // 0 for the ordinary tabs, 1 for the private ones.
  const dark = useSharedValue(0);
  useEffect(() => {
    dark.set(withTiming(isPrivate ? 1 : 0, { duration: 450, reduceMotion: ReduceMotion.Never }));
  }, [dark, isPrivate]);
  const fade = useAnimatedStyle(() => ({ opacity: dark.get() }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Wash hues={base} drift={drift} mix={mix} />
      <Wash hues={top} drift={drift} mix={mix} over />
      <Animated.View style={[StyleSheet.absoluteFill, styles.private, fade]}>
        <Animated.View style={[styles.pool, { width: drift.size, height: drift.size, backgroundImage: pool(252, 28, 47) }, drift.second]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden', backgroundImage: 'linear-gradient(160deg, #2a2470 0%, #15122e 55%, #0d0b1c 100%)' },
  pool: { position: 'absolute', left: 0, top: 0 },
  private: { overflow: 'hidden', backgroundImage: 'linear-gradient(160deg, #202024 0%, #0e0e12 55%, #050507 100%)' },
});
