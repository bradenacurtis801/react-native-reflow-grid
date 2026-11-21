import { Pressable, StyleSheet, Text } from 'react-native';

export function Button({ label, onPress, on }: { label: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, on && styles.buttonOn]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

/** Room the controls pinned at the bottom take over a grid. */
export const CONTROLS_BOTTOM = 92;

export const controls = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 8, paddingHorizontal: 16, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
});

const styles = StyleSheet.create({
  button: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#2a2f3a' },
  buttonOn: { backgroundColor: '#3a4150' },
  buttonLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
