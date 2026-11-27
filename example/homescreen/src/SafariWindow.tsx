import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Appearance, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
// The Safari example, as it is: its own app, run in a window here (see `metro.config.js`).
import Safari from '../../safari/App';
import type { AppItem } from './apps';
import type { Frame } from './FolderOverlay';
import { AppSquare } from './Icon';
import { useMetrics } from './metrics';

const LAUNCH = { duration: 380, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never };
/** The corner radius of a window that fills the screen, as the screen's own. */
const SCREEN_RADIUS = 55;

/**
 * An app opened from its icon: a window that grows from the icon to fill the screen, and shrinks back into it. The app stays
 * running once closed (out of sight), so it's as it was left when opened again.
 */
export function SafariWindow({ app, frame, closing, gone, onHome, onClosed }: { app: AppItem; frame: Frame; closing: boolean; gone: boolean; onHome: () => void; onClosed: () => void }) {
  const { width, height, icon } = useMetrics();

  // Safari is drawn for dark; the home screen for light.
  useEffect(() => {
    Appearance.setColorScheme(closing ? 'light' : 'dark');
  }, [closing]);

  // 0: the icon. 1: the screen.
  const p = useSharedValue(0);
  useEffect(() => {
    const go = () =>
      p.set(
        withTiming(closing ? 0 : 1, LAUNCH, (finished) => {
          if (finished && closing) runOnJS(onClosed)();
        }),
      );
    if (closing) {
      go();
      return;
    }
    // Two frames for the app's views to be made, as for a folder.
    let next = requestAnimationFrame(() => (next = requestAnimationFrame(go)));
    return () => cancelAnimationFrame(next);
  }, [closing, p, onClosed]);

  const window = useAnimatedStyle(() => {
    const k = p.get();
    return {
      left: frame.x * (1 - k),
      top: frame.y * (1 - k),
      width: frame.w + (width - frame.w) * k,
      height: frame.h + (height - frame.h) * k,
      borderRadius: frame.w * 0.235 + (SCREEN_RADIUS - frame.w * 0.235) * k,
    };
  });
  // The app is laid out at the screen's size, and scaled to the window's width, its middle in the window's middle.
  const content = useAnimatedStyle(() => {
    const k = p.get();
    const w = frame.w + (width - frame.w) * k;
    const h = frame.h + (height - frame.h) * k;
    const scale = w / width;
    return { transform: [{ translateY: (h - height * scale) / 2 }, { scale }] };
  });
  // The icon's face, over the app as the window leaves it and returns to it.
  const face = useAnimatedStyle(() => {
    const k = p.get();
    return {
      opacity: interpolate(k, [0, 0.35], [1, 0], Extrapolation.CLAMP),
      transform: [{ scaleX: (frame.w + (width - frame.w) * k) / icon }, { scaleY: (frame.h + (height - frame.h) * k) / icon }],
    };
  });
  const home = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0.8, 1], [0, 1], Extrapolation.CLAMP) }));

  return (
    <View style={[StyleSheet.absoluteFill, gone && styles.gone]} pointerEvents={closing ? 'none' : 'auto'}>
      <Animated.View style={[styles.window, window]}>
        <Animated.View style={[styles.content, { width, height }, content]}>
          <Safari />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.face, { width: icon, height: icon }, face]}>
          <AppSquare app={app} size={icon} />
        </Animated.View>
      </Animated.View>
      {/* Above Safari's toolbar. Not at the bottom edge, whose swipe is the system's, nor in the status bar, whose taps are. */}
      <Animated.View style={[styles.home, home]}>
        <Pressable onPress={onHome} hitSlop={8} style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Back to the home screen">
          <SymbolView name={{ ios: 'house.fill', android: 'home', web: 'home' }} size={20} tintColor="#fff" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  gone: { transform: [{ translateX: -10000 }] },
  window: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', backgroundColor: '#1b1e26' },
  content: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  face: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  home: { position: 'absolute', right: 16, bottom: 100 },
  homeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(24,26,34,0.82)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  pressed: { opacity: 0.6 },
});
