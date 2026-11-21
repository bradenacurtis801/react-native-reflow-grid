import { createContext, useContext } from 'react';
import { Platform, PlatformColor, type ColorValue } from 'react-native';

/** The colour of what's drawn in a glass bar: on iOS the system's label colour, which follows the glass as it turns light or dark over what's behind it. */
export const INK: ColorValue = Platform.OS === 'ios' ? PlatformColor('label') : '#ffffff';
/** The same, dimmer. */
export const INK_DIM: ColorValue = Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : 'rgba(255,255,255,0.6)';

export const SIDE = 14;
export const GAP = 14;
export const CARD_RADIUS = 20;
/** The title under a preview. */
export const TITLE_H = 34;

/** The glass bars: a pill along the top, a bar along the bottom. */
export const PILL_H = 46;
export const BAR_H = 58;
export const BAR_SIDE = 16;

/** Everything that depends on the size of the window, which changes when an iPad turns or is split. */
export interface Metrics {
  /** The window, and what a page is laid out at before it's scaled to a card. */
  width: number;
  height: number;
  /** Room the status bar (and a phone's Dynamic Island) takes at the top, and the home indicator at the bottom. */
  top: number;
  bottom: number;
  /** The screen's own corner radius: a page that fills the screen is rounded like it. */
  screenRadius: number;
  /** Cards across, and a card's width and the height of its preview of the page. */
  columns: number;
  cardW: number;
  cardH: number;
  pillTop: number;
  barBottom: number;
  /** What the grid leaves clear above and below, for the bars. */
  gridTop: number;
  gridBottom: number;
}

/** The metrics for a window. The insets are a phone's or a tablet's, near enough for a demo (the real ones would come from the safe area). */
export function makeMetrics(width: number, height: number): Metrics {
  const tablet = Math.min(width, height) >= 600;
  const top = tablet ? 24 : 59;
  const bottom = tablet ? 20 : 34;
  const columns = width >= 1000 ? 4 : width >= 600 ? 3 : 2;
  const cardW = (width - SIDE * 2 - GAP * (columns - 1)) / columns;
  const pillTop = top + 4;
  const barBottom = bottom - 6;
  return {
    width,
    height,
    top,
    bottom,
    screenRadius: tablet ? 20 : 55,
    columns,
    cardW,
    cardH: cardW * 1.32,
    pillTop,
    barBottom,
    gridTop: pillTop + PILL_H + 12,
    gridBottom: barBottom + BAR_H + 12,
  };
}

export const MetricsContext = createContext<Metrics>(makeMetrics(390, 844));
export const useMetrics = () => useContext(MetricsContext);
