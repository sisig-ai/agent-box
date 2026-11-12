"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, FormEvent as ReactFormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { DashboardButton } from "@/components/block/dashboard-shell";
import { useShellWs } from "@/hooks/use-shell-ws";
import { cn } from "@/lib/utils";
import "@/components/shell.css";

/* Host tty in ~ over websocket :5556 — tmux-backed pane pushed by the server.
   Ported from static/js/shell/shell.js + dashboard/page/panels_stack_shell.py. */

/* Named keys the terminal forwards verbatim. */
const KEYMAP: Record<string, string> = {
  Enter: "Enter",
  Backspace: "Backspace",
  Tab: "Tab",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Insert: "Insert",
};

/* Ctrl/Cmd shortcuts that never reach the tty as plain chars. */
const CTRL_KEYS = ["c", "d", "l", "u", "k", "a", "e", "r"] as const;

/* Canonical modifier order for composed key names ("C-c", "M-S-x"). */
const MOD_ORDER = ["C", "M", "S"] as const;

/* US layout: the glyph a Shift-modified printable key produces. */
const SHIFT_CHARS: Record<string, string> = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&",
  "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", "[": "{", "]": "}",
  "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?", "`": "~",
};

type StickyMods = { C: boolean; M: boolean; S: boolean };

/* Sticky modifier buttons under the terminal. */
const MOD_BUTTONS: { mod: keyof StickyMods; label: string; title: string }[] = [
  { mod: "S", label: "⇧", title: "Shift (sticky)" },
  { mod: "C", label: "ctrl", title: "Ctrl (sticky)" },
  { mod: "M", label: "alt", title: "Alt (sticky)" },
];

/* Direct-key buttons under the terminal. */
const KEY_BUTTONS: { key: string; label: string; title: string }[] = [
  { key: "Escape", label: "esc", title: "Escape" },
  { key: "Tab", label: "tab", title: "Tab" },
  { key: "Left", label: "←", title: "Left" },
  { key: "Up", label: "↑", title: "Up" },
  { key: "Down", label: "↓", title: "Down" },
  { key: "Right", label: "→", title: "Right" },
];

const EMPTY_MODS: StickyMods = { C: false, M: false, S: false };

function hasArmed(mods: StickyMods): boolean {
  return mods.C || mods.M || mods.S;
}

function composePrefix(mods: StickyMods): string {
  return MOD_ORDER.filter((m) => mods[m]).map((m) => `${m}-`).join("");
}

export function ShellView({ active = true }: { active?: boolean }) {
  const { html, state, sid, sendText, sendKey, fit, reconnect, newShell } = useShellWs(active);

  const termRef = useRef<HTMLDivElement>(null);
  const imeRef = useRef<HTMLTextAreaElement>(null);
  const [armed, setArmed] = useState<StickyMods>(EMPTY_MODS);
  const armedRef = useRef<StickyMods>(EMPTY_MODS);

  const syncArmed = useCallback((next: StickyMods) => {
    armedRef.current = next;
    setArmed(next);
  }, []);

  /* Emit a named key or combo ("Tab", "C-c"), folding in the armed modifiers
     in canonical order, then clear them. */
  const emitKey = useCallback(
    (name: string) => {
      const parts = name.split("-");
      const base = parts.pop() as string;
      const mods = { ...armedRef.current };
      for (const part of parts) {
        if (part === "C") mods.C = true;
        else if (part === "M") mods.M = true;
        else if (part === "S") mods.S = true;
      }
      syncArmed(EMPTY_MODS);
      sendKey(`${composePrefix(mods)}${base}`);
    },
    [sendKey, syncArmed],
  );

  /* Printable character: Shift folds into the glyph; Ctrl/Alt stay as prefixes
     ("C-c", "M-f"). No modifier armed -> plain typed input. */
  const emitChar = useCallback(
    (ch: string) => {
      const armedNow = armedRef.current;
      if (!hasArmed(armedNow)) {
        sendText(ch);
        return;
      }
      let base = ch;
      if (armedNow.S && ch.length === 1) {
        base = /[a-z]/.test(ch) ? ch.toUpperCase() : SHIFT_CHARS[ch] || ch;
      }
      const spec = `${composePrefix({ ...armedNow, S: false })}${base}`;
      syncArmed(EMPTY_MODS);
      if (spec === base) sendText(base);
      else sendKey(spec);
    },
    [sendText, sendKey, syncArmed],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();
      if (mod && (CTRL_KEYS as readonly string[]).includes(lower)) {
        e.preventDefault();
        emitKey(`C-${lower}`);
        return;
      }
      if (mod) return; // other modifier combos pass through to the browser
      const named = KEYMAP[e.key];
      if (named) {
        e.preventDefault();
        emitKey(named);
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        emitChar(e.key);
      }
    },
    [emitKey, emitChar],
  );

  /* Paste straight into the tty, capped at 4096 chars. */
  const onPaste = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text");
      if (text) sendText(text.slice(0, 4096));
    },
    [sendText],
  );

  const focusTerm = useCallback(() => {
    termRef.current?.focus({ preventScroll: true });
    /* Coarse pointers never open a keyboard for a plain div; a hidden
       textarea inside the terminal captures what keydown misses. */
    if (typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches) {
      imeRef.current?.focus({ preventScroll: true });
    }
  }, []);

  /* Mobile / IME fallback: the hidden textarea reports composed text as
     plain input events. */
  const onImeInput = useCallback(
    (e: ReactFormEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      e.currentTarget.value = "";
      if (!value) return;
      if (hasArmed(armedRef.current)) {
        for (const ch of value) emitChar(ch);
      } else {
        sendText(value);
      }
    },
    [emitChar, sendText],
  );

  /* Keep the pane pinned to the bottom after every repaint. */
  useEffect(() => {
    const term = termRef.current;
    if (term) term.scrollTop = term.scrollHeight;
  }, [html]);

  const onFit = useCallback(() => {
    const term = termRef.current;
    fit(term ? term.clientWidth : 0);
    focusTerm();
  }, [fit, focusTerm]);

  const onClear = useCallback(() => {
    sendKey("C-l");
    focusTerm();
  }, [sendKey, focusTerm]);

  const onReconnect = useCallback(() => {
    reconnect();
    focusTerm();
  }, [reconnect, focusTerm]);

  const onNew = useCallback(() => {
    newShell();
    focusTerm();
  }, [newShell, focusTerm]);

  const onModToggle = useCallback(
    (mod: keyof StickyMods) => {
      syncArmed({ ...armedRef.current, [mod]: !armedRef.current[mod] });
      focusTerm();
    },
    [syncArmed, focusTerm],
  );

  /* The cursor blinks only while the view is on screen; when the shell view
     unmounts the component (and the animation) goes away with it. */
  return (
    <div className="shell-root flex h-full min-h-0 flex-col">
      <div className="shell-head flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-(--obsidian-dashboard-shell-border) px-4 py-2.5">
        <div className="shell-title flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn("shell-dot", state.on === true && "on", state.on === false && "off")}
          />
          <span className="truncate">
            shell — kixpanganiban@macmini <span className="dim">~</span>
          </span>
          <span className="shell-sess truncate">{sid ? `· ${sid}` : ""}</span>
        </div>
        <div className="shell-actions flex flex-wrap items-center gap-1.5">
          <DashboardButton variant="secondary" size="sm" onClick={onFit} title="Resize pty to fit this window">
            fit
          </DashboardButton>
          <DashboardButton variant="secondary" size="sm" onClick={onClear} title="Clear screen (Ctrl-L)">
            clear
          </DashboardButton>
          <DashboardButton variant="secondary" size="sm" onClick={onReconnect} title="Reconnect (poll now)">
            reconnect
          </DashboardButton>
          <DashboardButton variant="secondary" size="sm" onClick={onNew} title="Kill and start a fresh shell in ~">
            new
          </DashboardButton>
        </div>
      </div>

      <div className="shell-body flex min-h-0 flex-1 flex-col p-3">
        <div
          ref={termRef}
          className="term obsidian-dashboard-shell-scroll flex-1"
          tabIndex={0}
          role="textbox"
          aria-label="Host shell terminal"
          aria-multiline="true"
          onClick={focusTerm}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        >
          <textarea
            ref={imeRef}
            aria-hidden="true"
            className="ime-fallback"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            tabIndex={-1}
            onInput={onImeInput}
          />
          <pre className="term-screen" dangerouslySetInnerHTML={{ __html: html }} />
        </div>

        <div
          className="term-keys flex flex-wrap items-center gap-1.5 pt-2"
          role="toolbar"
          aria-label="Terminal keys"
          onMouseDown={(e) => e.preventDefault()} /* keep terminal focus */
        >
          {MOD_BUTTONS.map(({ mod, label, title }) => (
            <button
              key={mod}
              type="button"
              className={cn("key-btn", armed[mod] && "armed")}
              title={title}
              aria-pressed={armed[mod]}
              onClick={() => onModToggle(mod)}
            >
              {label}
            </button>
          ))}
          {KEY_BUTTONS.map(({ key, label, title }) => (
            <button
              key={key}
              type="button"
              className="key-btn"
              title={title}
              onClick={() => {
                emitKey(key);
                focusTerm();
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="term-hint flex flex-wrap items-center justify-between gap-2 pt-1.5 pb-0.5">
          <span>click terminal, then type — full tty on the host, starting in ~</span>
          <span className={cn(state.on === true && "is-on", state.on === false && "is-off")}>
            {state.text}
          </span>
        </div>
      </div>
    </div>
  );
}
