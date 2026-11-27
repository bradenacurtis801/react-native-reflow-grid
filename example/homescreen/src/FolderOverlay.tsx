import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, ReduceMotion, useAnimatedStyle, useSharedValue, useAnimatedProps, withTiming, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { pagedLayout, ReflowGrid, type DragResult, type ItemRenderInfo } from 'react-native-reflow-grid';
import { badgeOf, type AppItem, type FolderItem } from './apps';
import { Glass } from './Glass';
import { AppSquare, Badge, FOLDER_RADIUS, Icon, miniGrid, Name } from './Icon';
import { BADGE_ROOM, useMetrics } from './metrics';

/** Where a folder's icon is on the screen. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const Blur = Animated.createAnimatedComponent(BlurView);
/** How blurred (of 100) the home screen is behind an open folder. */
const BLUR = 55;

const GROW = { duration: 320, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never };
const PANEL_PAD = 14;
const PANEL_RADIUS = 40;
/** The pane's foot is left to the page dots. */
const DOTS_ROOM = 24;
const DOTS = { color: 'rgba(255,255,255,0.45)', activeColor: '#fff' };
const NO_DOTS = { color: 'transparent', activeColor: 'transparent', scrub: false };

/**
 * An app in the open folder. As the folder opens and closes, its square goes between a miniature's size and an icon's (the
 * pane's contents are scaled as a whole, `fromX` by `fromY` when closed, and this makes up the difference), and its name and
 * badge fade.
 */
function FolderApp({ app, p, size, mini, fromX, fromY }: { app: AppItem; p: SharedValue<number>; size: number; mini: number; fromX: number; fromY: number }) {
  const square = useAnimatedStyle(() => {
    const k = p.get();
    // How big it should look, over how big the contents' scale makes it.
    const side = mini + (size - mini) * k;
    return { transform: [{ scaleX: side / (size * (fromX + (1 - fromX) * k)) }, { scaleY: side / (size * (fromY + (1 - fromY) * k)) }] };
  });
  const extras = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0.5, 1], [0, 1], Extrapolation.CLAMP) }));
  return (
    <View style={styles.cell}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={square}>
          <AppSquare app={app} size={size} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, extras]}>
          <Badge count={app.badge ?? 0} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.name, extras]}>
        <Name>{app.name}</Name>
      </Animated.View>
    </View>
  );
}

/**
 * An open folder: its pane grows out of its icon to the middle of the screen, with its apps three across, in pages of nine.
 * Closed, the pane is exactly the icon (its place, size, corners and miniatures), so one takes over from the other unseen.
 */
export function FolderOverlay({
  folder,
  frame,
  closing,
  ejected,
  gone,
  onClose,
  onClosed,
  onReorder,
  onEject,
}: {
  folder: FolderItem;
  frame: Frame;
  closing: boolean;
  /** A drag has left the folder. */
  ejected: boolean;
  /** Closed, and kept mounted out of sight: the finger of a drag that began in here is still this grid's. */
  gone: boolean;
  onClose: (id: string, page: number) => void;
  onClosed: (id: string) => void;
  onReorder: (id: string, result: DragResult) => void;
  /** An app has been dragged out of the folder. `false`: it stays. */
  onEject: (id: string, appId: string, page: number) => false | void;
}) {
  const { id } = folder;
  const done = useCallback(() => onClosed(id), [id, onClosed]);
  const reorder = useCallback((result: DragResult) => onReorder(id, result), [id, onReorder]);
  const { width, height, icon } = useMetrics();
  const panelW = Math.min(width - 52, 360);
  const panelH = panelW * 1.08;
  const left = (width - panelW) / 2;
  const top = (height - panelH) / 2;
  const cellW = (panelW - PANEL_PAD * 2) / 3;
  const cellH = (panelH - PANEL_PAD - DOTS_ROOM) / 3;

  // Closed, the contents are scaled so the apps' centres are the miniatures': the pitch of one over the other's, and moved so
  // the first lands on the first.
  const { mini, gap, pad } = miniGrid(frame.w);
  const fromX = (mini + gap) / cellW;
  const fromY = (mini + gap) / cellH;
  const fromLeft = pad + mini / 2 - fromX * (PANEL_PAD + cellW / 2);
  const fromTop = pad + mini / 2 - fromY * (PANEL_PAD + BADGE_ROOM + icon / 2);

  // The page of apps on screen: the folder's icon shows that one as the pane gets home.
  const page = useRef(0);
  const onScroll = useCallback(({ x }: { x: number }) => (page.current = Math.max(Math.round(x / panelW), 0)), [panelW]);

  // 0: the folder's icon. 1: open.
  const p = useSharedValue(0);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (closing) setOpened(false);
    const go = () =>
      p.set(
        withTiming(closing ? 0 : 1, GROW, (finished) => {
          if (finished) {
            if (closing) runOnJS(done)();
            else runOnJS(setOpened)(true);
          }
        }),
      );
    if (closing) {
      go();
      return;
    }
    // Opening waits two frames, for the apps' views to be made: started at once, the first part of the growth goes by while
    // they are, and the pane appears already half grown. Meanwhile it looks just as the icon did.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(go)));
    return () => cancelAnimationFrame(frame);
  }, [closing, p, done]);

  // The blur deepens by its intensity, not by fading the view: a blur that's partly transparent isn't drawn as one.
  const blur = useAnimatedProps(() => ({ intensity: BLUR * p.get() }));
  const fade = useAnimatedStyle(() => ({ opacity: p.get() }));
  // The pane's own place, size and corners, not a scale of them: a scaled corner would shrink with it and come out square.
  // It's never faded: it's glass.
  const pane = useAnimatedStyle(() => {
    const k = p.get();
    return {
      left: frame.x + (left - frame.x) * k,
      top: frame.y + (top - frame.y) * k,
      width: frame.w + (panelW - frame.w) * k,
      height: frame.h + (panelH - frame.h) * k,
      borderRadius: frame.w * FOLDER_RADIUS + (PANEL_RADIUS - frame.w * FOLDER_RADIUS) * k,
    };
  });
  // The contents lie over the pane, not in it (a pane would clip an app carried out), so they're moved with it.
  const contents = useAnimatedStyle(() => {
    const k = p.get();
    return {
      transform: [
        { translateX: frame.x + (left - frame.x) * k + fromLeft * (1 - k) },
        { translateY: frame.y + (top - frame.y) * k + fromTop * (1 - k) },
        { scaleX: fromX + (1 - fromX) * k },
        { scaleY: fromY + (1 - fromY) * k },
      ],
    };
  });
  // The folder's own badge is back as the pane gets home.
  const badge = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0, 0.25], [1, 0], Extrapolation.CLAMP) }));

  const layout = useMemo(() => pagedLayout({ direction: 'horizontal', columns: 3, rows: 3, pageGap: PANEL_PAD * 2, card: { width: cellW, height: cellH } }), [cellW, cellH]);
  // A lifted app is a plain icon: it may be drawn out of the folder, and mustn't shrink with the folder as it closes.
  const renderItem = useCallback(
    (app: AppItem, { dragging }: ItemRenderInfo) =>
      dragging ? (
        <View style={styles.cell}>
          <Icon entry={app} size={icon} dragging />
        </View>
      ) : (
        <FolderApp app={app} p={p} size={icon} mini={mini} fromX={fromX} fromY={fromY} />
      ),
    [p, icon, mini, fromX, fromY],
  );

  return (
    <View style={[StyleSheet.absoluteFill, gone && styles.gone]} pointerEvents={closing ? 'none' : 'auto'}>
      <Blur tint="dark" animatedProps={blur} style={StyleSheet.absoluteFill} />
      <Pressable accessibilityLabel="Close folder" onPress={() => onClose(id, page.current)} style={StyleSheet.absoluteFill} />
      <Animated.Text style={[styles.title, { top: top - 58 }, fade]} numberOfLines={1}>
        {folder.name}
      </Animated.Text>
      <Glass style={[styles.pane, pane]} />
      <Animated.View style={[styles.contents, { width: panelW, height: panelH }, contents]}>
        <ReflowGrid
          style={styles.apps}
          // Known ahead, so the apps are there from the pane's first frame.
          initialSize={{ width: panelW, height: panelH - PANEL_PAD }}
          onScroll={onScroll}
          axis="horizontal"
          data={folder.apps}
          keyExtractor={(app) => app.id}
          layout={layout}
          renderItem={renderItem}
          settleDelay={0}
          onReorder={reorder}
          // Held outside, an app leaves the folder.
          onDragExit={({ dragged }) => onEject(id, dragged[0]!, page.current)}
          // A drag that opened the folder goes on in here, once the folder has finished growing.
          continuesDrag={opened && !ejected}
          dragOverflow="visible"
          reduceMotion={ReduceMotion.Never}
          // The dots are only there once it's open.
          pageIndicator={opened ? DOTS : NO_DOTS}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h }, badge]}>
        <Badge count={badgeOf(folder)} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { position: 'absolute', left: 24, right: 24, textAlign: 'center', color: '#fff', fontSize: 32, fontWeight: '500' },
  pane: { position: 'absolute' },
  // Moved away, not hidden or unmounted: a touch that began in it goes on.
  gone: { transform: [{ translateX: -10000 }] },
  // Laid out at the open size whatever the pane's, and scaled from its top left to fit.
  contents: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  apps: { flex: 1, marginTop: PANEL_PAD },
  cell: { flex: 1, alignItems: 'center', paddingTop: BADGE_ROOM },
  name: { alignSelf: 'stretch', alignItems: 'center' },
});
