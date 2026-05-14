"use client";

import { useState, useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme } from "@/lib/theme";
import { setThemeAction } from "@/lib/theme-actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ThemeToggle — cycles through dark → light → system → dark.
//
// We update the DOM immediately (`document.documentElement.dataset.theme`)
// so the visual change is instant, then fire the server action to
// persist the cookie. The action is wrapped in startTransition so the
// route refresh that follows the cookie write doesn't block the click.
//
// The icon reflects the EFFECTIVE theme — Sun when light, Moon when
// dark, Monitor when system. For "system" we also recompute on each
// click in case the OS preference changed since mount.
// ---------------------------------------------------------------------------

const THEME_ORDER: Theme[] = ["dark", "light", "system"];

const LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const ICONS: Record<
  Theme,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

type ThemeToggleProps = {
  initialTheme: Theme;
  className?: string;
};

export function ThemeToggle({ initialTheme, className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [, startTransition] = useTransition();

  const cycle = () => {
    const idx = THEME_ORDER.indexOf(theme);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];

    // Instant DOM update — the inline no-flash script in <head> set the
    // initial data-theme; from here on the toggle is the authority.
    applyThemeToDocument(next);
    setTheme(next);

    startTransition(() => {
      void setThemeAction(next);
    });
  };

  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[theme]}. Click to cycle.`}
      title={`Theme: ${LABELS[theme]}`}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-elevated text-muted transition-colors hover:border-border-strong hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
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
