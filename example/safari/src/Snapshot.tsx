import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CARD_H, CARD_RADIUS, CARD_W, SH, SW } from './metrics';
import { PageContent } from './PageContent';
import type { Tab } from './tabs';

/**
 * A card's preview of its page: the page laid out at a screen's size, scaled down to the card's width, and cropped to its height
 * (so it shows the page as it was left: its top, or where it was scrolled to, as Safari's cards do). Rasterized on iOS, so a card scrolled past isn't drawn from its parts again.
 */
function SnapshotImpl({ tab, offset = 0 }: { tab: Tab; offset?: number }) {
  return (
    <View style={styles.card} shouldRasterizeIOS>
      <View style={styles.page}>
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
  card: { width: CARD_W, height: CARD_H, overflow: 'hidden', borderRadius: CARD_RADIUS },
  page: { width: SW, height: SH, overflow: 'hidden', transformOrigin: 'top left', transform: [{ scale: CARD_W / SW }] },
});
