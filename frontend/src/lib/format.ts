// Shared formatters and small helpers used across views.

export const pad = (n: number) => String(n).padStart(2, "0");

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - (day - 1));
  return dt.toISOString().slice(0, 10);
}

export function shiftWeek(weekStr: string, weeks: number): string {
  return shiftDate(weekStr, 7 * weeks);
}

export function fmtDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
  });
}

export function fmtWeek(weekStr: string): string {
  const [y, m, d] = weekStr.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
}

export function fmtTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—"
    : date.toLocaleString([], {
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
}

export function relStamp(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtSize(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? String(v) : v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function fmtBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const gib = bytes / 1073741824;
  if (gib >= 1) return `${gib.toFixed(2)}G`;
  return `${Math.round(bytes / 1048576)}M`;
}

export function fmtW(w: number | null | undefined): string {
  if (w == null || !Number.isFinite(w)) return "—";
  return w < 10 ? w.toFixed(2) : w.toFixed(1);
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dayStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "2-digit" });
}

export function syncedAt(): string {
  return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Two-step confirm hook state helper.
export function useArm() {
  return { armed: false, timer: null as ReturnType<typeof setTimeout> | null };
}

export function armAction(state: { armed: boolean; timer: ReturnType<typeof setTimeout> | null }, action: () => void, ms = 3000) {
  if (state.armed) {
    if (state.timer) clearTimeout(state.timer);
    state.armed = false;
    action();
    return;
  }
  state.armed = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.armed = false; }, ms);
}
