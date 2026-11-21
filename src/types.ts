import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReduceMotion, SharedValue } from 'react-native-reanimated';
import type { DragResult, DragSession } from './drag';
import type { HapticsOption } from './haptics';
import type { Rect, ReflowLayout, Size } from './layout';
import type { PageIndicatorOptions } from './pageIndicator';
import type { SwipeDirection } from './swipe';

export interface ItemInfo {
  index: number;
  size: Size;
  /** It's being dragged: its slot shows where it will land. */
  dragging: boolean;
}

/** What `renderItem` is given about an item. */
export interface ItemRenderInfo extends ItemInfo {
  /**
   * How far a swipe (`onSwipe`) has taken the item from its slot, in pt along the swipe: negative towards the
   * start (left, or up), positive towards the end (right, or down), and 0 at rest. A shared value, so what the
   * item shows can follow the finger on the UI thread, in an animated style: a tint that deepens as it's pulled,
   * a label that fades in. It's the same value for the item's whole life, however it's drawn.
   */
  swipe: SharedValue<number>;
}

/**
 * A pressable part of an item, in the item's own space (`rect`, from its
 * top-left). `onPress` runs when a finger that went down inside it lifts
 * again without having moved (`SLOP`) — so a scroll that starts there isn't a press.
 */
export interface TouchRegion {
  key: string;
  rect: Rect;
  onPress: () => void;
}

/** An item on screen, with where it goes and its touch regions: what a touch is hit against. */
export interface Slot {
  key: string;
  index: number;
  rect: Rect;
  regions: TouchRegion[];
}

/**
 * Where a lifted item follows the finger: the finger, and where it holds the item (`gx`, `gy`). The item's
 * place in the content is `x + sx + ox - gx` (and likewise `y`): the finger in the grid's own frame (`x`), the scroll offset (`sx`)
 * and what turns the two into the content's space (`ox`: the insets). The scroll offset is the UI thread's own, as it draws, so the
 * item can't be off by a frame of scroll against the finger, as it would be placed by the JS thread's.
 */
export interface Finger {
  x: SharedValue<number>;
  y: SharedValue<number>;
  gx: SharedValue<number>;
  gy: SharedValue<number>;
  sx: SharedValue<number>;
  sy: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
}

/** The props of `ReflowGrid`. */
export interface ReflowGridProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  /** One item's visuals: they fill the cell the layout gives it. */
  renderItem: (item: T, info: ItemRenderInfo) => ReactNode;
  /** One item's pressable parts (see `TouchRegion`). Memoize it with the rest. */
  touchRegions?: (item: T, info: ItemInfo) => TouchRegion[];
  /** Memoize it: a new function lays everything out again. */
  layout: ReflowLayout<T>;
  /**
   * The directions the grid scrolls. `'vertical'` and `'horizontal'` scroll
   * along one axis, and the layout's room is split across the other. `'both'`
   * scrolls on both, for a layout whose cards have a fixed width and height.
   * @default 'vertical'
   */
  axis?: 'vertical' | 'horizontal' | 'both';
  /**
   * Space the scrolled items must start and end clear of — the header over
   * the top (`startInset`), the tab bar under the bottom (`endInset`), along
   * the vertical axis (or the horizontal one, for a horizontal grid). The grid
   * is full-bleed: its content scrolls under the header, and rests below it.
   * iOS insets the scroll view; Android pads it. @default 0
   */
  startInset?: number;
  endInset?: number;
  /**
   * For a horizontal grid: space its rows must stay clear of at the top and
   * bottom (what is pinned over them). Unused on other axes. @default 0
   */
  crossStartInset?: number;
  crossEndInset?: number;
  /** How many cells are mounted, after each change of them. */
  onMounted?: (count: number) => void;
  /**
   * Turns on drag to reorder: on web with a mouse through the browser's drag and
   * drop, and with a finger anywhere by holding on an item to lift it. The others
   * make room as it's dragged. Called on a drop that changed the order,
   * with the new order of the keys — put `data` in that order. The grid shows
   * the new order meanwhile, so a `data` that follows a moment later doesn't flicker.
   */
  onReorder?: (result: DragResult) => void;
  /** Whether an item can be dragged. @default every item can */
  canDrag?: (item: T, index: number) => boolean;
  /** A drag has begun: called with what was lifted (see `DragSession`). (Haptic feedback is `haptics`.) */
  onDragStart?: (session: DragSession) => void;
  /**
   * Turns on swipe to remove. A finger that goes down on an item and moves across the scroll
   * (sideways in a vertical grid, up or down in a horizontal one) before it scrolls or lifts the item slides the item
   * with it. Let go far enough, or fast enough, and this is called with the item and the way it went: take it out of
   * `data` and it carries on that way and fades while the rest glide into its place. Return `false` to keep it, and it
   * springs back; so it does if it's still in `data` a moment later. Not for a grid that scrolls on both axes.
   */
  onSwipe?: (item: T, direction: SwipeDirection) => boolean | void;
  /** Whether an item can be swiped. @default every item can */
  canSwipe?: (item: T, index: number) => boolean;
  /**
   * The ways an item may be swiped: `'left'` and `'right'` in a vertical grid, `'up'` and `'down'` in a horizontal
   * one (others are ignored). An item can't be pulled a way that isn't listed: a finger that starts that way doesn't pick it up, and
   * one that turns back that way stops at the item's slot. Say which way in `onSwipe`'s second argument.
   * @default either way across the scroll
   */
  swipeDirections?: readonly SwipeDirection[];
  /**
   * Haptic feedback for the grid's moments: lifting an item, it moving to another
   * slot, a drop that changed the order, a page turning during a drag, and
   * scrubbing the page dots. `true` (the default): `expo-haptics`, if the app has it
   * installed, and nothing if not (or on web). `false`: none. A function gets each
   * `HapticEvent`, to give feedback with whatever you use. @default true
   */
  haptics?: HapticsOption;
  /**
   * Whether the animations follow the device's reduce-motion setting (they
   * jump to their end when it's on), page turns during a drag included.
   * `ReduceMotion.Never` always animates.
   * @default ReduceMotion.System
   */
  reduceMotion?: ReduceMotion;
  /**
   * For a paged layout (`pagedLayout`): dots, one for each page and lit for the
   * one on screen, shown where the scroll indicator along the pages would be,
   * in place of it. Options style them. `false` shows no dots and leaves the
   * scroll indicator. @default true
   */
  pageIndicator?: boolean | PageIndicatorOptions;
  style?: StyleProp<ViewStyle>;
}
