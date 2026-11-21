import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { gridLayout, ReflowGrid } from 'react-native-reflow-grid';
import { VIDEOS } from './data';
import type { TabProps } from './types';
import { setPlayback, togglePlayback, VideoCell } from './VideoCell';
import { Button, CONTROLS_BOTTOM, controls } from './ui';

const GAP = 8;
const REMOVE_HIT = 44;

interface Clip {
  id: number;
}

const clips = (from: number, count: number): Clip[] => Array.from({ length: count }, (_, i) => ({ id: from + i }));

/**
 * A grid of playing videos. Every mounted cell holds a player, so the meter's
 * cell count is the number of live players: scroll and watch players come and
 * go with the cells. A tap pauses or plays one.
 */
function VideosTab({ onMounted }: TabProps) {
  const [items, setItems] = useState(() => clips(1, 24));
  const [columns, setColumns] = useState(2);
  const [autoplay, setAutoplay] = useState(true);
  const next = useRef(25);

  const layout = useMemo(() => gridLayout({ flow: 'vertical', lines: columns, gap: GAP, card: { aspect: 1 } }), [columns]);
  const remove = useCallback((id: number) => setItems((all) => all.filter((c) => c.id !== id)), []);
  const reorder = useCallback(({ keys }: { keys: readonly string[] }) => {
    setItems((all) => {
      const byId = new Map(all.map((c) => [String(c.id), c]));
      return keys.flatMap((k) => byId.get(k) ?? []);
    });
  }, []);
  const touchRegions = useCallback(
    (c: Clip, { size }: { size: { width: number; height: number } }) => [
      { key: 'remove', rect: { x: size.width - REMOVE_HIT, y: 0, width: REMOVE_HIT, height: REMOVE_HIT }, onPress: () => remove(c.id) },
      { key: 'play', rect: { x: 0, y: 0, width: size.width - REMOVE_HIT, height: size.height }, onPress: () => togglePlayback(`videos:${c.id}`) },
    ],
    [remove],
  );
  const add = (count: number) => {
    setItems((all) => [...all, ...clips(next.current, count)]);
    next.current += count;
  };
  const toggleAutoplay = () => {
    setPlayback('videos:', !autoplay);
    setAutoplay(!autoplay);
  };
  // Stable, so a card is drawn again only when its own clip or place changes, not whenever the tab renders.
  const renderItem = useCallback(
    (c: Clip) => (
      <View style={styles.card}>
        <VideoCell id={`videos:${c.id}`} source={VIDEOS[c.id % VIDEOS.length]!} autoplay={autoplay} />
        <View style={styles.label}>
          <Text style={styles.labelText}>Clip {c.id}</Text>
        </View>
        <View style={styles.remove}>
          <Text style={styles.removeMark}>✕</Text>
        </View>
      </View>
    ),
    [autoplay],
  );

  return (
    <View style={styles.root}>
      <ReflowGrid
        style={styles.grid}
        data={items}
        keyExtractor={(c) => String(c.id)}
        layout={layout}
        startInset={CONTROLS_TOP_ROOM}
        endInset={CONTROLS_BOTTOM}
        crossStartInset={GAP}
        crossEndInset={GAP}
        onMounted={onMounted}
        onReorder={reorder}
        // Only left removes a clip: a finger going right leaves it where it is.
        swipeDirections={['left']}
        onSwipe={(c) => remove(c.id)}
        touchRegions={touchRegions}
        renderItem={renderItem}
      />
      <View style={controls.top} pointerEvents="box-none">
        <Button label="2 cols" on={columns === 2} onPress={() => setColumns(2)} />
        <Button label="3 cols" on={columns === 3} onPress={() => setColumns(3)} />
        <Button label={autoplay ? 'Pause all' : 'Play all'} onPress={toggleAutoplay} />
      </View>
      <View style={controls.bottom} pointerEvents="box-none">
        <Text style={controls.count}>{items.length} clips</Text>
        <Button label="Add 12" onPress={() => add(12)} />
        <Button label="Reset" onPress={() => setItems(clips(1, 24))} />
      </View>
    </View>
  );
}

/** Room the chips at the top take. */
const CONTROLS_TOP_ROOM = 56;

const styles = StyleSheet.create({
  root: { flex: 1 },
  grid: { flex: 1 },
  card: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  label: { position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  remove: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  removeMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

/** Memoized: the meter in `App` re-renders on every change in mounted cells, and that mustn't reach the cards. */
export default memo(VideosTab);
