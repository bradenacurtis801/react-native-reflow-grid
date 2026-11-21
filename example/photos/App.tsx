import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PerfMeter } from './src/PerfMeter';
import PhotosTab from './src/PhotosTab';
import VideosTab from './src/VideosTab';

// Timing logs from the grid (a slow drag frame, a change in mounted cells), in Metro's output.
(globalThis as { __REFLOW_PERF__?: boolean }).__REFLOW_PERF__ = true;

const TABS = [
  { key: 'photos', label: 'Photos', Tab: PhotosTab },
  { key: 'videos', label: 'Videos', Tab: VideosTab },
];

export default function App() {
  const [key, setKey] = useState('photos');
  const [mounted, setMounted] = useState(0);
  const { Tab } = TABS.find((t) => t.key === key)!;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Photos</Text>
          <PerfMeter mounted={mounted} />
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => {
                setMounted(0);
                setKey(t.key);
              }}
              style={[styles.tab, key === t.key && styles.tabOn]}
            >
              <Text style={styles.tabLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {/* Keyed, so each tab starts fresh: its own items, its own mounted cells. */}
      <View style={styles.body}>
        <Tab key={key} onMounted={setMounted} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: '#1d2129' },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: '#3a4150' },
  tabLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  body: { flex: 1 },
});
