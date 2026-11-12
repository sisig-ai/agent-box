"use client";

// Access logs: one row per MCP tools/call, newest first. Ported from the old
// Alpine logs view (static/js/logs/view.js + dashboard/page/panels_logs.py):
// 4s poll while the view is visible, filters by tool and outcome, a stacked
// clock/day time cell, ok/err pills and a status + summary footer.

import { useCallback, useEffect, useRef, useState } from "react";
import { logsApi, type LogEntry } from "@/lib/api";
import { clock, dayStamp, syncedAt } from "@/lib/format";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "../logs.css";

const POLL_MS = 4000;
const LIMIT = 300;
const TOP_PIN_PX = 40;

function rowTitle(entry: LogEntry): string {
  return `${entry.ts}\n${entry.args || "(no arguments)"}${entry.error ? `\n\nerror: ${entry.error}` : ""}`;
}

export function LogsView({ active = true }: { active?: boolean }) {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [tool, setTool] = useState("");
  const [ok, setOk] = useState("");
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [files, setFiles] = useState(0);
  const [retention, setRetention] = useState(7);
  const [status, setStatus] = useState("loading…");
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const filters = useRef({ tool: "", ok: "" });
  filters.current = { tool, ok };

  const refresh = useCallback(async () => {
    const { tool: toolFilter, ok: okFilter } = filters.current;
    try {
      const data = await logsApi.list({ limit: LIMIT, tool: toolFilter || undefined, ok: okFilter || undefined });
      const body = bodyRef.current;
      const nearTop = !body || body.scrollTop < TOP_PIN_PX;
      setRows(data.entries || []);
      setTools(data.tools || []);
      setCount(data.count || 0);
      setTotal(data.total || 0);
      setFiles((data.files || []).length);
      setRetention(data.retention_days || 7);
      setFailed(false);
      setStatus(`synced ${syncedAt()}`);
      if (body && nearTop) body.scrollTop = 0; // newest first: stay at the top
    } catch (err) {
      setFailed(true);
      setStatus(`load failed: ${(err as Error).message}`);
    }
  }, []);

  // poll only while this view is the one on screen and the tab is visible
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  // a background tab that becomes visible catches up immediately
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, refresh]);

  const summary =
    `${count} row${count === 1 ? "" : "s"} · ${total} total`
    + (tool ? ` · tool ${tool}` : "")
    + (ok ? ` · ${ok === "1" ? "ok" : "errors"}` : "")
    + ` · ${retention}d`
    + (files ? ` · ${files} file${files === 1 ? "" : "s"}` : "");

  return (
    <section className="logs" aria-label="Access logs">
      <div className="logs-head">
        <div className="logs-title">
          <h2>Access Logs</h2>
          <span className="logs-sub">
            every MCP invocation, newest first · <code>/mcp</code>
          </span>
        </div>
        <div className="logs-actions">
          <label className="logs-filter">
            tool
            <select
              aria-label="Filter by tool"
              value={tool}
              className={tool ? "active" : ""}
              onChange={(e) => {
                setTool(e.target.value);
                setTimeout(() => void refresh(), 0);
              }}
            >
              <option value="">all tools</option>
              {tools.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="logs-filter">
            result
            <select
              aria-label="Filter by outcome"
              value={ok}
              className={ok ? "active" : ""}
              onChange={(e) => {
                setOk(e.target.value);
                setTimeout(() => void refresh(), 0);
              }}
            >
              <option value="">all</option>
              <option value="1">ok</option>
              <option value="0">error</option>
            </select>
          </label>
          <DashboardButton size="sm" title="Reload the log" onClick={() => void refresh()}>
            ⟳ refresh
          </DashboardButton>
        </div>
      </div>

      <div className="logs-body obsidian-dashboard-shell-scroll" ref={bodyRef}>
        <table className="logs-table">
          <thead>
            <tr>
              <th className="lg-time">time</th>
              <th className="lg-action">action</th>
              <th className="lg-entity">entity</th>
              <th className="lg-ms">ms</th>
              <th className="lg-status">result</th>
              <th className="lg-args">request</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => (
              <tr key={index} className={entry.ok ? "lg-ok" : "lg-err"} title={rowTitle(entry)}>
                <td className="lg-time">
                  <span className="lg-clock">{clock(entry.ts)}</span>
                  <span className="lg-day">{dayStamp(entry.ts)}</span>
                </td>
                <td className="lg-action">{entry.tool}</td>
                <td className="lg-entity">{entry.entity || "—"}</td>
                <td className="lg-ms">{entry.ms}</td>
                <td className="lg-status">
                  <span className={`lg-pill ${entry.ok ? "ok" : "err"}`}>{entry.ok ? "ok" : "err"}</span>
                </td>
                <td className="lg-args">{entry.error ? `error: ${entry.error}` : entry.args || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="logs-empty">no calls logged yet</p>}
      </div>

      <div className="logs-status">
        <span className={failed ? "err" : ""}>{status}</span>
        <span>{summary}</span>
      </div>
    </section>
  );
}
