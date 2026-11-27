import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { layoutFromRects, pagedLayout, ReflowDragProvider, ReflowGrid, type DragResult, type ItemRenderInfo, type JoinResult, type ReflowLayout } from 'react-native-reflow-grid';
import { DOCK, HOME, joined, SAFARI, type AppItem, type Entry, type FolderItem } from './src/apps';
import { FolderOverlay, type Frame } from './src/FolderOverlay';
import { Glass } from './src/Glass';
import { Icon } from './src/Icon';
import { SafariWindow } from './src/SafariWindow';
import { BADGE_ROOM, DOCK_H, DOCK_SIDE, LABEL_GAP, LABEL_H, makeMetrics, MetricsContext, SIDE, useMetrics } from './src/metrics';
import { Wallpaper } from './src/Wallpaper';

/** `items` in the order of `keys`. */
function inOrder<T extends { id: string }>(items: readonly T[], keys: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return keys.flatMap((key) => byId.get(key) ?? []);
}

/** An iOS home screen from the grid: pages of apps and glass folders, and a dock. Hold an icon to move it, to drop it on another, or to hold it there until that opens; tap a folder to open it. */
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

/** A folder that's open, or on its way: one a drag has left stays mounted, out of sight, until the drag ends. */
interface Overlay {
  id: string;
  frame: Frame;
  closing: boolean;
  /** A drag has left it. */
  ejected: boolean;
  /** Closed and out of sight, its icon back, but still mounted. */
  gone: boolean;
  /** The page of apps it was closed from. */
  page: number;
}

/** The dock holds this many. */
const DOCK_MAX = 4;
/** How long (ms) an icon is over the other of the pages and the dock before it goes there: no wait to speak of. */
const CROSS_MS = 80;

/** `all` without the app `appId` in the folder `folderId`. */
const without = (all: Entry[], folderId: string, appId: string) => all.map((e) => (e.id === folderId && e.kind === 'folder' ? { ...e, apps: e.apps.filter((x) => x.id !== appId) } : e));

function HomeScreen() {
  const { width, height, columns, rows, cellW, rowH, icon, gridTop, gridH, dockBottom } = useMetrics();
  const [home, setHome] = useState(HOME);
  const [dock, setDock] = useState(DOCK);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  // The folder that's open, if one is.
  const open = overlays.find((o) => !o.ejected);
  // Which of the pages and the dock is drawn over the other: the one an icon was last lifted from, so it passes over.
  const [front, setFront] = useState<'pages' | 'dock'>('pages');
  // Safari, from the first time it's opened: it stays running when closed.
  const [safari, setSafari] = useState<{ app: AppItem; frame: Frame; closing: boolean; gone: boolean } | null>(null);
  const safariUp = safari != null && !safari.gone;
  // Each square that opens something, to measure where it opens from.
  const squares = useRef(new Map<string, ComponentRef<typeof View>>());

  const folderOf = (id: string) => [...home, ...dock].find((e): e is FolderItem => e.id === id && e.kind === 'folder');
  const change = useCallback((id: string, to: Partial<Overlay>) => setOverlays((all) => all.map((o) => (o.id === id ? { ...o, ...to } : o))), []);

  const openFolder = useCallback((id: string) => {
    squares.current.get(id)?.measureInWindow((x, y, w, h) => {
      const next: Overlay = { id, frame: { x, y, w, h }, closing: false, ejected: false, gone: false, page: 0 };
      // One a drag has left, and is back over, is the same folder opening again.
      setOverlays((all) => (all.some((o) => o.id === id) ? all.map((o) => (o.id === id ? next : o)) : [...all, next]));
    });
  }, []);
  const openSafari = useCallback((app: AppItem) => {
    squares.current.get(app.id)?.measureInWindow((x, y, w, h) => setSafari({ app, frame: { x, y, w, h }, closing: false, gone: false }));
  }, []);
  const closeSafari = useCallback(() => setSafari((s) => s && { ...s, closing: true }), []);
  const safariClosed = useCallback(() => setSafari((s) => s && { ...s, gone: true }), []);
  const close = useCallback((id: string, page: number) => change(id, { closing: true, page }), [change]);
  // Closed: away with it, unless a drag has left it, which may still need it.
  const closed = useCallback((id: string) => setOverlays((all) => all.flatMap((o) => (o.id !== id ? [o] : o.ejected ? [{ ...o, gone: true }] : []))), []);
  // The drag that left a folder has ended: the folders kept for it go, and so does one it left empty.
  const dragEnded = useCallback(() => {
    setOverlays((all) => all.filter((o) => !o.ejected));
    setVisiting(false);
    const full = (all: Entry[]) => all.filter((e) => e.kind !== 'folder' || e.apps.length > 0);
    setHome(full);
    setDock(full);
  }, []);
  // An app dragged out of a folder goes to the pages, beside the folder, and the folder closes. The drag carries on there.
  const eject = useCallback(
    (folderId: string, appId: string, page: number) => {
      const app = folderOf(folderId)?.apps.find((x) => x.id === appId);
      if (!app) return false;
      setHome((all) => {
        const next = without(all, folderId, appId);
        const at = next.findIndex((e) => e.id === folderId);
        // A folder in the dock has no place in the pages: the end of the first.
        next.splice(at >= 0 ? at + 1 : Math.min(next.length, columns * rows - 1), 0, app);
        return next;
      });
      setDock((all) => without(all, folderId, appId));
      setVisiting(false);
      change(folderId, { closing: true, ejected: true, page });
    },
    [home, dock, change, columns, rows],
  );

  const reorderHome = useCallback(({ keys }: DragResult) => setHome((all) => inOrder(all, keys)), []);
  const reorderDock = useCallback(({ keys }: DragResult) => setDock((all) => inOrder(all, keys)), []);
  const reorderFolder = useCallback((id: string, { keys }: DragResult) => {
    const update = (all: Entry[]) => all.map((e) => (e.id === id && e.kind === 'folder' ? { ...e, apps: inOrder(e.apps, keys) } : e));
    setHome(update);
    setDock(update);
  }, []);

  const liftFromPages = useCallback(() => setFront('pages'), []);
  const liftFromDock = useCallback(() => setFront('dock'), []);

  // Pages of apps. `pageGap` is twice the side margin, so each page keeps it while the grid itself reaches the screen's edges.
  const pages = useMemo(
    () => pagedLayout({ direction: 'horizontal', columns, rows, pageGap: SIDE * 2, card: { width: cellW, height: rowH } }),
    [columns, rows, cellW, rowH],
  );
  // The dock: one row, in the middle of the glass, with room for four.
  const dockCell = (width - DOCK_SIDE * 2) / DOCK_MAX;
  const row = useCallback<ReflowLayout<Entry>>(
    (data, room) => {
      const start = (room.width - data.length * dockCell) / 2;
      return layoutFromRects(
        data.map((_, i) => ({ x: start + i * dockCell, y: 0, width: dockCell, height: room.height })),
        room,
      );
    },
    [dockCell],
  );

  // An icon dragged between the pages and the dock changes sides as soon as the finger is over the other: it's moved there in
  // `data`, and the grid that now has it takes the drag over.
  const dockTop = height - dockBottom - DOCK_H;
  const pageOn = useRef(0);
  // An app is over a full dock: it can go onto what's there, but it isn't moved in, so nothing makes room for it.
  const [visiting, setVisiting] = useState(false);
  const onPagesScroll = useCallback(({ x }: { x: number }) => (pageOn.current = Math.round(x / width)), [width]);
  const toDock = useCallback(
    ({ dragged, point }: { dragged: readonly string[]; point: { x: number; y: number } }) => {
      const entry = home.find((e) => e.id === dragged[0]);
      if (!entry || point.y < dockTop) return false;
      if (dock.length >= DOCK_MAX) {
        // Only an app can go onto something.
        if (entry.kind !== 'app') return false;
        setVisiting(true);
        return;
      }
      const start = DOCK_SIDE + (width - DOCK_SIDE * 2 - dock.length * dockCell) / 2;
      const at = Math.min(Math.max(Math.round((point.x - start) / dockCell), 0), dock.length);
      setHome(home.filter((e) => e !== entry));
      setDock([...dock.slice(0, at), entry, ...dock.slice(at)]);
    },
    [home, dock, dockTop, dockCell, width],
  );
  const toPages = useCallback(
    ({ dragged, point }: { dragged: readonly string[]; point: { x: number; y: number } }) => {
      if (point.y >= dockTop) return false;
      if (visiting) {
        // It was never moved: the pages, which still have it, take it back.
        setVisiting(false);
        return;
      }
      const entry = dock.find((e) => e.id === dragged[0]);
      if (!entry) return false;
      // At the end of the page on screen: from there it goes where the finger is.
      const at = Math.min(home.length, (pageOn.current + 1) * columns * rows - 1);
      setDock(dock.filter((e) => e !== entry));
      setHome([...home.slice(0, at), entry, ...home.slice(at)]);
    },
    [home, dock, dockTop, columns, rows, visiting],
  );

  // An app dropped on another makes a folder of the two; dropped on a folder, it goes in. The new folder takes the target's place.
  const folders = useRef(0);
  const join = useCallback((all: Entry[], set: (next: Entry[]) => void, { dragged, target }: JoinResult) => {
    const next = joined(all, dragged[0]!, target, `folder-new-${folders.current + 1}`);
    if (!next) return false;
    if (next.id !== target) folders.current += 1;
    set(next.entries);
    return next.id;
  }, []);
  const joinHome = useCallback((result: JoinResult) => join(home, setHome, result), [join, home]);
  // Onto something in the dock: an app from there, or one visiting from the pages, which leaves them.
  const joinDock = useCallback(
    (result: JoinResult) => {
      const visitor = home.find((e) => e.id === result.dragged[0]);
      if (!visitor) return join(dock, setDock, result);
      const id = join([...dock, visitor], setDock, result);
      if (id !== false) setHome(home.filter((e) => e !== visitor));
      return id;
    },
    [join, dock, home],
  );
  // Held on longer, the app goes in and the folder opens under the finger, which carries on in there.
  const spring = useCallback(
    (id: string | false) => {
      // Once the folder is drawn in its place, it can be opened from there.
      if (id !== false) requestAnimationFrame(() => requestAnimationFrame(() => openFolder(id)));
      return id;
    },
    [openFolder],
  );
  const springHome = useCallback((result: JoinResult) => spring(joinHome(result)), [spring, joinHome]);
  const springDock = useCallback((result: JoinResult) => spring(joinDock(result)), [spring, joinDock]);
  // Apps go onto apps and folders, on the icon itself: the rest of the cell is for moving between.
  const policy = useCallback((e: Entry, x: number, y: number) => ({ kind: e.kind, accepts: ['app'], zone: { x, y, width: icon, height: icon } }), [icon]);
  const pagePolicy = useCallback((e: Entry) => policy(e, (cellW - icon) / 2, BADGE_ROOM), [policy, cellW, icon]);
  const dockPolicy = useCallback((e: Entry) => policy(e, (dockCell - icon) / 2, (DOCK_H - icon) / 2), [policy, dockCell, icon]);

  // What a press on an entry opens: a folder, or Safari. The other apps are only pictures.
  const opens = useCallback((e: Entry) => (e.kind === 'folder' ? () => openFolder(e.id) : e.id === SAFARI ? () => openSafari(e) : undefined), [openFolder, openSafari]);
  // Pressed on its square and name, and nowhere else in its cell.
  const pageRegions = useCallback(
    (e: Entry) => {
      const onPress = opens(e);
      return onPress ? [{ key: 'open', rect: { x: (cellW - icon) / 2, y: BADGE_ROOM, width: icon, height: icon + LABEL_GAP + LABEL_H }, onPress }] : [];
    },
    [cellW, icon, opens],
  );
  const dockRegions = useCallback(
    (e: Entry) => {
      const onPress = opens(e);
      return onPress ? [{ key: 'open', rect: { x: (dockCell - icon) / 2, y: (DOCK_H - icon) / 2, width: icon, height: icon }, onPress }] : [];
    },
    [dockCell, icon, opens],
  );

  // The square of a folder whose pane is out is moved out of sight, not faded: the pane has grown out of it.
  const out = useMemo(() => new Map(overlays.filter((o) => !o.gone).map((o) => [o.id, o.page])), [overlays]);
  // What opens also marks where its square is, to grow from. The marker stays when the square is moved away.
  const mark = useCallback(
    (e: Entry, top?: number) =>
      e.kind === 'folder' || e.id === SAFARI ? (
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
    (e: Entry, { joinTarget, dragging }: ItemRenderInfo) => (
      <View style={styles.pageCell}>
        {/* Not in a lifted copy, which may be drawn elsewhere: a folder is measured where it sits. */}
        {dragging ? null : mark(e, BADGE_ROOM)}
        <Icon entry={e} size={icon} away={out.has(e.id) || (safariUp && e.id === SAFARI)} page={out.get(e.id) ?? 0} highlighted={joinTarget} dragging={dragging} />
      </View>
    ),
    [mark, icon, out, safariUp],
  );
  const renderDocked = useCallback(
    (e: Entry, { joinTarget, dragging }: ItemRenderInfo) => (
      <View style={styles.dockCell}>
        {dragging ? null : mark(e)}
        <View style={{ width: icon }}>
          <Icon entry={e} size={icon} label={false} away={out.has(e.id) || (safariUp && e.id === SAFARI)} page={out.get(e.id) ?? 0} highlighted={joinTarget} />
        </View>
      </View>
    ),
    [mark, icon, out, safariUp],
  );

  return (
    // Around the grids and the folders: an app carried from one grid to another is drawn above them all.
    <ReflowDragProvider onDragEnd={dragEnded}>
      <View style={styles.root}>
        <Wallpaper />
        <View style={StyleSheet.absoluteFill} pointerEvents={open || (safari && !safari.closing) ? 'none' : 'auto'}>
          {/* The dock first, so an icon lifted from the pages passes over it. The glass is behind the dock's grid, not around it,
              so it can't clip an icon that's carried out. */}
          <View style={[styles.dock, { bottom: dockBottom, zIndex: front === 'dock' ? 1 : 0 }]}>
            <Glass style={[StyleSheet.absoluteFill, styles.dockGlass]} />
            <ReflowGrid
              // The whole of the glass, so an icon is in the dock wherever on it the finger is. The layout centres what's there.
              style={styles.dockGrid}
              axis="horizontal"
              // The dock stays put: its four fit, and a bounce would cut them off at the grid's edge, inside the rounded glass.
              scrollEnabled={false}
              data={dock}
              keyExtractor={(e) => e.id}
              layout={row}
              renderItem={renderDocked}
              settleDelay={0}
              touchRegions={dockRegions}
              onReorder={reorderDock}
              joinPolicy={dockPolicy}
              onJoin={joinDock}
              onSpringLoad={springDock}
              onDragStart={liftFromDock}
              onDragExit={toPages}
              dragExitDelay={CROSS_MS}
              continuesDrag={!open && (visiting ? 'join' : true)}
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
            joinPolicy={pagePolicy}
            onJoin={joinHome}
            onSpringLoad={springHome}
            onDragStart={liftFromPages}
            // An icon from the dock, or dragged out of a folder, is taken up here.
            continuesDrag={!open && !visiting}
            onDragExit={toDock}
            dragExitDelay={CROSS_MS}
            onScroll={onPagesScroll}
            dragOverflow="visible"
            reduceMotion={ReduceMotion.Never}
            pageIndicator={{ color: 'rgba(255,255,255,0.4)', activeColor: '#fff' }}
          />
        </View>
        {overlays.map((o) => {
          const folder = folderOf(o.id);
          return folder ? (
            <FolderOverlay key={o.id} folder={folder} frame={o.frame} closing={o.closing} ejected={o.ejected} gone={o.gone} onClose={close} onClosed={closed} onReorder={reorderFolder} onEject={eject} />
          ) : null;
        })}
        {safari ? <SafariWindow app={safari.app} frame={safari.frame} closing={safari.closing} gone={safari.gone} onHome={closeSafari} onClosed={safariClosed} /> : null}
      </View>
    </ReflowDragProvider>
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
