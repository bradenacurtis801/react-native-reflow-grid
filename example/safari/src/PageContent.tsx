import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMetrics } from './metrics';
import type { Tab } from './tabs';

const WORDS = (
  'light water stone paper window garden river morning slowly careful simple quiet bright narrow open measure shadow ' +
  'season corner letter bridge window harbour kitchen pattern signal gentle ordinary steady common afternoon'
).split(' ');

/** A sentence of `length` words, the same for the same `seed`. */
function sentence(seed: number, length: number) {
  const words = Array.from({ length }, (_, i) => WORDS[(seed * 7 + i * 13 + ((i * seed) % 5)) % WORDS.length]!);
  const text = words.join(' ');
  return text[0]!.toUpperCase() + text.slice(1) + '.';
}

const paragraph = (seed: number) => [sentence(seed, 11), sentence(seed + 3, 9), sentence(seed + 5, 13)].join(' ');

/**
 * A made-up page, laid out for a full screen's width: a masthead, a few pictures (blocks of colour), sections of text and a list.
 * The cards show it scaled down, and the page that opens is this, scrolling.
 */
function PageContentImpl({ tab }: { tab: Tab }) {
  const { width, top } = useMetrics();
  const accent = `hsl(${tab.hue}, 68%, 52%)`;
  const ground = tab.dark ? `hsl(${tab.hue}, 30%, 11%)` : '#ffffff';
  const ink = tab.dark ? '#f2f3f5' : '#14161a';
  const soft = tab.dark ? '#aeb4bf' : '#5a606b';
  const band = tab.dark ? `hsl(${tab.hue}, 28%, 19%)` : `hsl(${tab.hue}, 60%, 94%)`;

  return (
    <View style={{ width, backgroundColor: ground }}>
      <View style={[styles.masthead, { paddingTop: top + 74, backgroundColor: tab.dark ? `hsl(${tab.hue}, 45%, 22%)` : accent }]}>
        <Text style={styles.site}>{tab.host.toUpperCase()}</Text>
        <Text style={styles.headline}>{tab.title}</Text>
        <Text style={styles.deck}>{sentence(tab.id + 1, 14)}</Text>
      </View>

      <View style={styles.pictures}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.picture, { backgroundColor: `hsl(${(tab.hue + i * 28) % 360}, 62%, ${tab.dark ? 38 : 70}%)` }]} />
        ))}
      </View>

      {[0, 1, 2, 3].map((section) => (
        <View key={section} style={styles.section}>
          <Text style={[styles.heading, { color: ink }]}>{sentence(tab.id + section * 11, 4).replace('.', '')}</Text>
          <Text style={[styles.body, { color: soft }]}>{paragraph(tab.id + section)}</Text>
          <Text style={[styles.body, { color: soft }]}>{paragraph(tab.id + section + 7)}</Text>
          {section === 1 ? <View style={[styles.callout, { backgroundColor: band, borderLeftColor: accent }]}>
            <Text style={[styles.quote, { color: ink }]}>{sentence(tab.id + 31, 12)}</Text>
          </View> : null}
        </View>
      ))}

      <View style={styles.section}>
        <Text style={[styles.heading, { color: ink }]}>Further reading</Text>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={[styles.row, { backgroundColor: band }]}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={[styles.rowText, { color: ink }]} numberOfLines={1}>
              {sentence(tab.id + i * 5, 6)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.footer} />
    </View>
  );
}

export const PageContent = memo(PageContentImpl);

const styles = StyleSheet.create({
  masthead: { paddingHorizontal: 22, paddingBottom: 30, gap: 10 },
  site: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700', letterSpacing: 1.2 },
  headline: { color: '#fff', fontSize: 34, fontWeight: '800', lineHeight: 39 },
  deck: { color: 'rgba(255,255,255,0.88)', fontSize: 17, lineHeight: 24 },
  pictures: { flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingTop: 22 },
  picture: { flex: 1, height: 120, borderRadius: 14 },
  section: { paddingHorizontal: 22, paddingTop: 26, gap: 12 },
  heading: { fontSize: 23, fontWeight: '800' },
  body: { fontSize: 17, lineHeight: 26 },
  callout: { borderLeftWidth: 4, borderRadius: 8, padding: 16, marginTop: 6 },
  quote: { fontSize: 19, fontWeight: '600', lineHeight: 27 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, fontSize: 16, fontWeight: '600' },
  footer: { height: 190 },
});
