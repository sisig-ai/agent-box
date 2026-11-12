"use client";

// The three live telemetry cards: CPU (util + temp), memory (with the
// process table), and power (with the alerts log). Ported from
// static/js/telemetry/{poll,graphs,procs,alerts}.js; the canvas renderer
// moved from graphs.js into a plain drawGraph() that takes a series plus
// options, since React already owns the change-gated DOM writes.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { telemetryApi, type Proc, type ProcsResponse } from "@/lib/api";
import { fmtBytesCompact, fmtW } from "@/lib/format";
import { useModal } from "@/components/modal-provider";
import {
  feed,
  seedHistory,
  type GraphKey,
  type GraphSeries,
  type GraphStore,
  type StatsPoll,
} from "@/hooks/use-stats-poll";
import "./telemetry.css";

/* ---------- canvas renderer ---------- */

const GUT = 38; // left gutter for tick labels
const PR = 6; // right padding
const PT = 10; // top padding
const PB = 6; // bottom padding
const TICK_FONT = '9px "FiraCode Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const DEFAULT_ACCENT = "#72a7ff";
const GIB = 1073741824;

export interface GraphOpts {
  accent: string;
  ymin: number;
  ymax: number | null; // live y-max (memory = total GB)
  autoMax?: boolean; // power: ymax = hi * 1.2
  minSpan?: number; // power: keep the scale from collapsing
  fmt?: (v: number) => string; // tooltip value text
  tickFmt?: (v: number) => string; // y-axis tick text
  fixedTicks?: number[]; // cpu: [0, 25, 50, 75, 100]
}

function hexToRgba(hex: string, a: number): string {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return `rgba(114,167,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fmtClockSec(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function tipText(series: GraphSeries, idx: number, fmt?: (v: number) => string): string {
  const v = series.vals[idx];
  const ts = (series.start ?? 0) + idx;
  const ago = Math.max(0, Math.round(Date.now() / 1000) - ts);
  const agoTxt = ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  if (v == null || !Number.isFinite(v)) return `${fmtClockSec(ts)} · no data`;
  const text = fmt ? fmt(v) : v.toFixed(2);
  return `${fmtClockSec(ts)} · ${text} (${agoTxt})`;
}

export function drawGraph(
  canvas: HTMLCanvasElement,
  series: GraphSeries,
  opts: GraphOpts,
  hover: number,
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const vals = series.vals;
  const n = vals.length;
  let lo = Infinity;
  let hi = -Infinity;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v != null && Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      last = i;
    }
  }
  if (!Number.isFinite(lo)) return; // no data yet — leave blank

  let ymin = opts.ymin;
  let ymax = opts.ymax != null ? opts.ymax : hi;
  if (opts.autoMax) ymax = Math.max(hi * 1.2, opts.minSpan ?? 1);
  const span = Math.max(ymax - ymin, opts.minSpan ?? 1e-6);
  if (ymax - ymin < span) {
    const m = (ymin + ymax) / 2;
    ymin = m - span / 2;
    ymax = m + span / 2;
  }

  const X = (i: number) => (n < 2 ? GUT + (w - GUT - PR) / 2 : GUT + (i / (n - 1)) * (w - GUT - PR));
  const Y = (v: number) => h - PB - ((v - ymin) / (ymax - ymin)) * (h - PT - PB);

  // y-axis scale on the far left: gridlines + tick labels
  const ticks = opts.fixedTicks ?? [ymin, ymin + span / 3, ymin + (2 * span) / 3, ymax];
  ctx.font = TICK_FONT;
  ctx.textBaseline = "middle";
  for (const t of ticks) {
    const y = Y(Math.min(Math.max(t, ymin), ymax));
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GUT, y);
    ctx.lineTo(w - 2, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(144,152,184,0.95)";
    ctx.textAlign = "left";
    ctx.fillText(opts.tickFmt ? opts.tickFmt(t) : String(Math.round(t)), 2, Math.min(Math.max(y, 6), h - 6));
  }

  const accent = opts.accent;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(accent, 0.3));
  grad.addColorStop(1, hexToRgba(accent, 0));

  // contiguous non-null runs (gaps stay broken)
  const runs: number[][] = [];
  let run: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v != null && Number.isFinite(v)) {
      if (!run) {
        run = [];
        runs.push(run);
      }
      run.push(i);
    } else {
      run = null;
    }
  }

  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const r of runs) {
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(X(r[0]), h - PB);
    for (const i of r) ctx.lineTo(X(i), Y(vals[i]!));
    ctx.lineTo(X(r[r.length - 1]), h - PB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = accent;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(X(r[0]), Y(vals[r[0]]!));
    for (let k = 1; k < r.length; k++) ctx.lineTo(X(r[k]), Y(vals[r[k]]!));
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // hover crosshair (cursor readout)
  if (hover >= 0 && hover < n && vals[hover] != null && Number.isFinite(vals[hover]!)) {
    const hx = X(hover);
    const hy = Y(vals[hover]!);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, PT - 4);
    ctx.lineTo(hx, h - PB);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // live dot on the newest point
  if (last >= 0) {
    ctx.beginPath();
    ctx.arc(X(last), Y(vals[last]!), 2.8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/* ---------- one expandable graph canvas ---------- */

interface GraphCanvasProps {
  store: RefObject<GraphStore>;
  seriesKey: GraphKey;
  tick: number; // redraw on every stats sample
  accent: string;
  opts: Omit<GraphOpts, "accent">;
}

// A canvas plus its hover tooltip. It draws only while mounted (the parent
// unmounts it when the card collapses), so React state drives the redraws.
// Series and opts live in refs so the resize listener subscribes once and
// every draw reads the live ring.
function GraphCanvas({ store, seriesKey, tick, accent, opts }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(-1);
  const hoverRef = useRef(-1);
  hoverRef.current = hover;

  const seriesRef = useRef<GraphSeries>(store.current.series[seriesKey]);
  seriesRef.current = store.current.series[seriesKey];
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const accentRef = useRef(accent);
  accentRef.current = accent;
  const lastStartRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawGraph(canvas, seriesRef.current, { ...optsRef.current, accent: accentRef.current }, hoverRef.current);
  }, []);

  // redraw on every poll tick; when the ring trims its head, shift a held
  // hover index with it so the crosshair keeps its sample
  useEffect(() => {
    const series = seriesRef.current;
    if (series.start != null) {
      const last = lastStartRef.current;
      if (last != null && series.start > last && hoverRef.current >= 0) {
        const next = Math.max(-1, hoverRef.current - (series.start - last));
        hoverRef.current = next;
        setHover(next);
      }
      lastStartRef.current = series.start;
    }
    draw();
  }, [draw, tick]);

  // redraw when the pointer moves to another sample
  useEffect(() => {
    draw();
  }, [draw, hover]);

  // redraw on resize while expanded
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Keep the tooltip text fresh even while the pointer rests on one point:
  // the "Ns ago" wording walks with the clock.
  useEffect(() => {
    if (hover < 0) return;
    const id = setInterval(() => {
      const tip = tipRef.current;
      if (!tip) return;
      tip.textContent = tipText(seriesRef.current, hover, optsRef.current.fmt);
    }, 1000);
    return () => clearInterval(id);
  }, [hover]);

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    if (!canvas || !series || !series.vals.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const n = series.vals.length;
    const frac = (x - GUT) / Math.max(1, rect.width - GUT - PR);
    let idx = Math.round(frac * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    // snap to the nearest real sample so gaps still read out something useful
    if (series.vals[idx] == null) {
      for (let d = 1; d <= 30; d++) {
        if (idx - d >= 0 && series.vals[idx - d] != null) {
          idx = idx - d;
          break;
        }
        if (idx + d < n && series.vals[idx + d] != null) {
          idx = idx + d;
          break;
        }
      }
    }
    hoverRef.current = idx;
    setHover(idx);
    const tip = tipRef.current;
    if (tip) {
      tip.textContent = tipText(series, idx, optsRef.current.fmt);
      const tw = tip.offsetWidth || 120;
      const px = n < 2 ? GUT : (idx / (n - 1)) * (rect.width - GUT - PR) + GUT;
      tip.style.transform = `translate(${Math.min(Math.max(px + 10, 2), Math.max(2, rect.width - tw - 2))}px, 0)`;
    }
  };

  const onPointerLeave = () => {
    hoverRef.current = -1;
    setHover(-1);
  };

  return (
    <div className="tele-graph-canvas">
      <canvas ref={canvasRef} className="tele-canvas" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} />
      <div ref={tipRef} className={`graph-tip${hover >= 0 ? " show" : ""}`}>
        {hover >= 0 ? tipText(seriesRef.current, hover, optsRef.current.fmt) : ""}
      </div>
    </div>
  );
}

/* ---------- the live dot ---------- */

function LiveDot() {
  return (
    <span className="tele-live">
      <i className="tele-live-dot" aria-hidden="true" />
      live
    </span>
  );
}

/* ---------- the process table ---------- */

const PROCS_LIMIT = 40;
const PROCS_POLL_MS = 2000;

type SortKey = "rss" | "cpu";

function procsMetaText(sort: string, data: ProcsResponse | null): string {
  if (!data) return "loading…";
  const label = sort === "rss" ? "mem" : sort === "cpu" ? "cpu" : sort;
  return `${data.procs.length} of ${data.total} · ${label} ${data.order} · ${data.cpu_sample_s}s sample`;
}

function ProcTable() {
  const [procs, setProcs] = useState<Proc[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rss");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [meta, setMeta] = useState<{ text: string; bad: boolean }>({ text: "loading…", bad: false });
  const openModal = useModal();
  const sortKeyRef = useRef(sortKey);
  const sortOrderRef = useRef(sortOrder);
  sortKeyRef.current = sortKey;
  sortOrderRef.current = sortOrder;

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    let queued = false;
    let errorShown = false;

    const refresh = async () => {
      if (cancelled || inflight) {
        if (inflight) queued = true; // a refresh landed mid-flight; rerun once it settles
        return;
      }
      if (document.hidden) return;
      inflight = true;
      try {
        const data = await telemetryApi.procs(sortKeyRef.current, sortOrderRef.current, PROCS_LIMIT);
        if (cancelled) return;
        setProcs(data.procs);
        setMeta({ text: procsMetaText(sortKeyRef.current, data), bad: false });
        errorShown = false;
      } catch (err) {
        if (cancelled) return;
        if (!errorShown) {
          setMeta({ text: `procs unavailable · ${(err as Error).message}`, bad: true });
          errorShown = true;
        }
      } finally {
        inflight = false;
        if (queued) {
          queued = false;
          refresh();
        }
      }
    };

    refresh();
    const id = setInterval(refresh, PROCS_POLL_MS);
    // Sort clicks and sent signals poke an immediate re-fetch through the
    // same poll closure, which reads the live sort from the refs.
    const poke = () => refresh();
    window.addEventListener("tele-procs-refresh", poke);
    // A background tab keeps no timers running; catch up when it comes back.
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("tele-procs-refresh", poke);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const bumpSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
    setMeta((m) => ({ ...m, text: `sorting by ${key === "rss" ? "mem" : key} …` }));
    window.dispatchEvent(new CustomEvent("tele-procs-refresh"));
  };

  const sendSignal = async (row: Proc, sig: "TERM" | "KILL") => {
    const label = `SIG${sig}`;
    const ok = await openModal({
      title: `${label.toLowerCase()} → ${row.pid} ${row.name}`,
      text:
        `${row.cmdline.slice(0, 160)}\n\n${
          sig === "KILL"
            ? "SIGKILL cannot be caught or ignored: the process dies at once and unsaved work is lost."
            : "SIGTERM asks the process to exit cleanly; it may ignore the signal."
        }`,
      ok: label,
      danger: true,
    });
    if (!ok) return;
    try {
      await telemetryApi.signal(row.pid, sig);
      setMeta({ text: `${label} sent to ${row.pid} ${row.name}`, bad: false });
    } catch (err) {
      setMeta({ text: `${label} failed · ${(err as Error).message}`, bad: true });
    }
    // A killed pid disappears from the next snapshot; give it a moment to exit.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("tele-procs-refresh")), sig === "KILL" ? 350 : 900);
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortOrder === "desc" ? " ▼" : " ▲") : "";

  return (
    <div className="tele-procs">
      <div className="procs-bar">
        <span className="procs-title">proc table</span>
        <span className={`procs-meta${meta.bad ? " is-bad" : ""}`}>{meta.text}</span>
      </div>
      <div className="procs-scroll">
        <table className="procs-table">
          <thead>
            <tr>
              <th className="p-pid">pid</th>
              <th className="p-name">process</th>
              <th className="p-num">
                <button
                  type="button"
                  className="procs-sort"
                  aria-pressed={sortKey === "cpu"}
                  onClick={() => bumpSort("cpu")}
                >
                  {`cpu%${sortIndicator("cpu")}`}
                </button>
              </th>
              <th className="p-num">
                <button
                  type="button"
                  className="procs-sort"
                  aria-pressed={sortKey === "rss"}
                  onClick={() => bumpSort("rss")}
                >
                  {`mem${sortIndicator("rss")}`}
                </button>
              </th>
              <th className="p-sig">signal</th>
            </tr>
          </thead>
          <tbody>
            {(procs ?? []).map((row) => (
              <tr key={row.pid}>
                <td className="p-pid">{row.pid}</td>
                <td className="p-name" title={row.cmdline}>
                  {row.name}
                </td>
                <td className="p-num">{row.cpu_percent.toFixed(1)}</td>
                <td className="p-num" title={`${row.user} · ${row.status} · ${row.mem_percent}% of ram`}>
                  {fmtBytesCompact(row.rss_bytes)}
                </td>
                <td className="p-sig">
                  {(["TERM", "KILL"] as const).map((sig) => (
                    <button
                      key={sig}
                      type="button"
                      className="p-signal"
                      data-sig={sig}
                      disabled={row.protected}
                      title={row.protected ? `pid ${row.pid} is init or the dashboard itself: refused` : `send SIG${sig} to pid ${row.pid}`}
                      onClick={() => sendSignal(row, sig)}
                    >
                      {sig === "KILL" ? "kill" : "term"}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {procs != null && procs.length === 0 && <div className="procs-empty">// no processes</div>}
      </div>
    </div>
  );
}

/* ---------- power alerts: localStorage log + badge ---------- */

const PWR_ALERT_THRESHOLD_W = 80;
const PWR_ALERT_COOLDOWN_MS = 60000;
const PWR_ALERTS_KEY = "macmini-pwr-alerts-v1";
const PWR_ALERTS_MAX = 50;

interface PwrAlert {
  t: string;
  watts: number;
  cpu_w: number | null;
  gpu_w: number | null;
}

function loadPwrAlerts(): PwrAlert[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PWR_ALERTS_KEY) || "[]");
    if (Array.isArray(raw)) return raw.filter((a) => a && typeof a.watts === "number").slice(-PWR_ALERTS_MAX);
  } catch {
    // unreadable or blocked storage: start from an empty log
  }
  return [];
}

function savePwrAlerts(list: PwrAlert[]): void {
  try {
    localStorage.setItem(PWR_ALERTS_KEY, JSON.stringify(list.slice(-PWR_ALERTS_MAX)));
  } catch {
    // storage full or blocked: the in-memory log keeps working
  }
}

const fmtClock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// The cooldown spans reloads: it is measured from the newest stored entry.
function lastPwrAlertAt(list: PwrAlert[]): number {
  return list.length ? Date.parse(list[list.length - 1].t) || 0 : 0;
}

/* ---------- one expandable telemetry card shell ---------- */

interface TeleCardProps {
  label: string;
  ariaLabel: string;
  accent?: string;
  extraHeader?: React.ReactNode;
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}

function TeleCard({ label, ariaLabel, accent, extraHeader, children, expanded, onToggle }: TeleCardProps) {
  const style = accent ? ({ "--accent": accent } as CSSProperties) : undefined;
  return (
    <div
      className={`tele-card${expanded ? " expanded" : ""}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      onClick={(e) => {
        // buttons and the proc table manage themselves; everywhere else
        // (including the canvas and alert rows) toggles the card
        if ((e.target as HTMLElement).closest("button, .tele-procs")) return;
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="tele-label">
        <span>{label}</span>
        <span className="tele-right">
          {extraHeader}
          <LiveDot />
        </span>
      </div>
      {children}
    </div>
  );
}

// A thin bar with an accent fill. No transition: the 1s data snaps.
function TeleBar({ pct, title }: { pct: number; title?: string }) {
  const frac = Math.max(0, Math.min(1, pct));
  return (
    <div className="tele-bar" title={title}>
      <i style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

/* ---------- the three cards ---------- */

export interface TelemetryCardsProps {
  poll: StatsPoll;
}

export function TelemetryCards({ poll }: TelemetryCardsProps) {
  const { stats, tick, graphs } = poll;
  const [openCard, setOpenCard] = useState<"cpu" | "mem" | "pwr" | null>(null);
  const [pwrTab, setPwrTab] = useState<"graph" | "alerts">("graph");
  const [pwrAlerts, setPwrAlerts] = useState<PwrAlert[]>([]);
  const [pwrBadge, setPwrBadge] = useState<PwrAlert | null>(null);
  const [seededTick, setSeededTick] = useState(0);
  const badgeAlert = useRef<PwrAlert | null>(null);
  const alertsRef = useRef<PwrAlert[]>([]);

  // localStorage read once on mount (SSR-safe)
  useEffect(() => {
    const stored = loadPwrAlerts();
    alertsRef.current = stored;
    setPwrAlerts(stored);
  }, []);

  // Feed a power alert when a tick crosses the threshold, honoring the
  // 60s cooldown measured from the newest stored entry.
  useEffect(() => {
    const total = stats?.power?.total_w;
    if (total == null || !Number.isFinite(total) || total <= PWR_ALERT_THRESHOLD_W) return;
    const list = alertsRef.current;
    if (Date.now() - lastPwrAlertAt(list) < PWR_ALERT_COOLDOWN_MS) return;
    const entry: PwrAlert = {
      t: stats?.t || new Date().toISOString(),
      watts: total,
      cpu_w: stats?.power?.cpu_w ?? null,
      gpu_w: stats?.power?.gpu_w ?? null,
    };
    const next = [...list, entry].slice(-PWR_ALERTS_MAX);
    alertsRef.current = next;
    savePwrAlerts(next);
    setPwrAlerts(next);
    badgeAlert.current = entry;
    setPwrBadge(entry);
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the graph rings on the first card expansion.
  useEffect(() => {
    if (openCard == null) return;
    const store = graphs.current;
    if (store.seeded || store.seeding) return;
    seedHistory(store).then(() => setSeededTick((t) => t + 1));
  }, [openCard, graphs]);

  const toggleCard = (key: "cpu" | "mem" | "pwr") => {
    setOpenCard((cur) => (cur === key ? null : key));
    if (key === "pwr") setPwrTab("graph");
  };

  const dismissBadge = () => {
    badgeAlert.current = null;
    setPwrBadge(null);
  };

  const clearAlerts = () => {
    alertsRef.current = [];
    savePwrAlerts([]);
    setPwrAlerts([]);
    dismissBadge();
  };

  /* ----- cpu readouts ----- */
  const cpuUtil = stats?.cpu?.util_percent ?? null;
  const cpuTemp = stats?.cpu?.temp_c ?? null;
  const tempSrc = stats?.cpu?.temp_source || "CPU dies";
  const cpuUtilPct = cpuUtil == null ? 0 : Math.round(Math.min(100, cpuUtil)) / 100;
  const tempFrac = cpuTemp == null ? 0 : Math.min(1, Math.max(0, (cpuTemp - 30) / (100 - 30)));
  const tempBarPct = Math.round(tempFrac * 100) / 100;

  /* ----- memory readouts ----- */
  const GiB = (b: number) => (b / GIB).toFixed(1);
  const memUsedGb = stats?.mem?.used_bytes ?? null;
  const memTotalGb = stats?.mem?.total_bytes ?? null;
  const memUtilPct = stats?.mem?.util_percent ?? 0;
  const memBarPct = Math.round(Math.min(100, memUtilPct)) / 100;

  /* ----- power readouts ----- */
  const pwrTotal = stats?.power?.total_w ?? null;
  const pwrNote = stats?.power?.note || "";
  const pwrBarPct = pwrTotal == null ? 0 : Math.round(Math.min(100, pwrTotal)) / 100;
  const pwrParts = useMemo(() => {
    const p = stats?.power;
    const parts: string[] = [];
    if (p?.cpu_w != null) parts.push(`cpu ${fmtW(p.cpu_w)}`);
    if (p?.gpu_w != null) parts.push(`gpu ${fmtW(p.gpu_w)}`);
    if (p?.ane_w != null) parts.push(`ane ${fmtW(p.ane_w)}`);
    if (p?.source === "Apple SMC") return "system · Apple SMC";
    return parts.length ? `${parts.join(" · ")} W` : "sampler unavailable";
  }, [stats]);

  /* ----- shared graph options ----- */
  const accent = DEFAULT_ACCENT;
  const graphOptsFor = (key: GraphKey): Omit<GraphOpts, "accent"> => {
    const store = graphs.current;
    if (key === "cpu")
      return {
        ymin: 0,
        ymax: 100,
        fixedTicks: [0, 25, 50, 75, 100],
        fmt: (v) => `${v.toFixed(1)}%`,
        tickFmt: (v) => `${Math.round(v)}`,
      };
    if (key === "mem")
      return {
        ymin: 0,
        ymax: store.memTotalGb,
        fmt: (v) => `${v.toFixed(2)} GB`,
        tickFmt: (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}`,
      };
    return {
      ymin: 0,
      ymax: null,
      autoMax: true,
      minSpan: 10,
      fmt: (v) => `${fmtW(v)} W`,
      tickFmt: (v) => fmtW(v),
    };
  };

  return (
    <div className="telemetry" aria-label="Live host telemetry">
      {/* ----- CPU ----- */}
      <TeleCard
        label="cpu"
        ariaLabel="CPU — activate to expand 1 hour graph"
        expanded={openCard === "cpu"}
        onToggle={() => toggleCard("cpu")}
      >
        <div className="tele-duo">
          <div className="tele-half">
            <div className="tele-main">
              <span>{cpuUtil == null ? "—" : cpuUtil.toFixed(1)}</span>
              <span className="tele-unit">%</span>
            </div>
            <div className="tele-sub">util · 0–100%</div>
            <TeleBar pct={cpuUtilPct} title="Utilization (0–100%)" />
          </div>
          <div className="tele-half is-temp">
            <div className="tele-main">
              <span>{cpuTemp == null ? "—" : cpuTemp.toFixed(1)}</span>
              <span className="tele-unit">°C</span>
            </div>
            <div className="tele-sub">{`${tempSrc} · 30–100 °C`}</div>
            <TeleBar pct={tempBarPct} title="Package temp (30–100 °C)" />
          </div>
        </div>
        {openCard === "cpu" && (
          <div className="tele-graph">
            <GraphCanvas store={graphs} seriesKey="cpu" tick={tick + seededTick} accent={accent} opts={graphOptsFor("cpu")} />
          </div>
        )}
      </TeleCard>

      {/* ----- Memory ----- */}
      <TeleCard
        label="memory"
        ariaLabel="Memory — activate to expand 1 hour graph and the process list"
        expanded={openCard === "mem"}
        onToggle={() => toggleCard("mem")}
      >
        <div className="tele-main">
          <span>{memUsedGb == null ? "—" : GiB(memUsedGb)}</span>
          <span className="tele-unit">{`/ ${memTotalGb == null ? "—" : GiB(memTotalGb)} GB`}</span>
        </div>
        <div className="tele-sub">
          {memUsedGb == null
            ? "available —"
            : `available ${GiB(stats?.mem?.available_bytes ?? 0)} GB · ${Math.round(memUtilPct)}% used`}
        </div>
        <TeleBar pct={memBarPct} />
        {openCard === "mem" && (
          <div className="tele-graph">
            <GraphCanvas store={graphs} seriesKey="mem" tick={tick + seededTick} accent={accent} opts={graphOptsFor("mem")} />
            <ProcTable />
          </div>
        )}
      </TeleCard>

      {/* ----- Power ----- */}
      <TeleCard
        label="power"
        ariaLabel="Power — activate to expand 1 hour graph"
        expanded={openCard === "pwr"}
        onToggle={() => toggleCard("pwr")}
        extraHeader={
          pwrBadge && (
            <button
              type="button"
              className="pwr-badge show"
              title="Dismiss power alert"
              aria-label="Dismiss power alert"
              onClick={dismissBadge}
            >
              ⚠<span>{`HIGH ${fmtW(pwrBadge.watts)}W`}</span>
              <span className="pwr-x" aria-hidden="true">×</span>
            </button>
          )
        }
      >
        <div className="tele-main" title={pwrNote}>
          <span>{pwrTotal == null ? "—" : fmtW(pwrTotal)}</span>
          <span className="tele-unit">W</span>
        </div>
        <div className="tele-sub">{pwrParts}</div>
        <TeleBar pct={pwrBarPct} />
        {openCard === "pwr" && (
          <div className="tele-graph">
            <div className="tele-tabs" role="tablist" aria-label="Power views">
              <button
                type="button"
                role="tab"
                aria-selected={pwrTab === "graph"}
                className={`tele-tab${pwrTab === "graph" ? " active" : ""}`}
                onClick={() => setPwrTab("graph")}
              >
                [graph]
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pwrTab === "alerts"}
                className={`tele-tab${pwrTab === "alerts" ? " active" : ""}`}
                onClick={() => setPwrTab("alerts")}
              >
                {`[alerts${pwrAlerts.length ? ` ${pwrAlerts.length}` : ""}]`}
              </button>
            </div>
            {pwrTab === "graph" ? (
              <GraphCanvas store={graphs} seriesKey="pwr" tick={tick + seededTick} accent={accent} opts={graphOptsFor("pwr")} />
            ) : (
              <div className="tele-alerts" aria-live="polite">
                {pwrAlerts.length === 0 ? (
                  <div className="tele-alerts-empty">{`// no power alerts — threshold ${PWR_ALERT_THRESHOLD_W}W`}</div>
                ) : (
                  <>
                    <div className="tele-alerts-head">
                      <span>{`${pwrAlerts.length} alert${pwrAlerts.length === 1 ? "" : "s"} · >${PWR_ALERT_THRESHOLD_W}W`}</span>
                      <button type="button" className="tele-alerts-clear" onClick={clearAlerts}>
                        Clear
                      </button>
                    </div>
                    {[...pwrAlerts].reverse().map((a, i) => {
                      const detail = [
                        a.cpu_w != null ? `cpu ${fmtW(a.cpu_w)}` : null,
                        a.gpu_w != null ? `gpu ${fmtW(a.gpu_w)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div className="tele-alert-row" key={`${a.t}-${i}`}>
                          <span className="w">{`⚠ ${fmtW(a.watts)} W`}</span>
                          <span>
                            {detail ? `${detail} W · ` : ""}
                            <time>{fmtClock(a.t)}</time>
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </TeleCard>
    </div>
  );
}
