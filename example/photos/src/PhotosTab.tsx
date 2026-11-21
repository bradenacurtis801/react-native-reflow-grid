import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { masonryLayout, ReflowGrid, type ReflowLayout } from 'react-native-reflow-grid';
import { rand } from './data';
import { Photo } from './Photo';
import type { TabProps } from './types';
import { Button, CONTROLS_BOTTOM, controls } from './ui';

const GAP = 8;
const HEART_HIT = 48;

interface Photo {
  id: number;
  /** Height ÷ width. */
  ratio: number;
  liked: boolean;
}

const photos = (from: number, count: number): Photo[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, ratio: 0.7 + rand(from + i) * 0.9, liked: false }));

/** Remote images of different shapes in two columns: each cell's height follows from its photo. */
export default function PhotosTab({ onMounted }: TabProps) {
  const [items, setItems] = useState(() => photos(1, 60));
  const next = useRef(61);

  const layout = useMemo<ReflowLayout<Photo>>(() => masonryLayout({ columns: 2, gap: GAP, heightOf: (p, width) => width * p.ratio }), []);
  const like = useCallback((id: number) => setItems((all) => all.map((p) => (p.id === id ? { ...p, liked: !p.liked } : p))), []);
  const remove = useCallback((id: number) => setItems((all) => all.filter((p) => p.id !== id)), []);
  const reorder = useCallback(({ keys }: { keys: readonly string[] }) => {
    setItems((all) => {
      const byId = new Map(all.map((p) => [String(p.id), p]));
      return keys.flatMap((k) => byId.get(k) ?? []);
    });
  }, []);
  const touchRegions = useCallback(
    (p: Photo, { size }: { size: { width: number } }) => [
      { key: 'like', rect: { x: size.width - HEART_HIT, y: 0, width: HEART_HIT, height: HEART_HIT }, onPress: () => like(p.id) },
      { key: 'remove', rect: { x: 0, y: 0, width: HEART_HIT, height: HEART_HIT }, onPress: () => remove(p.id) },
    ],
    [like, remove],
  );
  const add = (count: number) => {
    setItems((all) => [...all, ...photos(next.current, count)]);
    next.current += count;
  };

  return (
    <View style={styles.root}>
      <ReflowGrid
        style={styles.grid}
        data={items}
        keyExtractor={(p) => String(p.id)}
        layout={layout}
        startInset={8}
        endInset={CONTROLS_BOTTOM}
        crossStartInset={GAP}
        crossEndInset={GAP}
        onMounted={onMounted}
        onReorder={reorder}
        onSwipe={(p) => remove(p.id)}
        touchRegions={touchRegions}
        renderItem={(p, { size }) => (
          <View style={styles.card}>
            <Photo seed={p.id} width={size.width * 2} height={size.height * 2} style={StyleSheet.absoluteFill} />
            <View style={styles.caption}>
              <Text style={styles.captionText}>Photo {p.id}</Text>
            </View>
            <View style={[styles.badge, styles.left]}>
              <Text style={styles.mark}>✕</Text>
            </View>
            <View style={[styles.badge, styles.right]}>
              <Text style={[styles.mark, p.liked && styles.liked]}>{p.liked ? '♥' : '♡'}</Text>
            </View>
          </View>
        )}
      />
      <View style={controls.bottom} pointerEvents="box-none">
        <Text style={controls.count}>{items.length} photos</Text>
        <Button label="Add 20" onPress={() => add(20)} />
        <Button label="Add 200" onPress={() => add(200)} />
        <Button label="Reset" onPress={() => setItems(photos(1, 60))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grid: { flex: 1 },
  card: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1d2129' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, backgroundColor: 'rgba(0,0,0,0.4)' },
  captionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  badge: { position: 'absolute', top: 6, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  left: { left: 6 },
  right: { right: 6 },
  mark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  liked: { color: '#e2475a' },
});
