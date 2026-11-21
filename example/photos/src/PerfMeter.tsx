import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

/** Frames per second the JS thread and the UI thread are managing, and how many cells the grid has mounted. */
export function PerfMeter({ mounted }: { mounted: number }) {
  const [js, setJs] = useState(0);
  const [ui, setUi] = useState(0);

  // JS thread: how often it gets to run a frame.
  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames += 1;
      if (now - since >= 500) {
        setJs(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // UI thread: the same, counted there and handed over twice a second.
  const frames = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const fps = useSharedValue(0);
  useFrameCallback((info) => {
    frames.value += 1;
    elapsed.value += info.timeSincePreviousFrame ?? 0;
    if (elapsed.value >= 500) {
      fps.value = Math.round((frames.value * 1000) / elapsed.value);
      frames.value = 0;
      elapsed.value = 0;
    }
  });
  useAnimatedReaction(
    () => fps.value,
    (now, before) => {
      if (now !== before) runOnJS(setUi)(now);
    },
  );

  return (
    <View style={styles.row}>
      <Stat label="JS" value={js} low={js < 45} />
      <Stat label="UI" value={ui} low={ui < 45} />
      <Stat label="cells" value={mounted} />
    </View>
  );
}

function Stat({ label, value, low }: { label: string; value: number; low?: boolean }) {
  return (
    <Text style={styles.stat}>
      {label} <Text style={[styles.value, low && styles.low]}>{value}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  stat: { color: '#8b93a3', fontSize: 12, fontWeight: '600' },
  value: { color: '#3ccf8e', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  low: { color: '#e2475a' },
});
