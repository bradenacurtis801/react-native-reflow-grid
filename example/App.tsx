import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { gridLayout, masonryLayout, pagedLayout, ReflowGrid, type ReflowLayout } from 'react-native-reflow-grid';

type Arrangement = 'grid' | 'list' | 'masonry' | 'row' | 'rows' | 'fixed' | 'hpages' | 'vpages';

const ARRANGEMENTS: { label: string; value: Arrangement }[] = [
  { label: '3 cols', value: 'grid' },
  { label: '1 col', value: 'list' },
  { label: 'Masonry', value: 'masonry' },
  { label: '1 row', value: 'row' },
  { label: '2 rows', value: 'rows' },
  { label: 'Fixed', value: 'fixed' },
  { label: 'H pages', value: 'hpages' },
  { label: 'V pages', value: 'vpages' },
];

const GAP = 12;
const COUNT = 24;
const HUES = ['#e2475a', '#f0874a', '#e8b93c', '#3ccf8e', '#37b6c9', '#5a8cf0', '#b04ad8'];
/** The ✕'s press area, in the tile's corner: a bit larger than the ✕ drawn there. */
const REMOVE_HIT = 40;
/** Room for the controls pinned over the grid. */
const TOP = 150;
const BOTTOM = 96;

/** Height ÷ width of a masonry tile, by its number: a spread that repeats, so the columns come out uneven. */
const MASONRY_RATIOS = [1.3, 0.8, 1, 1.55, 0.9, 1.2, 1.7, 0.7];

interface Tile {
  id: number;
}

const tiles = (from: number, count: number): Tile[] => Array.from({ length: count }, (_, i) => ({ id: from + i }));

export default function App() {
  const [arrangement, setArrangement] = useState<Arrangement>('grid');
  const [items, setItems] = useState(() => tiles(1, COUNT));
  const [mounted, setMounted] = useState(0);
  const next = useRef(COUNT + 1);

  const remove = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  // The grid reports the new order of the keys; the tiles follow it.
  const reorder = useCallback(({ keys }: { keys: readonly string[] }) => {
    setItems((all) => {
      const byId = new Map(all.map((t) => [String(t.id), t]));
      return keys.flatMap((k) => byId.get(k) ?? []);
    });
  }, []);
  const add = (count: number) => {
    setItems((all) => [...all, ...tiles(next.current, count)]);
    next.current += count;
  };
  const reset = () => {
    setItems(tiles(1, COUNT));
    next.current = COUNT + 1;
  };

  // Memoized: a new layout function lays everything out again.
  const layout = useMemo<ReflowLayout<Tile>>(() => {
    switch (arrangement) {
      case 'grid':
        return gridLayout({ flow: 'vertical', lines: 3, gap: GAP, card: { aspect: 0.75 } });
      case 'list':
        return gridLayout({ flow: 'vertical', lines: 1, gap: 8, card: { length: 56 } });
      // Two columns of tiles of different heights, each under the shortest column so far.
      case 'masonry':
        return masonryLayout<Tile>({ columns: 2, gap: GAP, heightOf: (t, width) => width * MASONRY_RATIOS[t.id % MASONRY_RATIOS.length]! });
      case 'row':
        return gridLayout({ flow: 'horizontal', lines: 1, gap: GAP, card: { aspect: 0.75 } });
      case 'rows':
        // Two rows, and two cards across the screen: each card's width is half the room's, so its aspect follows from the room.
        return (data, room) => {
          const width = (room.width - GAP) / 2;
          const height = (room.height - GAP) / 2;
          return gridLayout({ flow: 'horizontal', lines: 2, gap: GAP, card: { aspect: width / height } })(data, room);
        };
      // Fixed on both axes: five 300 × 240 columns are wider than the screen, so the grid scrolls both ways.
      case 'fixed':
        return gridLayout({ flow: 'vertical', lines: 5, gap: GAP, card: { width: 300, height: 240 } });
      // Pages of 3 × 4, one room each: the grid snaps to them, and a drag held at an edge turns the page.
      case 'hpages':
        return pagedLayout({ direction: 'horizontal', columns: 3, rows: 4, gap: GAP });
      case 'vpages':
        return pagedLayout({ direction: 'vertical', columns: 3, rows: 4, gap: GAP });
    }
  }, [arrangement]);

  // Presses are the grid's, not each tile's: two thumbs can remove two tiles at once.
  const touchRegions = useCallback(
    (t: Tile, { size }: { size: { width: number } }) => [
      {
        key: 'remove',
        rect: { x: size.width - REMOVE_HIT, y: 0, width: REMOVE_HIT, height: REMOVE_HIT },
        onPress: () => remove(t.id),
      },
    ],
    [remove],
  );

  const horizontal = arrangement === 'row' || arrangement === 'rows' || arrangement === 'hpages';
  // A page is the whole room: no inset, so the grid sits between the controls by margin instead.
  const paged = arrangement === 'hpages' || arrangement === 'vpages';

  return (
    <View style={styles.root}>
      <ReflowGrid
        style={[styles.grid, paged && { marginTop: TOP, marginBottom: BOTTOM }]}
        axis={horizontal ? 'horizontal' : arrangement === 'fixed' ? 'both' : 'vertical'}
        // The grid is full-bleed: it scrolls under the pinned controls and rests clear of them.
        startInset={paged ? 0 : TOP}
        endInset={paged ? 0 : BOTTOM}
        crossStartInset={paged ? 0 : TOP}
        crossEndInset={paged ? 0 : BOTTOM}
        data={items}
        keyExtractor={(t) => String(t.id)}
        layout={layout}
        onMounted={setMounted}
        onReorder={reorder}
        pageIndicator={{ color: 'rgba(255,255,255,0.3)', activeColor: '#fff' }}
        reduceMotion={ReduceMotion.Never}
        renderItem={(t) => <TileView tile={t} />}
        touchRegions={touchRegions}
      />

      <View style={styles.top} pointerEvents="box-none">
        <Text style={styles.title}>Reflow Grid</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmented} contentContainerStyle={styles.segmentedContent}>
          {ARRANGEMENTS.map((a) => (
            <Pressable
              key={a.value}
              onPress={() => setArrangement(a.value)}
              style={[styles.segment, arrangement === a.value && styles.segmentOn]}
            >
              <Text style={styles.segmentLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        <Text style={styles.count}>
          {items.length} tiles · {mounted} mounted
        </Text>
        <Button label="Add 3" onPress={() => add(3)} />
        <Button label="Add 300" onPress={() => add(300)} />
        <Button label="Reset" onPress={reset} />
      </View>
    </View>
  );
}

/** A tile and its ✕ as drawn. The press is the grid's (`touchRegions`), not the ✕'s. */
function TileView({ tile }: { tile: Tile }) {
  return (
    <View style={[styles.tile, { backgroundColor: HUES[tile.id % HUES.length] }]}>
      <Text style={styles.tileNumber}>{tile.id}</Text>
      <View style={styles.remove}>
        <Text style={styles.removeMark}>✕</Text>
      </View>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.button}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  grid: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 64, paddingHorizontal: 16, gap: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  segmented: { flexGrow: 0, backgroundColor: '#1d2129', borderRadius: 12 },
  segmentedContent: { padding: 3 },
  segment: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentOn: { backgroundColor: '#3a4150' },
  segmentLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
    backgroundColor: '#0f1115ee',
  },
  count: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  button: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#2a2f3a' },
  buttonLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  tile: { flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileNumber: { fontSize: 22, fontWeight: '700', color: '#fff' },
  // The same corner in every tile, so the next one's ✕ arrives where this one was.
  remove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  removeMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
