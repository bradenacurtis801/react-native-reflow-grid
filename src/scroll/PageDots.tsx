import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  dotLook,
  DOTS_HIT,
  edgeMargin,
  INACTIVE_SCALE,
  readableOn,
  SCRUB_TRACK,
  scrubStep,
  slideStart,
  TAP_SLOP,
  tapPage,
  type PageIndicatorOptions,
} from './pageIndicator';

/** The page label's height, to centre it beside a column of dots. */
const LABEL_HEIGHT = 24;
/** Space (pt) between the label and the dots. */
const LABEL_GAP = 6;
/** The label's padding each side (pt), and how wide one character of its text is (pt). */
const LABEL_PAD = 10;
const LABEL_CHAR = 8;
/** Marks the dots' element on web, so the grid's own drag and drop can leave a drag that began on them alone. */
export const SCRUB_ATTRIBUTE = 'data-reflow-scrub';

function Dot({
  page,
  progress,
  start,
  shown,
  count,
  size,
  pitch,
  horizontal,
  color,
  activeColor,
}: {
  page: number;
  progress: SharedValue<number>;
  start: SharedValue<number>;
  shown: number;
  count: number;
  size: number;
  /** A dot's slot along the row: its size and the space after it. */
  pitch: number;
  horizontal: boolean;
  color: string;
  activeColor: string;
}) {
  // Where the dot is, how big, and how lit follow the scroll, frame by frame, on the UI thread.
  const style = useAnimatedStyle(() => {
    const look = dotLook(page, progress.get(), start.get(), shown, count);
    const along = look.x * pitch + (pitch - size) / 2;
    return {
      opacity: look.alpha,
      transform: [
        horizontal ? { translateX: along } : { translateY: along },
        { scale: look.scale * (INACTIVE_SCALE + (1 - INACTIVE_SCALE) * look.lit) },
      ],
    };
  });
  const lit = useAnimatedStyle(() => ({ opacity: dotLook(page, progress.get(), start.get(), shown, count).lit }));
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Animated.View style={[styles.dot, round, { backgroundColor: color }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: activeColor }, lit]} />
    </Animated.View>
  );
}

/**
 * A row (or, for pages one under another, a column) of dots, one for each
 * page, lit for the one on screen: a page control. It follows the swipe: the dot
 * of the page you are leaving shrinks and dims as the next one grows and
 * brightens. With more pages than dots, the row slides along when the page on
 * screen reaches its end. Dragged along, it scrubs through the pages (`onScrub`);
 * touched without dragging, it goes to the page of the dot touched (`onJump`).
 *
 * `progress` is where the scroll is, in pages (fractional while swiping);
 * `current` is the page it is nearest, which only says which dots to draw.
 */
export function PageDots({
  count,
  current,
  progress,
  horizontal,
  options,
  track,
  onScrub,
  onJump,
}: {
  count: number;
  current: number;
  progress: SharedValue<number>;
  /** The pages go side by side: the dots run along a row. */
  horizontal: boolean;
  options: PageIndicatorOptions;
  /** How far (pt) a coarse drag along the dots goes across: the screen's length along them. */
  track: number;
  /** A drag along the dots has reached a page. */
  onScrub: (page: number) => void;
  /** A dot has been tapped. */
  onJump: (page: number) => void;
}) {
  const dark = useColorScheme() === 'dark';
  const { size = 8, spacing = 8, maxDots = 7, scrub = true } = options;
  const shown = Math.max(Math.min(count, Math.floor(maxDots)), 1);
  const margin = edgeMargin(shown);
  const pitch = size + spacing;
  const color = options.color ?? (dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)');
  const activeColor = options.activeColor ?? (dark ? '#fff' : '#000');

  // Where the row starts: a row of `shown` dots centred on the page it opens on. From then on it stays put while the page on
  // screen is inside it, and is carried along, in step with the swipe, when the page reaches an end.
  const first = useMemo(() => Math.min(Math.max(current - Math.floor(shown / 2), 0), Math.max(count - shown, 0)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = useSharedValue(first);
  useAnimatedReaction(
    () => progress.get(),
    (p) => {
      start.set(slideStart(start.get(), Math.min(Math.max(p, 0), Math.max(count - 1, 0)), shown, count, margin));
    },
    [count, shown, margin],
  );

  // Scrubbing: a drag along the dots, from the page on screen when it began. It's relative to where it began, as a scroll
  // bar's thumb is, so touching the dots goes nowhere; and it goes by how fast the finger moves (see `scrubGain`): slow,
  // a page for every dot's width, fast, far. A touch that doesn't drag is a tap: the page of the dot under it.
  const [scrubbing, setScrubbing] = useState<number>();
  const live = useRef({ count, pitch, horizontal, track, onScrub, onJump });
  live.current = { count, pitch, horizontal, track, onScrub, onJump };
  const drag = useRef({ position: 0, page: 0, from: 0, along: 0, lastDistance: 0, lastTime: 0, scrubbing: false });
  const pan = useMemo(() => {
    const end = () => setScrubbing(undefined);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Nothing else (a scroll view, say) is to take the drag from it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const l = live.current;
        const from = Math.min(Math.max(Math.round(progress.get()), 0), Math.max(l.count - 1, 0));
        const at = event.nativeEvent;
        // Where along the dots it touched: from the start of the row, inside the touch area's padding.
        drag.current = {
          position: from,
          page: from,
          from,
          along: (l.horizontal ? at.locationX : at.locationY) - DOTS_HIT,
          lastDistance: 0,
          lastTime: performance.now(),
          scrubbing: false,
        };
      },
      onPanResponderMove: (_, gesture) => {
        const l = live.current;
        const d = drag.current;
        const distance = l.horizontal ? gesture.dx : gesture.dy;
        if (!d.scrubbing) {
          // It's a tap until it has moved some way.
          if (Math.abs(distance) < TAP_SLOP) return;
          d.scrubbing = true;
          d.lastDistance = distance;
          d.lastTime = performance.now();
          setScrubbing(d.page);
          return;
        }
        const now = performance.now();
        d.position = scrubStep(d.position, distance - d.lastDistance, now - d.lastTime, l.count, l.pitch, Math.min(l.track, SCRUB_TRACK));
        d.lastDistance = distance;
        d.lastTime = now;
        const page = Math.round(d.position);
        if (page === d.page) return;
        d.page = page;
        setScrubbing(page);
        l.onScrub(page);
      },
      onPanResponderRelease: () => {
        const l = live.current;
        const d = drag.current;
        if (!d.scrubbing) l.onJump(tapPage(d.along, start.get(), l.count, l.pitch));
        end();
      },
      onPanResponderTerminate: end,
    });
  }, [progress, start]);
  const node = useRef<View>(null);
  useEffect(() => {
    // On web a drag that begins on the dots must not be the browser's drag of the grid beneath: say where they are.
    const el = Platform.OS === 'web' ? (node.current as unknown as HTMLElement | null) : null;
    if (!el) return;
    el.setAttribute(SCRUB_ATTRIBUTE, '');
    return () => el.removeAttribute(SCRUB_ATTRIBUTE);
  }, []);

  // One page has nothing to tell apart from.
  if (count < 2) return null;
  // The dots that can be in the row while it slides: those of the pages near the one on screen.
  const pages: number[] = [];
  for (let page = Math.max(current - shown, 0); page <= Math.min(current + shown, count - 1); page++) pages.push(page);
  const along = shown * pitch;
  const hit = scrub ? DOTS_HIT : 0;
  // Text that can be read on the pill: judged from the pill's own colour, not from the system's light or dark setting.
  const labelColor = readableOn(activeColor) ?? (dark ? '#000' : '#fff');
  // The label is placed against the dots, which are far narrower than it: left to fit itself into what is
  // left of them it would wrap and clip its text, so it is given the width its text needs.
  const labelText = scrubbing === undefined ? '' : `${scrubbing + 1} / ${count}`;
  const labelWidth = labelText.length * LABEL_CHAR + 2 * LABEL_PAD;
  return (
    <View
      ref={node}
      // What the dots are drawn on is bigger than they are, to be found by a fingertip; and what touches it doesn't reach the grid under it.
      style={{ padding: hit }}
      pointerEvents={scrub ? 'auto' : 'none'}
      {...(scrub ? pan.panHandlers : null)}
      onTouchStart={scrub ? (e) => e.stopPropagation() : undefined}
      {...(scrub && Platform.OS === 'web' ? ({ onClick: (e: { stopPropagation(): void }) => e.stopPropagation() } as object) : null)}
    >
      <View pointerEvents="none" style={[horizontal ? { width: along, height: size } : { width: size, height: along }, styles.row]}>
        {pages.map((page) => (
          <Dot
            key={page}
            page={page}
            progress={progress}
            start={start}
            shown={shown}
            count={count}
            size={size}
            pitch={pitch}
            horizontal={horizontal}
            color={color}
            activeColor={activeColor}
          />
        ))}
      </View>
      {scrubbing !== undefined && (
        <View
          pointerEvents="none"
          style={[
            styles.label,
            horizontal
              ? { bottom: hit + size + LABEL_GAP, alignSelf: 'center' }
              : { right: hit + size + LABEL_GAP, top: hit + along / 2 - LABEL_HEIGHT / 2 },
            { width: labelWidth, backgroundColor: activeColor },
          ]}
        >
          <Text numberOfLines={1} style={[styles.labelText, { color: labelColor }]}>
            {labelText}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Dots slide in and out of its ends, and are cut off there. */
  row: { overflow: 'hidden' },
  dot: { position: 'absolute', left: 0, top: 0 },
  label: { position: 'absolute', height: LABEL_HEIGHT, justifyContent: 'center', alignItems: 'center', borderRadius: LABEL_HEIGHT / 2, zIndex: 1, elevation: 4 },
  labelText: { fontSize: 12, fontWeight: '700' },
});
