import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { badgeOf, type AppItem, type Entry, type FolderItem } from './apps';
import { Glass } from './Glass';
import { LABEL_GAP, LABEL_H } from './metrics';

/** An app's square: its gradient and its symbol, at any size. */
export function AppSquare({ app, size }: { app: AppItem; size: number }) {
  return (
    <View style={[styles.square, { width: size, height: size, borderRadius: size * 0.235, backgroundImage: `linear-gradient(180deg, ${app.colors[0]} 0%, ${app.colors[1]} 100%)` }]}>
      <SymbolView name={app.glyph} size={size * 0.58} tintColor={app.ink} />
    </View>
  );
}

/** How far (pt) the dark pane behind a covered icon reaches past it. */
const PLATE = 12;

/** A folder icon's corner radius, as a fraction of its side. */
export const FOLDER_RADIUS = 0.26;

/** The miniatures in a folder icon of side `size`: three across, `gap` apart, `pad` in from its edges. */
export function miniGrid(size: number) {
  const mini = size * 0.2;
  const gap = size * 0.055;
  return { mini, gap, pad: (size - mini * 3 - gap * 2) / 2 };
}

/** How the miniatures slide back to the first page, and how long after the folder is home (ms). */
const SLIDE = { duration: 320, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.Never };
const SLIDE_AFTER = 160;

/**
 * A folder's pane of glass, with its apps in miniature, nine to a page, the first page showing. While the folder is open
 * (`away`) it's set to the `page` the folder is closed from, so it matches as the pane gets home; then it slides to the first.
 */
function FolderSquare({ folder, size, away, page }: { folder: FolderItem; size: number; away: boolean; page: number }) {
  const { mini, gap, pad } = miniGrid(size);
  const at = useSharedValue(0);
  useEffect(() => {
    at.set(away ? page : withDelay(SLIDE_AFTER, withTiming(0, SLIDE)));
  }, [away, page, at]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: -at.get() * size }] }));
  const pages = Array.from({ length: Math.ceil(folder.apps.length / 9) }, (_, i) => folder.apps.slice(i * 9, i * 9 + 9));
  return (
    <Glass style={{ width: size, height: size, borderRadius: size * FOLDER_RADIUS }}>
      <View style={[StyleSheet.absoluteFill, styles.window, { borderRadius: size * FOLDER_RADIUS }]}>
        <Animated.View style={strip}>
          {pages.map((apps, i) => (
            // No padding on the right: that leaves a little spare, so rounding can't wrap the miniatures two across.
            <View key={i} style={[styles.minis, { left: i * size, width: size, height: size, padding: pad, paddingRight: 0, gap }]}>
              {apps.map((app) => (
                <AppSquare key={app.id} app={app} size={mini} />
              ))}
            </View>
          ))}
        </Animated.View>
      </View>
    </Glass>
  );
}

/** The red count on an icon's corner; nothing for 0. */
export function Badge({ count }: { count: number }) {
  return count > 0 ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count}</Text>
    </View>
  ) : null;
}

export function Name({ children }: { children: string }) {
  return (
    <Text style={styles.label} numberOfLines={1}>
      {children}
    </Text>
  );
}

/** 0 to 1 as `on` turns true, and back. It starts where `on` is, so what's drawn afresh doesn't animate. */
function useTurnedOn(on: boolean) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, { duration: 220, reduceMotion: ReduceMotion.Never }));
  }, [on, v]);
  return v;
}

/**
 * An app or a folder as it sits on the screen: its square, its badge and, outside the dock, its name.
 *
 * `highlighted`: a dragged app is over it. A darker pane grows in behind it and its name fades. A lifted icon (`dragging`)
 * loses its name too. `away` takes the square and badge out of sight (an open folder's have become its pane): moved rather
 * than removed, so the glass is there at once when they come back.
 */
export function Icon({ entry, size, label = true, away = false, page = 0, highlighted = false, dragging = false }: { entry: Entry; size: number; label?: boolean; away?: boolean; page?: number; highlighted?: boolean; dragging?: boolean }) {
  const covered = useTurnedOn(highlighted);
  const nameless = useTurnedOn(highlighted || dragging);
  const plate = useAnimatedStyle(() => ({ opacity: covered.get(), transform: [{ scale: 0.84 + 0.16 * covered.get() }] }));
  const grown = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (entry.kind === 'folder' ? 0.1 : 0) * covered.get() }] }));
  const name = useAnimatedStyle(() => ({ opacity: 1 - nameless.get() }));
  return (
    <View style={styles.icon}>
      <View style={[{ width: size, height: size }, away && styles.away]}>
        <Animated.View style={[styles.plate, { borderRadius: (size + PLATE * 2) * FOLDER_RADIUS }, plate]} />
        {/* A folder that would take the app grows too. Scaled only: it's glass. */}
        <Animated.View style={grown}>{entry.kind === 'app' ? <AppSquare app={entry} size={size} /> : <FolderSquare folder={entry} size={size} away={away} page={page} />}</Animated.View>
        <Badge count={badgeOf(entry)} />
      </View>
      {label ? (
        <Animated.View style={[styles.name, name]}>
          <Name>{entry.name}</Name>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', alignSelf: 'stretch' },
  square: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  window: { overflow: 'hidden' },
  minis: { position: 'absolute', top: 0, flexDirection: 'row', flexWrap: 'wrap' },
  away: { transform: [{ translateX: -10000 }] },
  name: { alignSelf: 'stretch', alignItems: 'center' },
  plate: { position: 'absolute', left: -PLATE, top: -PLATE, right: -PLATE, bottom: -PLATE, borderCurve: 'continuous', backgroundColor: 'rgba(14,18,36,0.5)' },
  badge: { position: 'absolute', top: -9, right: -11, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff3b30' },
  badgeText: { color: '#fff', fontSize: 15, fontVariant: ['tabular-nums'] },
  label: { marginTop: LABEL_GAP, height: LABEL_H, maxWidth: '96%', color: '#fff', fontSize: 12, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 4 },
});
