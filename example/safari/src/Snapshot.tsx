import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CARD_RADIUS, useMetrics } from './metrics';
import { PageContent } from './PageContent';
import type { Tab } from './tabs';

/**
 * A card's preview of its page: the page laid out at a screen's size, scaled down to the card's width, and cropped to its height
 * (so it shows the page as it was left: its top, or where it was scrolled to, as Safari's cards do). Rasterized on iOS, so a card scrolled past isn't drawn from its parts again.
 */
function SnapshotImpl({ tab, offset = 0 }: { tab: Tab; offset?: number }) {
  const { width, height, cardW, cardH } = useMetrics();
  return (
    <View style={[styles.card, { width: cardW, height: cardH }]} shouldRasterizeIOS>
      <View style={[styles.page, { width, height, transform: [{ scale: cardW / width }] }]}>
        {/* Where the page was scrolled to when it was last open. */}
        <View style={{ transform: [{ translateY: -offset }] }}>
          <PageContent tab={tab} />
        </View>
      </View>
    </View>
  );
}

export const Snapshot = memo(SnapshotImpl);

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderRadius: CARD_RADIUS },
  page: { overflow: 'hidden', transformOrigin: 'top left' },
});
