import { useEffect, useMemo, useRef } from 'react';
import type { ImageErrorEventData, ImageLoadEventData } from 'expo-image';

/**
 * Why a photo is still a patch of colour: what became of each one's download, in the Metro output.
 *
 * Each photo goes requested (its cell was given it) → started (the native image view began loading it) →
 * loaded, or failed; or it's cancelled (its cell was reused before it loaded), or never started (it was
 * replaced while still queued). Slow loads (over 500ms) and failures are logged one by one; the rest are just
 * counted. Once a second, while anything is happening, there's a summary. On only when the app sets
 * `globalThis.__REFLOW_PERF__`.
 */
const on = () => (globalThis as { __REFLOW_PERF__?: boolean }).__REFLOW_PERF__ === true;

const SLOW_MS = 500;

const tally = {
  requested: 0,
  loaded: 0,
  failed: 0,
  /** Started loading, and then its cell was reused. */
  cancelled: 0,
  /** Replaced while still queued, before the image view began it. */
  neverStarted: 0,
  network: 0,
  disk: 0,
  memory: 0,
  inFlight: 0,
  /** Photos asked for that haven't arrived. */
  waiting: 0,
  totalMs: 0,
  slowestMs: 0,
};

const line = (message: string) => console.log(`[photo] ${message}`);

/** A line of the photo log, when logging is on. */
export function logPhoto(message: string) {
  if (on()) line(message);
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastSummary = '';
let lastRequested = 0;
function ensureSummary() {
  if (timer) return;
  timer = setInterval(() => {
    const t = tally;
    const average = t.loaded > 0 ? Math.round(t.totalMs / t.loaded) : 0;
    const asked = t.requested - lastRequested;
    lastRequested = t.requested;
    const text =
      `summary: sources assigned ${t.requested} (+${asked} this second) · loaded ${t.loaded} (network ${t.network}, disk ${t.disk}, memory ${t.memory}) · failed ${t.failed} · ` +
      `cancelled ${t.cancelled} · never started ${t.neverStarted} · in flight ${t.inFlight} · ` +
      `waiting ${t.waiting} · average ${average}ms · slowest ${Math.round(t.slowestMs)}ms`;
    if (text !== lastSummary) {
      lastSummary = text;
      line(text);
    }
  }, 1000);
}

/** The events to give an `<Image>`, and the log of what the photo's cell asks of it. Does nothing when logging is off. */
export function usePhotoLog(seed: number, uri: string) {
  const phase = useRef<'idle' | 'requested' | 'loading' | 'done'>('idle');
  const requestedAt = useRef(0);

  useEffect(() => {
    if (!on()) return;
    ensureSummary();
    phase.current = 'requested';
    requestedAt.current = performance.now();
    tally.requested += 1;
    tally.waiting += 1;
    return () => {
      const was = phase.current;
      phase.current = 'idle';
      if (was === 'requested') {
        tally.neverStarted += 1;
        tally.waiting -= 1;
      } else if (was === 'loading') {
        tally.cancelled += 1;
        tally.inFlight -= 1;
        tally.waiting -= 1;
      }
    };
  }, [seed, uri]);

  return useMemo(() => {
    if (!on()) return {};
    return {
      onLoadStart: () => {
        if (phase.current !== 'requested') return;
        phase.current = 'loading';
        tally.inFlight += 1;
      },
      onLoad: (e: ImageLoadEventData) => {
        const was = phase.current;
        if (was !== 'requested' && was !== 'loading') return;
        phase.current = 'done';
        if (was === 'loading') tally.inFlight -= 1;
        tally.waiting -= 1;
        const ms = performance.now() - requestedAt.current;
        tally.loaded += 1;
        tally.totalMs += ms;
        tally.slowestMs = Math.max(tally.slowestMs, ms);
        const from = e.cacheType === 'memory' ? 'memory' : e.cacheType === 'disk' ? 'disk' : 'network';
        tally[from] += 1;
        if (ms > SLOW_MS) line(`${seed} loaded ${Math.round(ms)}ms after it was requested (${from})`);
      },
      onError: (e: ImageErrorEventData) => {
        const was = phase.current;
        if (was !== 'requested' && was !== 'loading') return;
        phase.current = 'done';
        if (was === 'loading') tally.inFlight -= 1;
        tally.waiting -= 1;
        tally.failed += 1;
        line(`${seed} FAILED after ${Math.round(performance.now() - requestedAt.current)}ms: ${e.error}`);
      },
    };
  }, [seed]);
}
