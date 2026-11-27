import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { gridLayout, pagedLayout, ReflowGrid, type DragResult } from 'react-native-reflow-grid';
import { DOCK, HOME, type Entry, type FolderItem } from './src/apps';
import { FolderOverlay, type Frame } from './src/FolderOverlay';
import { Glass } from './src/Glass';
import { Icon } from './src/Icon';
import { BADGE_ROOM, DOCK_H, DOCK_SIDE, LABEL_GAP, LABEL_H, makeMetrics, MetricsContext, SIDE, useMetrics } from './src/metrics';
import { Wallpaper } from './src/Wallpaper';

/** `items` in the order of `keys`. */
function inOrder<T extends { id: string }>(items: readonly T[], keys: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return keys.flatMap((key) => byId.get(key) ?? []);
}

/** An iOS home screen from the grid: pages of apps and glass folders, and a dock. Hold an icon to move it; tap a folder to open it. */
export default function App() {
  const { width, height } = useWindowDimensions();
  const metrics = useMemo(() => makeMetrics(width, height), [width, height]);
  return (
    <MetricsContext.Provider value={metrics}>
      <StatusBar style="light" />
      <HomeScreen />
    </MetricsContext.Provider>
  );
}

function HomeScreen() {
  const { width, columns, rows, cellW, rowH, icon, gridTop, gridH, dockBottom } = useMetrics();
  const [home, setHome] = useState(HOME);
  const [dock, setDock] = useState(DOCK);
  const [open, setOpen] = useState<{ id: string; frame: Frame } | null>(null);
  const [closing, setClosing] = useState(false);
  // Which of the pages and the dock is drawn over the other: the one an icon was last lifted from, so it passes over.
  const [front, setFront] = useState<'pages' | 'dock'>('pages');
  // Each folder's square, to measure where it opens from.
  const squares = useRef(new Map<string, ComponentRef<typeof View>>());

  const folder = open ? [...home, ...dock].find((e): e is FolderItem => e.id === open.id && e.kind === 'folder') : undefined;

  const openFolder = useCallback((id: string) => {
    squares.current.get(id)?.measureInWindow((x, y, w, h) => {
      setClosing(false);
      setOpen({ id, frame: { x, y, w, h } });
    });
  }, []);
  const close = useCallback(() => setClosing(true), []);
  const closed = useCallback(() => {
    setOpen(null);
    setClosing(false);
  }, []);

  const reorderHome = useCallback(({ keys }: DragResult) => setHome((all) => inOrder(all, keys)), []);
  const reorderDock = useCallback(({ keys }: DragResult) => setDock((all) => inOrder(all, keys)), []);
  const reorderFolder = useCallback(
    ({ keys }: DragResult) => {
      const update = (all: Entry[]) => all.map((e) => (e.id === open?.id && e.kind === 'folder' ? { ...e, apps: inOrder(e.apps, keys) } : e));
      setHome(update);
      setDock(update);
    },
    [open?.id],
  );

  const liftFromPages = useCallback(() => setFront('pages'), []);
  const liftFromDock = useCallback(() => setFront('dock'), []);

  // Pages of apps. `pageGap` is twice the side margin, so each page keeps it while the grid itself reaches the screen's edges.
  const pages = useMemo(
    () => pagedLayout({ direction: 'horizontal', columns, rows, pageGap: SIDE * 2, card: { width: cellW, height: rowH } }),
    [columns, rows, cellW, rowH],
  );
  // The dock: one row of four, as wide as the dock.
  const dockCell = (width - DOCK_SIDE * 2) / 4;
  const row = useMemo(() => gridLayout({ flow: 'horizontal', lines: 1, card: { length: dockCell } }), [dockCell]);

  // A folder is pressed on its square and name, and nowhere else in its cell.
  const pageRegions = useCallback(
    (e: Entry) => (e.kind === 'folder' ? [{ key: 'open', rect: { x: (cellW - icon) / 2, y: BADGE_ROOM, width: icon, height: icon + LABEL_GAP + LABEL_H }, onPress: () => openFolder(e.id) }] : []),
    [cellW, icon, openFolder],
  );
  const dockRegions = useCallback(
    (e: Entry) => (e.kind === 'folder' ? [{ key: 'open', rect: { x: (dockCell - icon) / 2, y: (DOCK_H - icon) / 2, width: icon, height: icon }, onPress: () => openFolder(e.id) }] : []),
    [dockCell, icon, openFolder],
  );

  // The open folder's square is moved out of sight, not faded: its pane has grown out of it.
  const openId = open?.id;
  // A folder's cell also marks where its square is, to open it from. The marker stays when the square is moved away.
  const mark = useCallback(
    (e: Entry, top?: number) =>
      e.kind === 'folder' ? (
        <View
          ref={(node) => {
            if (node) squares.current.set(e.id, node);
            else squares.current.delete(e.id);
          }}
          collapsable={false}
          style={{ position: 'absolute', top, alignSelf: 'center', width: icon, height: icon }}
        />
      ) : null,
    [icon],
  );
  const renderApp = useCallback(
    (e: Entry) => (
      <View style={styles.pageCell}>
        {mark(e, BADGE_ROOM)}
        <Icon entry={e} size={icon} away={e.id === openId} />
      </View>
    ),
    [mark, icon, openId],
  );
  const renderDocked = useCallback(
    (e: Entry) => (
      <View style={styles.dockCell}>
        {mark(e)}
        <View style={{ width: icon }}>
          <Icon entry={e} size={icon} label={false} away={e.id === openId} />
        </View>
      </View>
    ),
    [mark, icon, openId],
  );

  return (
    <View style={styles.root}>
      <Wallpaper />
      <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'none' : 'auto'}>
        {/* The dock first, so an icon lifted from the pages passes over it. The glass is behind the dock's grid, not around it,
            so it can't clip an icon that's carried out. */}
        <View style={[styles.dock, { bottom: dockBottom, zIndex: front === 'dock' ? 1 : 0 }]}>
          <Glass style={[StyleSheet.absoluteFill, styles.dockGlass]} />
          <ReflowGrid
            style={styles.dockGrid}
            axis="horizontal"
            data={dock}
            keyExtractor={(e) => e.id}
            layout={row}
            renderItem={renderDocked}
            settleDelay={0}
            touchRegions={dockRegions}
            onReorder={reorderDock}
            onDragStart={liftFromDock}
            dragOverflow="visible"
            reduceMotion={ReduceMotion.Never}
            pageIndicator={false}
          />
        </View>
        <ReflowGrid
          style={{ position: 'absolute', top: gridTop, left: 0, right: 0, height: gridH }}
          axis="horizontal"
          data={home}
          keyExtractor={(e) => e.id}
          layout={pages}
          renderItem={renderApp}
          // Icons are cheap and a page turn should show them at once.
          settleDelay={0}
          touchRegions={pageRegions}
          onReorder={reorderHome}
          onDragStart={liftFromPages}
          dragOverflow="visible"
          reduceMotion={ReduceMotion.Never}
          pageIndicator={{ color: 'rgba(255,255,255,0.4)', activeColor: '#fff' }}
        />
      </View>
      {open && folder ? <FolderOverlay folder={folder} frame={open.frame} closing={closing} onClose={close} onClosed={closed} onReorder={reorderFolder} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7b869b' },
  pageCell: { flex: 1, paddingTop: BADGE_ROOM },
  dock: { position: 'absolute', left: DOCK_SIDE, right: DOCK_SIDE, height: DOCK_H },
  dockGlass: { borderRadius: 40 },
  dockGrid: { flex: 1 },
  dockCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
