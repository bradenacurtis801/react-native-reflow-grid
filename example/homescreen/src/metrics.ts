import { createContext, useContext } from 'react';

/** Room above an icon in its cell, for the badge that overhangs it. */
export const BADGE_ROOM = 12;
export const LABEL_H = 16;
export const LABEL_GAP = 5;
/** A page's apps stay this far in from the screen's sides. */
export const SIDE = 14;
export const DOCK_H = 102;
export const DOCK_SIDE = 17;

/** Everything that depends on the size of the window. */
export interface Metrics {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** An app's cell in a page, and the icon in it. */
  cellW: number;
  rowH: number;
  icon: number;
  /** Where the pages start and how tall they are: the page dots sit at their foot. */
  gridTop: number;
  gridH: number;
  dockBottom: number;
}

/** The metrics for a window. The insets are a phone's or a tablet's, near enough for a demo (the real ones would come from the safe area). */
export function makeMetrics(width: number, height: number): Metrics {
  const tablet = Math.min(width, height) >= 600;
  const columns = tablet ? 6 : 4;
  const rows = tablet ? 5 : 6;
  const gridTop = (tablet ? 24 : 62) + 16;
  const dockBottom = tablet ? 20 : 18;
  const gridH = height - gridTop - dockBottom - DOCK_H - 6;
  const cellW = (width - SIDE * 2) / columns;
  // 34pt of the page's foot is left to the dots.
  const rowH = Math.min(tablet ? 130 : 100, (gridH - 34) / rows);
  const icon = Math.min(64, cellW - 20, rowH - BADGE_ROOM - LABEL_GAP - LABEL_H);
  return { width, height, columns, rows, cellW, rowH, icon, gridTop, gridH, dockBottom };
}

export const MetricsContext = createContext<Metrics>(makeMetrics(390, 844));
export const useMetrics = () => useContext(MetricsContext);
