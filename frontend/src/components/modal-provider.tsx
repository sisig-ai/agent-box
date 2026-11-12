"use client";

// Shared prompt/confirm modal (the old fs-modal): promise-based, one instance
// mounted in the dashboard layout. Usage: const name = await openModal({...}).

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { DashboardButton } from "@/components/block/dashboard-shell";

export interface ModalOptions {
  title: string;
  text?: string;
  input?: boolean;
  value?: string;
  placeholder?: string;
  ok?: string;
  danger?: boolean;
}

interface ModalState extends ModalOptions {
  open: boolean;
  resolve: (value: string | boolean | null) => void;
}

const ModalContext = createContext<(opts: ModalOptions) => Promise<string | boolean | null>>(
  async () => null,
);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ModalState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback((opts: ModalOptions) => {
    return new Promise<string | boolean | null>((resolve) => {
      setState({ ...opts, open: true, resolve });
      setTimeout(() => {
        if (opts.input) inputRef.current?.focus(), inputRef.current?.select();
      }, 0);
    });
  }, []);

  const close = useCallback((value: string | boolean | null) => {
    setState((prev) => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  const current = state;

  return (
    <ModalContext.Provider value={open}>
      {children}
      {current && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4"
          onClick={() => close(current.input ? null : false)}
        >
          <div
            className="w-full max-w-sm rounded-[10px] border border-(--obsidian-dashboard-shell-border) bg-(--obsidian-dashboard-shell-control) p-4 shadow-(--obsidian-dashboard-shell-menu-shadow)"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-(--obsidian-dashboard-shell-foreground)">
              {current.title}
            </h3>
            {current.text && (
              <p className="mt-2 whitespace-pre-wrap text-xs text-(--obsidian-dashboard-shell-text-muted)">
                {current.text}
              </p>
            )}
            {current.input && (
              <input
                ref={inputRef}
                type="text"
                defaultValue={current.value || ""}
                placeholder={current.placeholder || ""}
                spellCheck={false}
                autoFocus
                className="mt-3 w-full rounded-md border border-(--obsidian-dashboard-shell-border) bg-(--obsidian-dashboard-shell-background) px-2.5 py-1.5 text-sm text-(--obsidian-dashboard-shell-foreground) outline-none focus:border-(--obsidian-dashboard-shell-accent)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    close(inputRef.current?.value.trim() ?? null);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    close(null);
                  }
                }}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <DashboardButton variant="ghost" onClick={() => close(null)}>cancel</DashboardButton>
              <DashboardButton
                variant={current.danger ? "danger" : "primary"}
                onClick={() => close(current.input ? (inputRef.current?.value.trim() ?? null) : true)}
              >
                {current.ok || "OK"}
              </DashboardButton>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  return useContext(ModalContext);
}
