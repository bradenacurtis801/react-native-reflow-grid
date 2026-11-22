import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Easing, ReduceMotion, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { gridLayout, ReflowGrid, type ReflowLayout } from 'react-native-reflow-grid';
import { Backdrop } from './src/Backdrop';
import { OverviewBars, PageBars } from './src/Bars';
import { CARD_RADIUS, GAP, makeMetrics, MetricsContext, SIDE, TITLE_H, useMetrics } from './src/metrics';
import { PageOverlay, type Frame } from './src/PageOverlay';
import { Snapshot } from './src/Snapshot';
import { makeTabs, type Tab } from './src/tabs';
import { useHues } from './src/useHues';

/** How a page grows out of its card and back: a timed ease, with no bounce. */
const GROW = { duration: 340, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.Never };

/** A tab that's open: which, and where its card is on the screen. */
interface Open {
  tab: Tab;
  frame: Frame;
}

/** Safari's tab overview, from the grid: tap a card and its page grows to fill the screen, and back through the tabs button. */
export default function App() {
  // Everything sized from the window is worked out again when it changes (an iPad turning, or split).
  const { width, height } = useWindowDimensions();
  const metrics = useMemo(() => makeMetrics(width, height), [width, height]);
  return (
    <GestureHandlerRootView style={styles.root}>
      <MetricsContext.Provider value={metrics}>
        <Tabs />
      </MetricsContext.Provider>
    </GestureHandlerRootView>
  );
}

function Tabs() {
  const { columns, cardW, cardH, gridTop, gridBottom } = useMetrics();
  // Two groups of tabs, and which one the overview shows: Safari's Private Browsing is a group of its own.
  const [groups, setGroups] = useState(() => ({ normal: makeTabs(1, 12), private: makeTabs(13, 3) }));
  const next = useRef(16);
  const [isPrivate, setPrivate] = useState(false);
  const group = isPrivate ? 'private' : 'normal';
  const tabs = groups[group];
  const setTabs = useCallback((update: (all: Tab[]) => Tab[]) => setGroups((g) => ({ ...g, [group]: update(g[group]) })), [group]);
  const [open, setOpen] = useState<Open | null>(null);
  // The page has grown to the whole screen (it scrolls, its bars are live), or is on its way back.
  const [expanded, setExpanded] = useState(false);
  // Where each tab's page was scrolled to when it was last open: its card shows it there, and it opens there again.
  const [offsets, setOffsets] = useState<Record<number, number>>({});
  const scrollY = useSharedValue(0);
  const [last, setLast] = useState<Tab | null>(null);
  const [query, setQuery] = useState('');
  // Counts reloads: the page scrolls back to its top each time.
  const [reloads, setReloads] = useState(0);
  // How far the page has grown (0: its card, 1: the screen), and whether its bars are away (they follow its scroll).
  const p = useSharedValue(0);
  const hidden = useSharedValue(0);
  // 1, and less as the open page is pinched in: the bars follow it.
  const squeeze = useSharedValue(1);
  // The page is on its way back into its card.
  const shrinking = useSharedValue(false);
  // Each card's preview, to measure where the page grows from.
  const previews = useRef(new Map<number, ComponentRef<typeof View>>());
  const busy = useRef(false);

  const remove = useCallback((id: number) => setTabs((all) => all.filter((t) => t.id !== id)), [setTabs]);
  const reorder = useCallback(({ keys }: { keys: readonly string[] }) => {
    setTabs((all) => {
      const byId = new Map(all.map((t) => [String(t.id), t]));
      return keys.flatMap((k) => byId.get(k) ?? []);
    });
  }, [setTabs]);
  const addTab = useCallback(() => {
    const from = next.current;
    next.current += 1;
    setTabs((all) => [...all, ...makeTabs(from, 1)]);
  }, [setTabs]);

  const grown = useCallback(() => {
    setExpanded(true);
    busy.current = false;
  }, []);
  const gone = useCallback(() => {
    setOpen(null);
    busy.current = false;
  }, []);

  const openTab = useCallback(
    (tab: Tab) => {
      const preview = previews.current.get(tab.id);
      if (busy.current || !preview) return;
      busy.current = true;
      preview.measureInWindow((x, y, w, h) => {
        hidden.set(0);
        squeeze.set(1);
        shrinking.set(false);
        p.set(0);
        setLast(tab);
        scrollY.set(offsets[tab.id] ?? 0);
        setOpen({ tab, frame: { x, y, w, h } });
        p.set(withTiming(1, GROW, (done) => done && runOnJS(grown)()));
      });
    },
    [p, hidden, squeeze, grown, shrinking, scrollY, offsets],
  );

  const closePage = useCallback(() => {
    if (busy.current || !open) return;
    busy.current = true;
    shrinking.set(true);
    setExpanded(false);
    const y = scrollY.get();
    setOffsets((all) => ({ ...all, [open.tab.id]: y }));
    hidden.set(withTiming(0, { duration: 180, reduceMotion: ReduceMotion.Never }));
    p.set(withTiming(0, GROW, (done) => done && runOnJS(gone)()));
  }, [open, p, hidden, gone, shrinking, scrollY]);

  // The page is taken away as soon as it's back in its card, not when its animation has quite finished: left there, it would sit
  // still over the grid while the grid scrolls.
  useAnimatedReaction(
    () => shrinking.get() && p.get() <= 0.01,
    (back, was) => {
      if (back && !was) {
        shrinking.set(false);
        runOnJS(gone)();
      }
    },
  );

  // Done goes back into the tab that was last open, as Safari's does.
  const done = useCallback(() => {
    const again = last && tabs.find((t) => t.id === last.id);
    if (again) openTab(again);
  }, [last, tabs, openTab]);

  // The tabs the search leaves, by title or address.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tabs.filter((t) => t.title.toLowerCase().includes(q) || t.host.includes(q)) : tabs;
  }, [tabs, query]);
  const share = useCallback(() => {
    if (open) void Share.share({ message: open.tab.title, url: `https://${open.tab.host}` });
  }, [open]);
  // The address pill was edited: the page takes the new address.
  const setHost = useCallback((host: string) => {
    setOpen((o) => (o ? { ...o, tab: { ...o.tab, host } } : o));
    setTabs((all) => all.map((t) => (t.id === open?.tab.id ? { ...t, host } : t)));
  }, [open, setTabs]);
  // The count in the toolbar switches between the two groups.
  const switchGroup = useCallback(() => {
    setPrivate((on) => !on);
    setQuery('');
  }, []);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  const layout = useMemo<ReflowLayout<Tab>>(
    () => gridLayout({ flow: 'vertical', lines: columns, gap: GAP, card: { aspect: cardW / (cardH + TITLE_H) } }),
    [columns, cardW, cardH],
  );

  // The backdrop takes the colours of the cards in the middle of the screen.
  const { hues, onScroll } = useHues(layout, shown);

  // The ✕ comes first: where regions overlap, the first one a touch lands in is the one pressed.
  const touchRegions = useCallback(
    (t: Tab, { size }: { size: { width: number; height: number } }) => [
      { key: 'close', rect: { x: size.width - 46, y: 2, width: 44, height: 44 }, onPress: () => remove(t.id) },
      { key: 'open', rect: { x: 0, y: 0, width: size.width, height: size.height }, onPress: () => openTab(t) },
    ],
    [remove, openTab],
  );

  // Stable, so a card is drawn again only when its own tab or place changes (or a page's saved scroll position does).
  // The card of the tab that's open is hidden: its page is out of it, and a page and its own card never show together.
  const openId = open?.tab.id;
  const renderItem = useCallback(
    (t: Tab) => (
      <View style={[styles.slot, t.id === openId && styles.away]}>
        <View
          ref={(node) => {
            if (node) previews.current.set(t.id, node);
            else previews.current.delete(t.id);
          }}
          collapsable={false}
          style={[styles.preview, { width: cardW, height: cardH }]}
        >
          <Snapshot tab={t} offset={offsets[t.id] ?? 0} />
          <View style={styles.close}>
            <Text style={styles.closeMark}>✕</Text>
          </View>
        </View>
        <View style={styles.titleRow}>
          <View style={[styles.favicon, { backgroundColor: `hsl(${t.hue}, 68%, 52%)` }]} />
          <Text style={styles.title} numberOfLines={1}>
            {t.title}
          </Text>
        </View>
      </View>
    ),
    [offsets, cardW, cardH, openId],
  );
  // What a card shows while it waits to draw its page (see `settleDelay`).
  const renderPlaceholder = useCallback(
    (t: Tab) => (
      <View style={styles.slot}>
        <View style={[styles.preview, { width: cardW, height: cardH, backgroundColor: t.dark ? `hsl(${t.hue}, 30%, 14%)` : `hsl(${t.hue}, 50%, 88%)` }]} />
      </View>
    ),
    [cardW, cardH],
  );

  return (
    <View style={styles.root}>
      <Backdrop isPrivate={isPrivate} hues={hues} />
      {/* A finger moving over the grid (a scroll, or a drag) puts the search field's keyboard away. While a page is open the grid
          is under it and takes no touches, so a drag on the page can't also move the grid. */}
      <View style={styles.grid} pointerEvents={open ? 'none' : 'auto'} onTouchMove={Keyboard.dismiss}>
        <ReflowGrid
          style={styles.cards}
          data={shown}
          keyExtractor={(t) => String(t.id)}
          layout={layout}
          startInset={gridTop}
          endInset={gridBottom}
          onScroll={onScroll}
          onReorder={query ? undefined : reorder}
          onSwipe={(t) => remove(t.id)}
          swipeDirections={['left']}
          reduceMotion={ReduceMotion.Never}
          touchRegions={touchRegions}
          renderItem={renderItem}
          renderPlaceholder={renderPlaceholder}
        />
      </View>
      {open ? <PageOverlay tab={open.tab} frame={open.frame} p={p} hidden={hidden} scrollY={scrollY} squeeze={squeeze} onPinchClose={closePage} initialY={offsets[open.tab.id] ?? 0} expanded={expanded} reloads={reloads} /> : null}
      <OverviewBars p={p} count={tabs.length} isPrivate={isPrivate} onGroup={switchGroup} active={!open} query={query} onQuery={setQuery} onNew={addTab} onDone={done} />
      <PageBars p={p} hidden={hidden} squeeze={squeeze} host={open?.tab.host ?? ''} active={expanded} onTabs={closePage} onReload={reload} onShare={share} onHost={setHost} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b1e26' },
  grid: { flex: 1 },
  cards: { flex: 1, marginHorizontal: SIDE },
  slot: { flex: 1 },
  away: { opacity: 0 },
  preview: { borderRadius: CARD_RADIUS, backgroundColor: '#262a33' },
  close: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(30,33,41,0.78)' },
  closeMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  titleRow: { height: TITLE_H, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  favicon: { width: 16, height: 16, borderRadius: 8 },
  title: { flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600' },
});
