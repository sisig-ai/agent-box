"use client";

// Stack view: the service grid with its scanner input, sitting under the
// three live telemetry cards. Ported from static/js/stack/view.js; URL
// resolution, monograms, and the well-known port map carried over exactly.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { configApi, type ServiceConfig } from "@/lib/api";
import { TelemetryCards } from "@/components/views/telemetry-cards";
import { useStatsPoll } from "@/hooks/use-stats-poll";
import "./telemetry.css";

// Well-known ports for the bundled *arr stack, used when a service has no URL.
const PORTS: Record<string, { port: number; path?: string }> = {
  plex: { port: 32400, path: "/web" },
  sonarr: { port: 8989 },
  radarr: { port: 7878 },
  prowlarr: { port: 9696 },
  deluge: { port: 8112 },
  bazarr: { port: 6767 },
  lidarr: { port: 8686 },
  readarr: { port: 8787 },
  jellyfin: { port: 8096 },
  overseerr: { port: 5055 },
  tautulli: { port: 8181 },
  transmission: { port: 9091 },
  qbittorrent: { port: 8080 },
  flaresolverr: { port: 8191 },
};

interface ResolvedService {
  name: string;
  description?: string;
  url: string;
  port: string;
  glyph: string;
  search: string;
  color?: string;
}

// Where a card points: an explicit remote URL wins (port parsed from it),
// then an explicit port, then the well-known map by (icon || name), and
// finally the configured url verbatim (or "#").
function resolve(service: ServiceConfig, host: string): { url: string; port: string } {
  if (service.url && !service.url.includes("localhost")) {
    let port = "";
    try {
      port = new URL(service.url).port;
    } catch {
      // leave blank
    }
    return { url: service.url, port };
  }
  if (service.port) {
    return { url: `http://${host}:${service.port}${service.path || ""}`, port: String(service.port) };
  }
  const known = PORTS[String(service.icon || service.name).toLowerCase()];
  if (known) return { url: `http://${host}:${known.port}${known.path || ""}`, port: String(known.port) };
  return { url: service.url || "#", port: "" };
}

// Text monogram: two initials for a multi-word name, first two letters otherwise.
function glyphOf(service: ServiceConfig): string {
  const words = String(service.name || "?").trim().split(/\s+/);
  return words.length > 1
    ? words
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
    : String(service.name || "?").trim().slice(0, 2);
}

/* ----- the scanner input ----- */

interface ScannerProps {
  query: string;
  onQuery: (q: string) => void;
  onEnter: () => void;
}

function Scanner({ query, onQuery, onEnter }: ScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the scanner from anywhere on the stack view; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (document.activeElement as HTMLElement | null)?.tagName ?? "",
      );
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scanner">
      <span className="glyph" aria-hidden="true">&gt;</span>
      <input
        ref={inputRef}
        id="search"
        type="text"
        placeholder="scan for a system…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search services"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onQuery("");
            inputRef.current?.blur();
          } else if (e.key === "Enter") {
            onEnter();
          }
        }}
      />
      <span className="kbd" aria-hidden="true">/</span>
    </div>
  );
}

/* ----- the view ----- */

export function StackView({ active }: { active: boolean }) {
  const [services, setServices] = useState<ResolvedService[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const poll = useStatsPoll();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    configApi
      .load()
      .then((config) => {
        if (cancelled) return;
        const host = window.location.hostname;
        setServices(
          (config.services || []).map((service) => {
            const { url, port } = resolve(service, host);
            return {
              ...service,
              url,
              port,
              glyph: glyphOf(service),
              search: `${service.name} ${service.description || ""} ${port}`.toLowerCase(),
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !services) return services ?? [];
    return services.filter((service) => service.search.includes(q));
  }, [services, query]);

  const emptyText = failed
    ? "// no contact with config.json"
    : !services
      ? "// scanning…"
      : query.trim()
        ? `// no system matches "${query.trim()}"`
        : "// nothing to show";

  const openFirst = () => {
    const first = visible[0];
    if (first && first.url && first.url !== "#") window.open(first.url, "_blank", "noopener");
  };

  return (
    <div className="stack-view">
      <TelemetryCards poll={poll} />
      <Scanner query={query} onQuery={setQuery} onEnter={openFirst} />
      <div className="stack-grid" id="services">
        {visible.map((service, index) => (
          <a
            key={service.name}
            className="stack-card"
            href={service.url}
            target="_blank"
            rel="noopener"
            style={{ "--i": index, ...(service.color ? ({ "--accent": service.color } as CSSProperties) : {}) } as CSSProperties}
          >
            <span className="stack-pod">{service.glyph}</span>
            <span className="stack-info">
              <span className="stack-name">{service.name}</span>
              <span className="stack-meta">
                {service.description && <span className="stack-description">{service.description}</span>}
                {service.port && <span className="stack-port">{`:${service.port}`}</span>}
              </span>
            </span>
            <span className="stack-chevron" aria-hidden="true">→</span>
          </a>
        ))}
        {visible.length === 0 && (
          <p className="stack-empty">{emptyText}</p>
        )}
      </div>
    </div>
  );
}
