"use client";

// Dashboard frame: ObsidianUI DashboardShell with the hash router, page
// chrome (title, greeting, clock, theme picker), single-letter hotkeys and
// the keys panel. Replaces the old htpy frame + Alpine chrome component.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell, DashboardButton, type DashboardShellProps } from "@/components/block/dashboard-shell";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { ModalProvider } from "@/components/modal-provider";
import { useHashRoute } from "@/hooks/use-hash-route";
import { configApi, type DashboardConfig } from "@/lib/api";
import { SitrepView } from "@/components/views/sitrep-view";
import { StackView } from "@/components/views/stack-view";
import { FilesView } from "@/components/views/files-view";
import { ShellView } from "@/components/views/shell-view";
import { KanbanView } from "@/components/views/kanban-view";
import { ProgressView } from "@/components/views/progress-view";
import { DocsView } from "@/components/views/docs-view";
import { TablesView } from "@/components/views/tables-view";
import { LogsView } from "@/components/views/logs-view";
import {
  ScrollText, LayoutDashboard, Folder, Terminal, Kanban, Activity,
  BookOpen, Table, ScrollText as LogsIcon,
} from "lucide-react";
import "./dashboard-chrome.css";

/* ----- view ids and hash routes (unchanged from the old router) ----- */

const VIEWS = [
  { id: "brief", hash: "#/brief", label: "Daily Sitrep", icon: ScrollText, key: "b" },
  { id: "stack", hash: "#/", label: "Stack", icon: LayoutDashboard, key: "s" },
  { id: "files", hash: "#/files", label: "Files", icon: Folder, key: "f" },
  { id: "shell", hash: "#/shell", label: "Shell", icon: Terminal, key: "t" },
  { id: "kanban", hash: "#/kanban", label: "Ops Board", icon: Kanban, key: "k" },
  { id: "progress", hash: "#/progress", label: "Progress Bars", icon: Activity, key: "p" },
  { id: "docs", hash: "#/docs", label: "Docs", icon: BookOpen, key: "d" },
  { id: "tables", hash: "#/tables", label: "Tables", icon: Table, key: "a" },
  { id: "logs", hash: "#/logs", label: "Access logs", icon: LogsIcon, key: "l" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export function viewForHash(hash: string): ViewId {
  if (hash === "#/brief" || hash.startsWith("#/brief")) return "brief";
  if (hash.startsWith("#/files")) return "files";
  if (hash.startsWith("#/shell")) return "shell";
  if (hash.startsWith("#/progress")) return "progress";
  if (hash.startsWith("#/docs")) return "docs";
  if (hash.startsWith("#/tables")) return "tables";
  if (hash.startsWith("#/logs")) return "logs";
  if (hash.startsWith("#/kanban") || /^#card-\d+/.test(hash)) return "kanban";
  return "stack";
}

function greeting(hour: number): string {
  if (hour < 5) return "deep in the night watch";
  if (hour < 12) return "good morning";
  if (hour < 18) return "good afternoon";
  return "good evening";
}

/* ----- page chrome: config, clock, theme picker ----- */

function ClockAndTheme({ config }: { config: DashboardConfig | null }) {
  const { themes, active, choose } = useTheme();
  // Null until mounted: time text at prerender time would mismatch the
  // client's clock and fail hydration.
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const time = now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
  const date = now ? now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
  const tz = now ? now.toLocaleTimeString([], { timeZoneName: "short" }).split(" ").pop() || "" : "";

  return (
    <div className="chrome-clock-wrap" ref={popRef}>
      <button
        type="button"
        className="chrome-readout"
        aria-label="Local time and theme picker"
        title="Switch theme"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chrome-readout-time">{time}</span>
        <span className="chrome-readout-meta">
          <span>{date}</span> <span className="chrome-readout-tz">{tz}</span>
        </span>
      </button>
      {open && (
        <div className="chrome-theme-pop" role="dialog" aria-label="theme">
          <h3>theme</h3>
          <p className="chrome-theme-sub">pick a look; the choice is saved to config.json</p>
          <div className="chrome-theme-list">
            {themes.map((t) => (
              <DashboardButton
                key={t.id}
                variant={t.id === active ? "primary" : "secondary"}
                onClick={() => choose(t.id)}
              >
                {t.name}
              </DashboardButton>
            ))}
          </div>
        </div>
      )}
      {config && (
        <span className="chrome-count">{config.services.length} system{config.services.length === 1 ? "" : "s"} nominal</span>
      )}
    </div>
  );
}

/* ----- keys panel ----- */

function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="chrome-dialog-backdrop" onClick={onClose}>
      <div className="chrome-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>keys</h3>
        <pre className="chrome-keys">{"\n b   sitrep        s   stack\n f   files         t   shell\n k   ops board     p   progress\n d   docs          a   tables\n l   access logs   /   search\n ?   this panel    esc close / clear / read"}</pre>
        <DashboardButton variant="ghost" onClick={onClose}>close</DashboardButton>
      </div>
    </div>
  );
}

/* ----- the frame ----- */

function DashboardInner() {
  const { hash, navigate } = useHashRoute();
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // Same hydration guard as the clock: the greeting depends on the hour.
  const [greet, setGreet] = useState("");

  useEffect(() => {
    setGreet(greeting(new Date().getHours()));
    configApi.load()
      .then((data) => {
        setConfig(data);
        if (data.title) document.title = data.title;
      })
      .catch(() => setConfigFailed(true));
    const timer = setInterval(() => setGreet(greeting(new Date().getHours())), 60000);
    return () => clearInterval(timer);
  }, []);

  const viewId = viewForHash(hash);
  const activeView = VIEWS.find((v) => v.id === viewId)!;

  // hotkeys: single letters switch views, / searches, ? opens keys.
  const typing = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a as HTMLElement).isContentEditable) return true;
    return !!(a as HTMLElement).closest(".term, dialog");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const view = VIEWS.find((v) => v.key === e.key.toLowerCase());
      if (view) {
        e.preventDefault();
        navigate(view.hash);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        const id = viewId === "kanban" ? "kanban-search"
          : viewId === "stack" ? "stack-search"
            : viewId === "docs" ? "docs-search" : null;
        if (id) document.getElementById(id)?.focus();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setKeysOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, viewId]);

  const navigation = useMemo<NonNullable<DashboardShellProps["navigation"]>>(() => [{
    id: "main",
    title: "Views",
    items: VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, href: v.hash })),
  }], []);

  const headerActions = (
    <div className="chrome-actions">
      <ClockAndTheme config={config} />
    </div>
  );

  const sidebarFooter = (
    <div className="chrome-foot">
      <button type="button" className="chrome-keys-btn" onClick={() => setKeysOpen(true)}>keys</button>
    </div>
  );

  return (
    <div className="h-dvh">
      <DashboardShell
        brand={{
          name: (config && config.title) || "macmini",
          description: configFailed ? "signal lost" : `${greet} · all systems standing by.`,
        }}
        navigation={navigation}
        sidebarFooter={sidebarFooter}
        title={activeView.label}
        activeItemId={viewId}
        onActiveItemChange={(id) => {
          const view = VIEWS.find((v) => v.id === id);
          if (view) navigate(view.hash);
        }}
        headerActions={headerActions}
        linkComponent={({ href, children, ...props }: { href?: string; children?: React.ReactNode }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) navigate(href);
            }}
            {...props}
          >
            {children}
          </a>
        )}
      >
        <div className="chrome-view h-full">
          <ViewRenderer viewId={viewId} hash={hash} />
        </div>
      </DashboardShell>
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}

function ViewRenderer({ viewId, hash }: { viewId: ViewId; hash: string }) {
  switch (viewId) {
    case "brief":
      return <SitrepView />;
    case "stack":
      return <StackView active />;
    case "files":
      return <FilesView active />;
    case "shell":
      return <ShellView active />;
    case "kanban":
      return <KanbanView active />;
    case "progress":
      return <ProgressView active />;
    case "docs": {
      const openPrefix = decodeURIComponent(hash.replace(/^#\/docs\/?/, ""));
      return <DocsView openPrefix={openPrefix} />;
    }
    case "tables":
      return <TablesView active />;
    case "logs":
      return <LogsView active />;
  }
}

export function Dashboard() {
  return (
    <ThemeProvider>
      <ModalProvider>
        <DashboardInner />
      </ModalProvider>
    </ThemeProvider>
  );
}
