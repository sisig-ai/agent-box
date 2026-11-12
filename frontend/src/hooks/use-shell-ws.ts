"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { paint } from "@/lib/ansi";

/* tmux-backed host tty over a standalone websocket on :5556.
   The server pushes a pane snapshot whenever the tmux pane changes, plus an
   immediate push after every input/key — no polling. Ported from
   static/js/shell/shell.js. */

const LS_KEY = "macmini-shell-session-id";
const WS_PORT = 5556;
const TYPE_BATCH_MS = 30; // keystrokes inside one burst share a single input call
const FIT_ROWS = 30;
const FIT_MIN_COLS = 20;
const FIT_MAX_COLS = 300;
const FIT_CELL_PX = 7.9; // FiraCode advance ≈0.6em at the 0.82rem terminal size
const FIT_PAD_PX = 32; // .term horizontal padding

/* Placeholder pane contents before the first paint (plain text is safe HTML). */
const CONNECTING_HTML = "connecting…";
const DEAD_HTML = "// shell session not found — press New for a fresh shell in ~";

export type ShellState = { text: string; on: boolean | null };

type PaneMsg = {
  t: "pane";
  text?: string;
  cursor_x?: number;
  cursor_y?: number;
  cols?: number;
  rows?: number;
  alive?: boolean;
  cmd?: string;
};
type HelloMsg = { t: "hello"; id?: string; warn?: string };
type ErrorMsg = { t: "error"; error?: string };
type ServerMsg = PaneMsg | HelloMsg | ErrorMsg;
type ClientMsg =
  | { t: "input"; text: string }
  | { t: "key"; key: string }
  | { t: "resize"; cols: number; rows: number }
  | { t: "new" };

function shellWsUrl(sid: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.hostname}:${WS_PORT}/ws/shell?id=${encodeURIComponent(sid)}`;
}

function mintSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Persisted session id: reuse a valid one, else mint and store a fresh id. */
function loadSid(): string {
  let sid = "";
  try {
    sid = (localStorage.getItem(LS_KEY) || "").trim();
  } catch {
    sid = "";
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(sid)) {
    sid = mintSid();
    try {
      localStorage.setItem(LS_KEY, sid);
    } catch {
      /* private mode: keep the id in memory only */
    }
  }
  return sid;
}

function storeSid(sid: string): void {
  try {
    localStorage.setItem(LS_KEY, sid);
  } catch {
    /* ignore */
  }
}

export function useShellWs(active: boolean) {
  const [html, setHtml] = useState(CONNECTING_HTML);
  const [state, setState] = useState<ShellState>({ text: "connecting…", on: null });
  const [sid, setSid] = useState("");

  const activeRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPaneRef = useRef<PaneMsg | null>(null);
  const paintedRef = useRef(false);
  const sidRef = useRef("");
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeBufRef = useRef("");
  const connectRef = useRef<() => void>(() => {});

  const applyState = useCallback((text: string, on: boolean | null) => {
    setState((prev) => (prev.text === text && prev.on === on ? prev : { text, on }));
  }, []);

  const wSend = useCallback((msg: ClientMsg): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  /* Pane paint: skipped while the tab is hidden; the latest pending pane is
     painted on visibilitychange. Dead panes never paint — the screen keeps
     its last content, or shows the not-found notice if nothing painted yet. */
  const handlePane = useCallback(
    (pane: PaneMsg) => {
      if (document.hidden) {
        pendingPaneRef.current = pane;
        return;
      }
      pendingPaneRef.current = null;
      if (!pane.alive) {
        applyState("session dead — press New", false);
        if (!paintedRef.current) setHtml(DEAD_HTML);
        return;
      }
      paintedRef.current = true;
      setHtml(paint(pane.text || "", true, pane.cursor_x || 0, pane.cursor_y || 0));
      applyState(`connected · ${pane.cols}×${pane.rows}${pane.cmd ? ` · ${pane.cmd}` : ""}`, true);
    },
    [applyState],
  );

  const onServer = useCallback(
    (msg: ServerMsg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "pane") {
        handlePane(msg);
      } else if (msg.t === "hello") {
        if (msg.id) {
          sidRef.current = msg.id;
          setSid(msg.id);
          storeSid(msg.id);
        }
        if (msg.warn) applyState(`connected with warning — ${msg.warn}`, true);
      } else if (msg.t === "error") {
        applyState(`error — ${msg.error || "unknown"}`, false);
      }
    },
    [handlePane, applyState],
  );

  /* Typed characters batch into a single {t:'input'} per 30ms burst. */
  const flushType = useCallback(() => {
    if (typeTimerRef.current) {
      clearTimeout(typeTimerRef.current);
      typeTimerRef.current = null;
    }
    if (!typeBufRef.current) return;
    const text = typeBufRef.current;
    typeBufRef.current = "";
    wSend({ t: "input", text }); // the server pushes the fresh pane itself
  }, [wSend]);

  const sendText = useCallback(
    (text: string) => {
      if (!text) return;
      typeBufRef.current += text;
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
      typeTimerRef.current = setTimeout(flushType, TYPE_BATCH_MS);
    },
    [flushType],
  );

  const sendKey = useCallback(
    (key: string) => {
      flushType();
      wSend({ t: "key", key });
    },
    [flushType, wSend],
  );

  /* Resize the pty to the terminal's current width; rows are fixed at 30. */
  const fit = useCallback(
    (termWidth: number) => {
      const cols = Math.max(
        FIT_MIN_COLS,
        Math.min(FIT_MAX_COLS, Math.floor((termWidth - FIT_PAD_PX) / FIT_CELL_PX)),
      );
      if (!wSend({ t: "resize", cols, rows: FIT_ROWS })) applyState("not connected", false);
    },
    [wSend, applyState],
  );

  const reconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    retryRef.current = 0;
    if (activeRef.current) connectRef.current();
  }, []);

  /* Kill + recreate the session server-side; keeps the pty size. */
  const newShell = useCallback(() => {
    applyState("starting fresh shell…", null);
    wSend({ t: "new" });
  }, [applyState, wSend]);

  /* Paint the latest pending pane when the tab comes back. */
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && pendingPaneRef.current) handlePane(pendingPaneRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [handlePane]);

  /* Transport lifecycle: connect while active, exponential backoff on drops. */
  useEffect(() => {
    activeRef.current = active;

    const stop = () => {
      activeRef.current = false;
      flushType(); // deliver any keystrokes still inside the batch window
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
    };

    if (!active) {
      stop();
      return;
    }

    const loaded = loadSid();
    sidRef.current = loaded;
    setSid(loaded);

    function scheduleReconnect() {
      if (!activeRef.current) return;
      const delay = Math.min(500 * 2 ** retryRef.current, 5000);
      retryRef.current += 1;
      applyState(retryRef.current > 1 ? "reconnecting…" : "connecting…", null);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        if (activeRef.current) connect();
      }, delay);
    }

    function connect() {
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;
      applyState("connecting…", null);
      let sock: WebSocket;
      try {
        sock = new WebSocket(shellWsUrl(sidRef.current));
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = sock;
      sock.onopen = () => {
        retryRef.current = 0;
      };
      sock.onmessage = (ev: MessageEvent) => {
        let msg: ServerMsg | null = null;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg) onServer(msg);
      };
      sock.onclose = () => {
        /* A socket we already replaced (reconnect/new) must not touch the
           retry counter or the status line — only the live transport does. */
        if (wsRef.current !== sock) return;
        wsRef.current = null;
        if (activeRef.current) scheduleReconnect();
      };
      sock.onerror = () => {
        /* onclose follows and schedules the retry */
      };
    }

    connectRef.current = connect;
    connect();
    return stop;
  }, [active, applyState, onServer, flushType]);

  return { html, state, sid, sendText, sendKey, fit, reconnect, newShell };
}
