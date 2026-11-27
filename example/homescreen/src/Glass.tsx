import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

const Liquid = Animated.createAnimatedComponent(GlassView);

/**
 * A pane of glass (iOS 26's liquid glass); where there is none, a pale translucent one.
 *
 * Liquid glass stops being drawn when it, or a view around it, is less than fully opaque, so nothing that holds one is faded:
 * things move and scale, and what should disappear is moved out of sight. Its style may be an animated one: its size and
 * corners are then drawn true at every step, which scaling it would not do.
 */
export function Glass({ style, children }: { style?: ComponentProps<typeof Animated.View>['style']; children?: ReactNode }) {
  if (!isLiquidGlassAvailable()) return <Animated.View style={[styles.pane, styles.frost, style]}>{children}</Animated.View>;
  return (
    <Liquid glassEffectStyle="clear" tintColor="rgba(255,255,255,0.12)" style={[styles.pane, style]}>
      {children}
    </Liquid>
  );
}

const styles = StyleSheet.create({
  pane: { borderCurve: 'continuous' },
  frost: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)' },
});
