"use client";

import { useSyncExternalStore, useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  readThemeCookieClient,
  writeThemeCookieClient,
  type Theme,
} from "@/lib/theme-shared";
import { setThemeAction } from "@/lib/theme-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ThemePreference — the Settings-page control for the dark/light/system
// palette. This is now the ONLY place a user changes the theme (the old
// header toggle was removed).
//
// Persistence mirrors the previous toggle exactly: the `cardforge-theme`
// cookie is the source of truth. We update the DOM + cookie synchronously
// for instant feedback, then fire setThemeAction() to persist it
// authoritatively. The cookie is read as an external store so the server
// snapshot is always "dark" (matching the no-flash default) and React swaps
// in the real value right after hydration.
// ---------------------------------------------------------------------------

const themeListeners = new Set<() => void>();

function subscribeToTheme(callback: () => void): () => void {
  themeListeners.add(callback);
  return () => {
    themeListeners.delete(callback);
  };
}

function notifyThemeChanged(): void {
  for (const listener of [...themeListeners]) listener();
}

function serverThemeSnapshot(): Theme {
  return "dark";
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    const prefersLight =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    root.dataset.theme = prefersLight ? "light" : "dark";
  } else {
    root.dataset.theme = theme;
  }
}

const OPTIONS: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemePreference() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    readThemeCookieClient,
    serverThemeSnapshot,
  );
  const [, startTransition] = useTransition();

  const select = (next: Theme) => {
    if (next === theme) return;
    applyThemeToDocument(next);
    writeThemeCookieClient(next);
    notifyThemeChanged();
    startTransition(() => {
      void setThemeAction(next);
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex w-full max-w-sm gap-1 rounded-md border border-border/60 bg-background/40 p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = value === theme;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
              active
                ? "bg-elevated text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
