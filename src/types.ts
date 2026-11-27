import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReduceMotion, SharedValue } from 'react-native-reanimated';
import type { DragResult, DragSession, JoinPolicy, JoinResult } from './drag/drag';
import type { HapticsOption } from './support/haptics';
import type { Rect, ReflowLayout, Size } from './layout';
import type { PageIndicatorOptions } from './scroll/pageIndicator';
import type { SwipeDirection } from './swipe/swipe';

export interface ItemInfo {
  index: number;
  size: Size;
  /** It's being dragged: its slot shows where it will land. */
  dragging: boolean;
  /** A dragged item is held on it, and a drop now would join them (see `onJoin`). */
  joinTarget: boolean;
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
  /**
   * What a cell shows while it waits to draw its item (see `settleDelay`): a patch of colour, the card's outline. Nothing
   * by default. It's called with the item the cell now has, and should be cheap.
   */
  renderPlaceholder?: (item: T, info: ItemRenderInfo) => ReactNode;
  /**
   * How long, in milliseconds, a cell that's been given another item must keep it before `renderItem` is called for it
   * (`renderPlaceholder` until then). In a fast scroll or a jump the cells are given other items again and again, faster
   * than anyone can see them, and drawing each one (an image asking to load, say) is what slows the scroll; a cell that
   * doesn't keep its item this long is never drawn. A cell is drawn at once the first time, and while it's lifted or
   * leaving. Default 150; 0 draws every item as soon as its cell has it.
   */
  settleDelay?: number;
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
   * The size the grid is going to be, if it's known ahead: it then draws its cells in its first render, instead of after
   * it has been laid out, which leaves it empty for a frame or more. For a grid that appears in an animation (an opening
   * folder). Its real size takes over once it's laid out. Read when the grid mounts.
   */
  initialSize?: Size;
  /**
   * Whether a finger can scroll the grid. `false` is for one whose items all fit and should stay put, as a dock's: no
   * scroll and no bounce. Dragging and presses work as before. @default true
   */
  scrollEnabled?: boolean;
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
  /**
   * How many cells are mounted, after each change of them. A cell that is shrinking away because its
   * item was removed isn't counted, so a removal changes it once, not once as the cell starts to leave and again as it ends.
   */
  onMounted?: (count: number) => void;
  /**
   * Called as the grid scrolls (and when something else moves it, such as a drag at the edge), with how far it has
   * scrolled from where it rests: `{ x: 0, y: 0 }` at the start, whatever the insets and platform. It runs on the JS thread
   * on each scroll event, so keep it cheap. To know what's on screen, run the layout on your own data
   * (`layout(data, size)`) and look up the items at that offset.
   */
  onScroll?: (offset: { x: number; y: number }) => void;
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
  /**
   * What each item is when it comes to joining: dropping one onto another to combine them, as apps into a folder. With
   * `onJoin` (and `onReorder`, which turns dragging on), an item held on one that accepts its `kind` makes it the
   * `joinTarget`, and a drop joins them instead of reordering. Outside its zone the others make room at once, and on
   * the side the dragged one comes from the item stays where it is, so it can still be moved onto. Called during a drag: keep it cheap.
   */
  joinPolicy?: (item: T, info: ItemInfo) => JoinPolicy | undefined;
  /**
   * A drop joined the dragged item to another: change `data` here, taking the dragged item out (it's seen to go into the
   * target) and updating the target. If the two become an item with a new key, return that key: it takes the target's place
   * with no animation of one leaving and another arriving. Return `false` to refuse, and the item goes back.
   */
  onJoin?: (result: JoinResult) => string | false | void;
  /**
   * A finger's drag has stayed on an item it could join (the `joinTarget`) for long enough to ask for it to be opened.
   * Open it, with the dragged item moved into it, and render a grid there with `continuesDrag`: the drag goes on in that
   * grid, and a drop places the item. Return `false` to open nothing; return the key of what's now in the target's place
   * if that changed. Needs a `ReflowDragProvider` around both grids.
   */
  onSpringLoad?: (result: JoinResult) => string | false | void;
  /**
   * A finger's drag has stayed outside the grid (`dragExitDelay`), as out of an open folder, or over another grid: `point`
   * is where the finger is, on screen. Move the dragged item to where it goes next; return `false` to keep the drag here. A grid with `continuesDrag` that has the item takes the drag
   * over. Keep this grid mounted (out of sight) until the provider's `onDragEnd`: the touch is still its. Needs a
   * `ReflowDragProvider`.
   */
  onDragExit?: (result: { session: DragSession; dragged: readonly string[]; point: { x: number; y: number } }) => false | void;
  /**
   * How long, in ms, a drag stays outside the grid before `onDragExit` is called. Short for neighbours that exchange items
   * (a dock and the pages above it), long enough elsewhere that a finger can stray out and back. @default 450
   */
  dragExitDelay?: number;
  /**
   * Takes over a drag that another grid of the provider has let go of (`onSpringLoad`), if the item is in this grid's
   * `data`. Set it once the grid is where it will stay (not while it's still growing into place). `'join'`: it also takes
   * over for an item it doesn't have, only to join it (`joinPolicy`, `onJoin`, `onSpringLoad`): nothing makes room, as on
   * a dock that's full. The item is then still in the grid it came from, for `onJoin` or `onSpringLoad` to move.
   * @default false
   */
  continuesDrag?: boolean | 'join';
  /**
   * Whether an item lifted by a finger may be drawn outside the grid. `'visible'`: from the lift until it has settled
   * after the drop, the grid doesn't clip what it draws, so the item can be carried anywhere (over a bar or another
   * view; give the grid a `zIndex` or render it after what the item should pass over). Cells just past the grid's
   * edges show then too, so it suits a grid whose edges are the screen's, or whose neighbours are out of sight.
   * @default 'hidden'
   */
  dragOverflow?: 'visible' | 'hidden';
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
