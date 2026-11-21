/** Timing logs for tracking down a hitch: off unless the app sets `globalThis.__REFLOW_PERF__ = true`. */
export const perfOn = (): boolean => (globalThis as { __REFLOW_PERF__?: boolean }).__REFLOW_PERF__ === true;

export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function perfLog(message: string): void {
  if (perfOn()) console.log(`[reflow] ${message}`);
}
