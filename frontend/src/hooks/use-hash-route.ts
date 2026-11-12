"use client";
import { useEffect, useState } from "react";

// The export is prerendered with the default route ("#/"), so the hash state
// starts as that during hydration and only reads the real location once the
// client has taken over — otherwise any deep link (#/kanban/card-4) would
// fail hydration against the prerendered tree.
export function useHashRoute() {
  const [hash, setHash] = useState("#/");

  useEffect(() => {
    const read = () => setHash(window.location.hash || "#/");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const navigate = (newHash: string) => {
    window.location.hash = newHash;
  };

  return { hash, navigate };
}
