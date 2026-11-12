"use client";

// The 1s /api/stats poll behind the telemetry cards. It keeps the last
// sample on transient failure, skips ticks while the tab is hidden, and
// feeds a shared graph store: one per-second value ring per key, anchored
// at the history start. Ported from static/js/telemetry/poll.js plus the
// feed()/ensureHistory() halves of static/js/telemetry/graphs.js.

import { useEffect, useRef, useState, type RefObject } from "react";
import { telemetryApi, type Stats } from "@/lib/api";

export const GRAPH_WINDOW = 3600; // seconds shown per graph
const GIB = 1073741824;
const POLL_MS = 1000;

export type GraphKey = "cpu" | "mem" | "pwr";

export interface GraphSeries {
  start: number | null; // unix seconds that vals[0] covers
  vals: (number | null)[]; // one slot per second; null marks a gap
}

export interface GraphStore {
  seeded: boolean; // history has loaded into the rings
  seeding: boolean; // a history fetch is in flight
  memTotalGb: number | null; // live y-max for the memory graph
  series: Record<GraphKey, GraphSeries>;
}

function makeStore(): GraphStore {
  return {
    seeded: false,
    seeding: false,
    memTotalGb: null,
    series: {
      cpu: { start: null, vals: [] },
      mem: { start: null, vals: [] },
      pwr: { start: null, vals: [] },
    },
  };
}

// Append one sample at tsSec (null = gap). The ring stays anchored at
// `start`; once it passes the 1h window the head is dropped and start
// advances, so an index held by the hover tooltip keeps its sample.
export function feed(series: GraphSeries, tsSec: number, val: number | null): void {
  if (series.start == null || !Number.isFinite(tsSec)) return;
  const idx = tsSec - series.start;
  if (idx < 0) return;
  while (series.vals.length <= idx) series.vals.push(null);
  series.vals[idx] = val == null || !Number.isFinite(val) ? null : val;
  if (series.vals.length > GRAPH_WINDOW + 1) {
    const drop = series.vals.length - (GRAPH_WINDOW + 1);
    series.vals.splice(0, drop);
    series.start += drop;
  }
}

// Seed every ring from /api/stats/history, on the first card expansion.
// Memory comes back in bytes and turns into GB here, matching the live
// samples. On failure the store stays unseeded and the next expand retries.
export async function seedHistory(store: GraphStore): Promise<void> {
  if (store.seeded || store.seeding) return;
  store.seeding = true;
  try {
    const h = await telemetryApi.history(GRAPH_WINDOW);
    store.series.cpu = { start: h.start, vals: h.cpu.slice(0, GRAPH_WINDOW + 1) };
    store.series.mem = {
      start: h.start,
      vals: h.mem_used.slice(0, GRAPH_WINDOW + 1).map((v) => (v == null ? null : v / GIB)),
    };
    store.series.pwr = { start: h.start, vals: h.pwr.slice(0, GRAPH_WINDOW + 1) };
    if (h.mem_total != null) store.memTotalGb = h.mem_total / GIB;
    store.seeded = true;
  } catch {
    // leave unseeded; the next expansion retries
  }
  store.seeding = false;
}

export interface StatsPoll {
  stats: Stats | null; // last good sample
  tick: number; // increments once per successful sample
  graphs: RefObject<GraphStore>; // shared ring buffers, read by the canvases
}

export function useStatsPoll(): StatsPoll {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tick, setTick] = useState(0);
  const graphs = useRef<GraphStore>(makeStore());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (document.hidden) return; // skip ticks while the tab is backgrounded
      try {
        const s = await telemetryApi.stats();
        if (cancelled) return;
        const tsSec = Math.floor(new Date(s.t).getTime() / 1000);
        const store = graphs.current;
        if (s.cpu) feed(store.series.cpu, tsSec, s.cpu.util_percent);
        if (s.mem) {
          store.memTotalGb = s.mem.total_bytes / GIB;
          feed(store.series.mem, tsSec, s.mem.used_bytes / GIB);
        }
        if (s.power) feed(store.series.pwr, tsSec, s.power.total_w);
        setStats(s);
        setTick((t) => t + 1);
      } catch {
        // keep last values on transient failure; the next tick retries
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { stats, tick, graphs };
}
