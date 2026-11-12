"use client";
import { useEffect, useRef } from "react";

type HotkeyMap = Record<string, () => void>;

export function useHotkeys(keys: HotkeyMap) {
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      
      const fn = keysRef.current[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}