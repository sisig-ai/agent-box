"use client";

// Theme system: the server registry (static/themes.json via /api/themes)
// persists the chosen id in config.json. The React app maps each id onto a
// palette of CSS custom properties on <html data-theme>, plus the `dark`
// class ObsidianUI components switch on. A missing id falls back to the
// default. Styling stays in globals.css; this file only owns state.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { themeApi, type Theme } from "@/lib/api";

export interface ThemeState {
  themes: Theme[];
  active: string;
  busy: boolean;
  choose: (id: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeState>({
  themes: [],
  active: "board-dark",
  busy: false,
  choose: async () => {},
});

// Themes marked dark get the `dark` class so obsidianui palettes flip.
const DARK_THEMES = new Set(["board-dark"]);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [active, setActive] = useState("board-dark");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    themeApi.list()
      .then((data) => {
        if (cancelled) return;
        setThemes(data.themes || []);
        if (data.active) setActive(data.active);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = active;
    root.classList.toggle("dark", DARK_THEMES.has(active));
  }, [active]);

  const choose = useCallback(async (id: string) => {
    setActive(id); // live repaint even if the save fails
    setBusy(true);
    try {
      await themeApi.set(id);
    } catch {
      // saved state and the live look may diverge until reload
    }
    setBusy(false);
  }, []);

  return (
    <ThemeContext.Provider value={{ themes, active, busy, choose }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
