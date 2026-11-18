import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { gridLayout, ReflowGrid, type ReflowLayout, type Size } from 'react-native-reflow-grid';

type Arrangement = 'auto' | 'grid' | 'list' | 'row' | 'rows' | 'fixed';

const ARRANGEMENTS: { label: string; value: Arrangement }[] = [
  { label: 'Auto', value: 'auto' },
  { label: '3 cols', value: 'grid' },
  { label: '1 col', value: 'list' },
  { label: '1 row', value: 'row' },
  { label: '2 rows', value: 'rows' },
  { label: 'Fixed', value: 'fixed' },
];

const GAP = 12;
const COUNT = 24;
const HUES = ['#e2475a', '#f0874a', '#e8b93c', '#3ccf8e', '#37b6c9', '#5a8cf0', '#b04ad8'];
/** The ✕'s press area, in the tile's corner: a bit larger than the ✕ drawn there. */
const REMOVE_HIT = 40;
/** Room for the controls pinned over the grid. */
const TOP = 150;
const BOTTOM = 96;
/** Card width ÷ height. */
const ASPECT = 0.75;

/**
 * Every card on screen at once: the column count whose cards come out biggest
 * while all the rows still fit the room (less what's pinned over it), centered.
 */
const fitLayout: ReflowLayout = (count, room: Size) => {
  // A margin each side, so a scrollbar's width can't push the content wider than what's shown.
  const width = Math.max(room.width - 2 * GAP, 0);
  const height = Math.max(room.height - TOP - BOTTOM, 0);
  let best = { columns: 1, width: 0, height: 0 };
  for (let columns = 1; columns <= Math.max(count, 1); columns++) {
    const rows = Math.ceil(count / columns);
    const byWidth = (width - (columns - 1) * GAP) / columns;
    const byHeight = ((height - (rows - 1) * GAP) / rows) * ASPECT;
    const card = Math.max(Math.min(byWidth, byHeight), 0);
    if (card > best.width) best = { columns, width: card, height: card / ASPECT };
  }
  const { columns, width: cardWidth, height: cardHeight } = best;
  const used = Math.min(count, columns) * cardWidth + (Math.min(count, columns) - 1) * GAP;
  const left = Math.max((room.width - 2 * GAP - used) / 2, 0) + GAP;
  const rects = Array.from({ length: count }, (_, i) => ({
    x: left + (i % columns) * (cardWidth + GAP),
    y: Math.floor(i / columns) * (cardHeight + GAP),
    width: cardWidth,
    height: cardHeight,
  }));
  const rows = Math.ceil(count / columns);
  return { rects, size: { width, height: count === 0 ? 0 : rows * cardHeight + (rows - 1) * GAP } };
};

interface Tile {
  id: number;
}

const tiles = (from: number, count: number): Tile[] => Array.from({ length: count }, (_, i) => ({ id: from + i }));

export default function App() {
  const [arrangement, setArrangement] = useState<Arrangement>('auto');
  const [items, setItems] = useState(() => tiles(1, COUNT));
  const [mounted, setMounted] = useState(0);
  const next = useRef(COUNT + 1);

  const remove = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const add = (count: number) => {
    setItems((all) => [...all, ...tiles(next.current, count)]);
    next.current += count;
  };
  const reset = () => {
    setItems(tiles(1, COUNT));
    next.current = COUNT + 1;
  };

  // Memoized: a new layout function lays everything out again.
  const layout = useMemo<ReflowLayout>(() => {
    switch (arrangement) {
      case 'auto':
        return fitLayout;
      case 'grid':
        return gridLayout({ flow: 'vertical', lines: 3, gap: GAP, card: { aspect: 0.75 } });
      case 'list':
        return gridLayout({ flow: 'vertical', lines: 1, gap: 8, card: { length: 56 } });
      case 'row':
        return gridLayout({ flow: 'horizontal', lines: 1, gap: GAP, card: { aspect: 0.75 } });
      case 'rows':
        // Two rows, and two cards across the screen: each card's width is half the room's, so its aspect follows from the room.
        return (count, room) => {
          const width = (room.width - GAP) / 2;
          const height = (room.height - GAP) / 2;
          return gridLayout({ flow: 'horizontal', lines: 2, gap: GAP, card: { aspect: width / height } })(count, room);
        };
      // Fixed on both axes: five 300 × 240 columns are wider than the screen, so the grid scrolls both ways.
      case 'fixed':
        return gridLayout({ flow: 'vertical', lines: 5, gap: GAP, card: { width: 300, height: 240 } });
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

  const horizontal = arrangement === 'row' || arrangement === 'rows';

  return (
    <View style={styles.root}>
      <ReflowGrid
        style={styles.grid}
        axis={horizontal ? 'horizontal' : arrangement === 'fixed' ? 'both' : 'vertical'}
        // The grid is full-bleed: it scrolls under the pinned controls and rests clear of them.
        startInset={TOP}
        endInset={BOTTOM}
        crossStartInset={TOP}
        crossEndInset={BOTTOM}
        data={items}
        keyExtractor={(t) => String(t.id)}
        layout={layout}
        onMounted={setMounted}
        reduceMotion={ReduceMotion.Never}
        renderItem={(t) => <TileView tile={t} />}
        touchRegions={touchRegions}
      />

      <View style={styles.top} pointerEvents="box-none">
        <Text style={styles.title}>Reflow Grid</Text>
        <View style={styles.segmented}>
          {ARRANGEMENTS.map((a) => (
            <Pressable
              key={a.value}
              onPress={() => setArrangement(a.value)}
              style={[styles.segment, arrangement === a.value && styles.segmentOn]}
            >
              <Text style={styles.segmentLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
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
  segmented: { flexDirection: 'row', backgroundColor: '#1d2129', borderRadius: 12, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
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
