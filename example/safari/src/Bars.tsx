import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { BAR_BOTTOM, BAR_H, BAR_SIDE, INK, INK_DIM, PILL_H, PILL_TOP, SW } from './metrics';
import { Book, Chevron, Magnifier, Plus, Share, Sheets } from './Icons';

/** A bar of glass (iOS 26's liquid glass); where there is none, a dark translucent one. */
export function GlassBar({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const glass = isLiquidGlassAvailable();
  return (
    // Clear glass, no tint: it turns light or dark with what's behind it, and what's drawn in it (`INK`) turns with it.
    <GlassView glassEffectStyle="regular" isInteractive style={[styles.bar, !glass && styles.fallback, style]}>
      {children}
    </GlassView>
  );
}

/** What the address pill collapses to: the padding either side of the domain, and this much of its full height, as Safari's does when a page scrolls. */
const PILL_PAD = 18;
const PILL_HEIGHT_END = 0.7;

/** A button in a bar: it dims and shrinks a little while it's held. Without an `onPress` it's only for show, as most of Safari's are here. */
function Btn({ onPress, children, dim }: { onPress?: () => void; children: ReactNode; dim?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.cell, { opacity: dim ? 0.35 : pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] }]}>
      {children}
    </Pressable>
  );
}

/** The bars over the tab overview: a pill to search the tabs, and a bar to add a tab, count them and finish. They fade as a tab opens. */
export function OverviewBars({ p, count, active, query, onQuery, onNew, onDone }: { p: SharedValue<number>; count: number; active: boolean; query: string; onQuery: (text: string) => void; onNew: () => void; onDone: () => void }) {
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0, 0.45], [1, 0], Extrapolation.CLAMP) }));
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, fade]}>
      <View style={[styles.pillHit, { top: PILL_TOP }]}>
        <GlassBar style={styles.pill}>
          <Magnifier />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Search Tabs"
            placeholderTextColor={INK_DIM}
            selectionColor={INK}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
        </GlassBar>
      </View>
      <GlassBar style={[styles.toolbar, { bottom: BAR_BOTTOM }]}>
        <Btn onPress={onNew}>
          <Plus />
        </Btn>
        <Text style={styles.count} pointerEvents="none">{count} {count === 1 ? 'Tab' : 'Tabs'}</Text>
        <Btn onPress={onDone}>
          <Text style={styles.done}>Done</Text>
        </Btn>
      </GlassBar>
    </Animated.View>
  );
}

/**
 * The bars over an open page: the address pill, and back, forward, share, bookmarks and tabs. They arrive as the page opens, and
 * follow the page's scroll: `hidden` goes to 1 as it scrolls down (the bar slides away, the pill shrinks) and back to 0 as it scrolls up.
 */
export function PageBars({ p, hidden, host, active, onTabs, onReload, onShare, onHost }: { p: SharedValue<number>; hidden: SharedValue<number>; host: string; active: boolean; onTabs: () => void; onReload: () => void; onShare: () => void; onHost: (host: string) => void }) {
  const arrive = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0.55, 1], [0, 1], Extrapolation.CLAMP) }));
  // The pill collapses about its middle, as Safari's does, to just the domain (its width, and the padding either side) and
  // PILL_HEIGHT_END of its height (measured from Safari's frames). It's the frame that shrinks, not a scale, so the text keeps its size.
  const hostWidth = useSharedValue(0);
  const pill = useAnimatedStyle(() => {
    const k = hidden.get();
    const full = SW - BAR_SIDE * 2;
    const end = Math.min(hostWidth.get() + PILL_PAD * 2, full);
    const inset = BAR_SIDE + k * ((full - end) / 2);
    const height = PILL_H * (1 - k * (1 - PILL_HEIGHT_END));
    return { left: inset, right: inset, height, top: PILL_TOP + (PILL_H - height) / 2 };
  });
  const toolbar = useAnimatedStyle(() => ({
    left: BAR_SIDE + hidden.get() * 14,
    right: BAR_SIDE + hidden.get() * 14,
    transform: [{ translateY: hidden.get() * (BAR_H + BAR_BOTTOM + 28) }],
  }));
  const edges = useAnimatedStyle(() => ({ opacity: 1 - hidden.get() }));
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, arrive]}>
      {/* The domain, measured at its own width where nobody sees it: what the pill shrinks to fit. */}
      <Text onLayout={(e) => hostWidth.set(e.nativeEvent.layout.width)} style={styles.measure}>{host}</Text>
      <Animated.View pointerEvents="box-none" style={[styles.wrap, pill]}>
        <GlassBar style={styles.pillFill}>
          <View style={styles.aaHit}><Animated.Text style={[styles.aa, edges]}>AA</Animated.Text></View>
          <View pointerEvents="box-none" style={styles.hostHit}>
            <TextInput
              key={host}
              defaultValue={host}
              onSubmitEditing={(e) => onHost(e.nativeEvent.text.trim() || host)}
              selectTextOnFocus
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="go"
              selectionColor={INK}
              style={styles.host}
            />
          </View>
          <Pressable onPress={onReload} hitSlop={8} style={styles.reloadHit}><Animated.Text style={[styles.reload, edges]}>↻</Animated.Text></Pressable>
        </GlassBar>
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom: BAR_BOTTOM }, toolbar]}>
        <GlassBar style={styles.toolbarFill}>
          <Btn><Chevron direction="left" /></Btn>
          <Btn dim><Chevron direction="right" dim /></Btn>
          <Btn onPress={onShare}><Share /></Btn>
          <Btn><Book /></Btn>
          <Btn onPress={onTabs}><Sheets /></Btn>
        </GlassBar>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Not clipped: the glass swells past its edge under a finger.
  bar: { borderRadius: 999, flexDirection: 'row', alignItems: 'center' },
  fallback: { backgroundColor: 'rgba(38,43,54,0.92)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  pillHit: { position: 'absolute', left: BAR_SIDE, right: BAR_SIDE, height: PILL_H },
  pill: { height: PILL_H, paddingHorizontal: 18, gap: 10, justifyContent: 'center' },
  toolbar: { position: 'absolute', left: BAR_SIDE, right: BAR_SIDE, height: BAR_H, paddingHorizontal: 10, justifyContent: 'space-between' },
  wrap: { position: 'absolute', left: BAR_SIDE, right: BAR_SIDE },
  pillFill: { flex: 1, paddingHorizontal: 18, justifyContent: 'center' },
  aaHit: { position: 'absolute', left: 18, top: 0, bottom: 0, justifyContent: 'center' },
  reloadHit: { position: 'absolute', right: 18, top: 0, bottom: 0, justifyContent: 'center' },
  // As wide as the pill, so as the pill narrows to fit the domain the domain always has the room it needs (and is never cut short).
  hostHit: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  toolbarFill: { height: BAR_H, paddingHorizontal: 10, justifyContent: 'space-between' },
  cell: { minWidth: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchInput: { minWidth: 120, color: INK, fontSize: 17, padding: 0, textAlign: 'center' },
  count: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: INK, fontSize: 16, fontWeight: '600' },
  done: { color: INK, fontSize: 17, fontWeight: '700' },
  aa: { color: INK, fontSize: 15, fontWeight: '600' },
  measure: { position: 'absolute', opacity: 0, fontSize: 16, fontWeight: '600', alignSelf: 'flex-start' },
  // No side padding: the collapsed pill is only as wide as the domain and its padding, and any more would cut the domain short.
  host: { alignSelf: 'stretch', color: INK, fontSize: 16, fontWeight: '600', textAlign: 'center', padding: 0 },
  reload: { color: INK, fontSize: 20 },
});
