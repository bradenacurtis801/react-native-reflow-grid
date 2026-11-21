import { StyleSheet, View } from 'react-native';
import { INK, INK_DIM } from './metrics';

/** Small icons drawn from views, so the demo needs no icon font. Every line is `STROKE` thick, as thin as Safari's. */
const STROKE = 1.75;

export function Chevron({ direction, dim }: { direction: 'left' | 'right'; dim?: boolean }) {
  return (
    <View
      style={[
        styles.chevron,
        { borderColor: INK, opacity: dim ? 0.35 : 1, transform: [{ rotate: direction === 'left' ? '45deg' : '-135deg' }, { translateX: direction === 'left' ? 2 : -2 }] },
      ]}
    />
  );
}

export function Plus() {
  return (
    <View style={styles.box}>
      <View style={[styles.bar, { width: 20, height: STROKE }]} />
      <View style={[styles.bar, { width: STROKE, height: 20, position: 'absolute' }]} />
    </View>
  );
}

/** Two squares, the one behind showing only its top and right edges: Safari's tabs button. */
export function Sheets() {
  return (
    <View style={styles.box}>
      <View style={[styles.sheet, { top: 1, left: 7, borderLeftWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 0, borderBottomRightRadius: 0 }]} />
      <View style={[styles.sheet, { top: 6, left: 2 }]} />
    </View>
  );
}

/** A tray open at the top, and an arrow rising out of it. */
export function Share() {
  return (
    <View style={styles.box}>
      <View style={styles.tray} />
      <View style={styles.shaft} />
      <View style={styles.head} />
    </View>
  );
}

export function Book() {
  return (
    <View style={[styles.box, { flexDirection: 'row', gap: 1 }]}>
      <View style={[styles.page, { borderTopLeftRadius: 5, borderBottomLeftRadius: 5, borderRightWidth: STROKE / 2 }]} />
      <View style={[styles.page, { borderTopRightRadius: 5, borderBottomRightRadius: 5, borderLeftWidth: STROKE / 2 }]} />
    </View>
  );
}

export function Magnifier() {
  return (
    <View style={{ width: 16, height: 16 }}>
      <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: INK_DIM }} />
      <View style={{ position: 'absolute', left: 10, top: 11, width: 6, height: 2, backgroundColor: INK_DIM, transform: [{ rotate: '45deg' }] }} />
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: { width: 15, height: 15, borderLeftWidth: STROKE, borderBottomWidth: STROKE, borderRadius: 1 },
  box: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  bar: { backgroundColor: INK, borderRadius: STROKE },
  sheet: { position: 'absolute', width: 18, height: 18, borderRadius: 4, borderWidth: STROKE, borderColor: INK },
  tray: { position: 'absolute', bottom: 3, width: 20, height: 13, borderRadius: 4, borderWidth: STROKE, borderColor: INK, borderTopWidth: 0 },
  shaft: { position: 'absolute', top: 3, width: STROKE, height: 15, backgroundColor: INK, borderRadius: STROKE },
  head: { position: 'absolute', top: 4, width: 9, height: 9, borderLeftWidth: STROKE, borderTopWidth: STROKE, borderColor: INK, transform: [{ rotate: '45deg' }] },
  page: { width: 12, height: 18, borderWidth: STROKE, borderColor: INK },
});
