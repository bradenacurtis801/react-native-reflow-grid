import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';
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

/** A folder icon's corner radius, as a fraction of its side. */
export const FOLDER_RADIUS = 0.26;

/** The miniatures in a folder icon of side `size`: three across, `gap` apart, `pad` in from its edges. */
export function miniGrid(size: number) {
  const mini = size * 0.2;
  const gap = size * 0.055;
  return { mini, gap, pad: (size - mini * 3 - gap * 2) / 2 };
}

/** A folder's pane of glass, with the first nine of its apps in miniature. */
function FolderSquare({ folder, size }: { folder: FolderItem; size: number }) {
  const { mini, gap, pad } = miniGrid(size);
  return (
    <Glass style={{ width: size, height: size, borderRadius: size * FOLDER_RADIUS }}>
      {/* No padding on the right: that leaves a little spare, so rounding can't wrap the miniatures two across. */}
      <View style={[styles.minis, { padding: pad, paddingRight: 0, gap }]}>
        {folder.apps.slice(0, 9).map((app) => (
          <AppSquare key={app.id} app={app} size={mini} />
        ))}
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

/**
 * An app or a folder as it sits on the screen: its square, its badge and, outside the dock, its name. `away` takes the square
 * and badge out of sight (an open folder's have become its pane): moved rather than removed, so the glass is there at once
 * when they come back.
 */
export function Icon({ entry, size, label = true, away = false }: { entry: Entry; size: number; label?: boolean; away?: boolean }) {
  return (
    <View style={styles.icon}>
      <View style={[{ width: size, height: size }, away && styles.away]}>
        {entry.kind === 'app' ? <AppSquare app={entry} size={size} /> : <FolderSquare folder={entry} size={size} />}
        <Badge count={badgeOf(entry)} />
      </View>
      {label ? <Name>{entry.name}</Name> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', alignSelf: 'stretch' },
  square: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  minis: { flexDirection: 'row', flexWrap: 'wrap' },
  away: { transform: [{ translateX: -10000 }] },
  badge: { position: 'absolute', top: -9, right: -11, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff3b30' },
  badgeText: { color: '#fff', fontSize: 15, fontVariant: ['tabular-nums'] },
  label: { marginTop: LABEL_GAP, height: LABEL_H, maxWidth: '96%', color: '#fff', fontSize: 12, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 4 },
});
