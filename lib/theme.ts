// Theme helpers (Phase 11 chunk 12).
//
// Persistence model:
//   - User preference lives in a `cardforge-theme` cookie. Values:
//       "dark"   — force dark
//       "light"  — force light
//       "system" — follow the OS / browser via prefers-color-scheme
//     Missing cookie defaults to "system".
//   - The cookie is set by the server action exported below. Client code
//     can mirror the change to `document.documentElement.dataset.theme`
//     for an instant visual update without waiting for the round-trip.
//
// Render model:
//   - The root layout reads the cookie + (when "system") falls back to
//     "dark" on the server because there's no way to read
//     prefers-color-scheme from a server component. The inline no-flash
//     script in `<head>` re-evaluates on the client and overwrites
//     data-theme before first paint.
//   - The dark @theme block in globals.css is the baseline; the
//     `:root[data-theme="light"]` block overrides each token. No
//     selector explicitly targets "dark" — its rules are the root.

import { cookies } from "next/headers";

export const THEME_COOKIE = "cardforge-theme";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const THEME_VALUES: ReadonlySet<Theme> = new Set(["dark", "light", "system"]);
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_VALUES.has(value as Theme);
}

/** Read the user's theme preference from the cookie. Defaults to "system". */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : "system";
}

/**
 * Resolve "system" to a concrete dark/light on the server. Without
 * access to prefers-color-scheme we conservatively render dark and let
 * the client's inline script fix it up before first paint.
 */
export function resolveThemeForServer(theme: Theme): ResolvedTheme {
  if (theme === "light") return "light";
  return "dark";
}

/**
 * Returns the inline script that runs in `<head>` to set
 * `<html data-theme>` before CSS evaluates — eliminates FOUC for users
 * whose preference doesn't match the server-rendered default.
 *
 * The script is intentionally tiny and synchronous; it must execute
 * before stylesheet parse so the right OKLCH palette applies on first
 * paint.
 */
export function noFlashScript(): string {
  return `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);var t=m?decodeURIComponent(m[1]):"system";var resolved=t==="light"||t==="dark"?t:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=resolved;}catch(e){}})();`;
}
