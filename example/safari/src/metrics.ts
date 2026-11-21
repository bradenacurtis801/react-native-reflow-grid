import { Dimensions, Platform, PlatformColor, type ColorValue } from 'react-native';

/** The colour of what's drawn in a glass bar: on iOS the system's label colour, which follows the glass as it turns light or dark over what's behind it. */
export const INK: ColorValue = Platform.OS === 'ios' ? PlatformColor('label') : '#ffffff';
/** The same, dimmer. */
export const INK_DIM: ColorValue = Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : 'rgba(255,255,255,0.6)';

export const { width: SW, height: SH } = Dimensions.get('window');

/** Room the status bar and the Dynamic Island take, and the home indicator (a phone's, near enough for a demo). */
export const TOP_INSET = 59;
export const BOTTOM_INSET = 34;
/** The screen's own corner radius: a page that fills the screen is rounded like it. */
export const SCREEN_RADIUS = 55;

export const SIDE = 14;
export const GAP = 14;
export const CARD_RADIUS = 20;
/** A card's width (two across), and the height of its preview of the page. */
export const CARD_W = (SW - SIDE * 2 - GAP) / 2;
export const CARD_H = CARD_W * 1.32;
/** The title under a preview. */
export const TITLE_H = 34;

/** The glass bars: a pill along the top, a bar along the bottom. */
export const PILL_TOP = TOP_INSET + 4;
export const PILL_H = 46;
export const BAR_H = 58;
export const BAR_BOTTOM = BOTTOM_INSET - 6;
export const BAR_SIDE = 16;

/** What the grid leaves clear above and below, for the bars. */
export const GRID_TOP = PILL_TOP + PILL_H + 12;
export const GRID_BOTTOM = BAR_BOTTOM + BAR_H + 12;
