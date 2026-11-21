import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { CARD_RADIUS, SCREEN_RADIUS, SH, SW } from './metrics';
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

/**
 * A page that grows out of its card to fill the screen, and back. `p` is how far it has grown, 0 (the card) to 1 (the screen), and
 * it's all that moves: the frame (position, size, corner radius) is worked out from it on the UI thread. The page inside is laid out
 * once, at a screen's size, and only scaled, so its text doesn't reflow as it grows. Once it fills the screen it scrolls, and as it
 * scrolls down `hidden` goes to 1, which the bars take as their cue (and back to 0 as it scrolls up).
 */
export function PageOverlay({ tab, frame, p, hidden, scrollY, initialY, expanded, reloads }: { tab: Tab; frame: Frame; p: SharedValue<number>; hidden: SharedValue<number>; scrollY: SharedValue<number>; initialY: number; expanded: boolean; reloads: number }) {
  const scale0 = frame.w / SW;
  const scroll = useAnimatedRef<Animated.ScrollView>();

  const clip = useAnimatedStyle(() => {
    const k = p.get();
    return {
      left: frame.x * (1 - k),
      top: frame.y * (1 - k),
      width: frame.w + (SW - frame.w) * k,
      height: frame.h + (SH - frame.h) * k,
      borderRadius: CARD_RADIUS + (SCREEN_RADIUS - CARD_RADIUS) * k,
    };
  });
  const page = useAnimatedStyle(() => ({ transform: [{ scale: scale0 + (1 - scale0) * p.get() }] }));

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
    <Animated.View pointerEvents={expanded ? 'auto' : 'none'} style={[styles.clip, clip]}>
      <Animated.View style={[styles.page, page]}>
        <Animated.ScrollView
          ref={scroll}
          scrollEnabled={expanded}
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
  );
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000' },
  // At a screen's size, scaled from its corner: the clip above shows as much of it as the frame is big.
  page: { width: SW, height: SH, transformOrigin: 'top left' },
});
