import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePinchGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  scrollTo,
  useAnimatedProps,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { runOnJS, scheduleOnUI } from 'react-native-worklets';
import { CARD_RADIUS, useMetrics } from './metrics';
import { PageContent } from './PageContent';
import type { Tab } from './tabs';

/** Where a card is on the screen: what the page grows from, and shrinks back to. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far a scroll must go, one way, before the bars follow it. */
const SCROLL_STEP = 4;
/** The least a pinch shrinks the page to, as a fraction of the screen. */
const PINCH_MIN = 0.3;
/** Let go with the page pinched to less than this and it goes back into its card; more, and it springs back to the screen. */
const PINCH_CLOSE = 0.8;
const BACK = { duration: 220, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never };

/**
 * A page that grows out of its card to fill the screen, and back. `p` is how far it has grown, 0 (the card) to 1 (the screen), and
 * the frame (position, size, corner radius) is worked out from it on the UI thread. The page inside is laid out once, at a screen's
 * size, and only scaled, so its text doesn't reflow as it grows. Once it fills the screen it scrolls, and as it scrolls down `hidden`
 * goes to 1, which the bars take as their cue (and back to 0 as it scrolls up).
 *
 * Pinch it with two fingers and it shrinks under them, following them (the bars fade, `squeeze`): let go with it pinched in and it
 * carries on into its card (`onPinchClose`), or it springs back out to the screen. While it's open the card it came from is hidden (by
 * the app), so the page is the only one of them there is, and the swap, when it lands, can't be seen.
 */
export function PageOverlay({ tab, frame, p, hidden, scrollY, squeeze, initialY, expanded, reloads, onPinchClose }: { tab: Tab; frame: Frame; p: SharedValue<number>; hidden: SharedValue<number>; scrollY: SharedValue<number>; squeeze: SharedValue<number>; initialY: number; expanded: boolean; reloads: number; onPinchClose: () => void }) {
  const { width, height, screenRadius } = useMetrics();
  const scroll = useAnimatedRef<Animated.ScrollView>();

  // A pinch: how much it has taken the page from the screen (`pinched`, 0 to 1), and the rectangle the fingers have made of it.
  const pinched = useSharedValue(0);
  const rectX = useSharedValue(0);
  const rectY = useSharedValue(0);
  const rectW = useSharedValue(width);
  const rectH = useSharedValue(height);
  // Where the fingers began, and how far in they are (1 to PINCH_MIN), and whether a pinch is on.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scale = useSharedValue(1);
  const gripped = useSharedValue(false);

  /** Where the page is, from `p` (card to open) and the pinch (open to the fingers' rectangle). */
  const place = () => {
    'worklet';
    const k = p.get();
    const m = pinched.get();
    const x = rectX.get() * m;
    const y = rectY.get() * m;
    const w = width + (rectW.get() - width) * m;
    const h = height + (rectH.get() - height) * m;
    // The corners are the screen's when it's full, and a card's as it's pinched in.
    const roundness = Math.min(Math.max((w / width - PINCH_MIN) / (1 - PINCH_MIN), 0), 1);
    return {
      left: frame.x + (x - frame.x) * k,
      top: frame.y + (y - frame.y) * k,
      width: frame.w + (w - frame.w) * k,
      height: frame.h + (h - frame.h) * k,
      borderRadius: CARD_RADIUS + (screenRadius - CARD_RADIUS) * k * roundness,
    };
  };
  const clip = useAnimatedStyle(() => place());
  const page = useAnimatedStyle(() => ({ transform: [{ scale: place().width / width }] }));

  // The pinch runs on the UI thread, so the page keeps up with the fingers whatever the JS thread is doing.
  const pinch = usePinchGesture({
    enabled: expanded,
    onActivate: (e) => {
      'worklet';
      startX.set(e.focalX);
      startY.set(e.focalY);
      scale.set(1);
      gripped.set(true);
      pinched.set(1);
    },
    onUpdate: (e) => {
      'worklet';
      if (!gripped.get()) return;
      const s = Math.min(Math.max(e.scale, PINCH_MIN), 1);
      scale.set(s);
      // The point of the page the fingers began on stays under them as it shrinks.
      rectW.set(width * s);
      rectH.set(height * s);
      rectX.set(e.focalX - startX.get() * s);
      rectY.set(e.focalY - startY.get() * s);
      squeeze.set(Math.min(Math.max((s - 0.7) / 0.3, 0), 1));
    },
    onDeactivate: () => {
      'worklet';
      if (!gripped.get()) return;
      gripped.set(false);
      if (scale.get() < PINCH_CLOSE) {
        runOnJS(onPinchClose)();
      } else {
        pinched.set(withTiming(0, BACK));
        squeeze.set(withTiming(1, BACK));
      }
    },
  });
  // The page scrolls once it's open, and not while it's pinched.
  const live = useSharedValue(expanded);
  useEffect(() => {
    live.set(expanded);
  }, [expanded, live]);
  const scrolling = useAnimatedProps(() => ({ scrollEnabled: live.get() && !gripped.get() }));

  // Whether the bars are away (1) or here (0), and where the scroll was: a step down sends them away, a step up (or the top) brings them back.
  const goal = useSharedValue(0);
  const lastY = useSharedValue(initialY);
  const onScroll = useAnimatedScrollHandler((e) => {
    const y = e.contentOffset.y;
    const step = y - lastY.get();
    lastY.set(y);
    scrollY.set(y);
    let next = goal.get();
    if (y < 8) next = 0;
    else if (step > SCROLL_STEP) next = 1;
    else if (step < -SCROLL_STEP) next = 0;
    if (next !== goal.get()) {
      goal.set(next);
      hidden.set(withTiming(next, { duration: 220, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never }));
    }
  });

  // Reload: back to the top of the page.
  useEffect(() => {
    if (reloads === 0) return;
    scheduleOnUI(() => {
      'worklet';
      scrollTo(scroll, 0, 0, true);
    });
  }, [reloads, scroll]);

  return (
    <GestureDetector gesture={pinch}>
      <View pointerEvents={expanded ? 'box-none' : 'none'} style={StyleSheet.absoluteFill}>
        <Animated.View pointerEvents={expanded ? 'auto' : 'none'} style={[styles.clip, clip]}>
          <Animated.View style={[styles.page, { width, height }, page]}>
            <Animated.ScrollView
              ref={scroll}
              animatedProps={scrolling}
              contentOffset={{ x: 0, y: initialY }}
              // The address field's keyboard goes away as the page is dragged.
              keyboardDismissMode="on-drag"
              onScroll={onScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              contentInsetAdjustmentBehavior="never"
            >
              <PageContent tab={tab} />
            </Animated.ScrollView>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000' },
  // At a screen's size, scaled from its corner: the clip above shows as much of it as the frame is big.
  page: { transformOrigin: 'top left' },
});
