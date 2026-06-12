// Theme constants + pure helpers, safe for BOTH client and server imports.
// (lib/theme.ts holds the server-only cookie reader and re-exports all of
// this for back-compat.)
//
// Persistence model:
//   - User preference lives in a `cardforge-theme` cookie. Values:
//       "dark"   — force dark
//       "light"  — force light
//       "system" — follow the OS / browser via prefers-color-scheme
//     Missing cookie defaults to "dark" (the brand surface).
//   - The cookie is set by the server action in lib/theme-actions.ts and
//     is deliberately NOT httpOnly so the inline no-flash script and the
//     header toggle can read it.
//
// Render model:
//   - The root layout renders `data-theme="dark"` unconditionally (it
//     reads no cookies, so the shell HTML is cacheable). The inline
//     no-flash script re-evaluates the cookie + prefers-color-scheme on
//     the client and overwrites data-theme before the stylesheet
//     evaluates — light-theme users never see a dark flash.
//   - The dark @theme block in globals.css is the baseline; the
//     `:root[data-theme="light"]` block overrides each token.

export const THEME_COOKIE = "cardforge-theme";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const THEME_VALUES: ReadonlySet<Theme> = new Set(["dark", "light", "system"]);
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_VALUES.has(value as Theme);
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

/** Client-side cookie read for the header toggle — mirrors the no-flash
 *  script's parsing. Returns "dark" outside the browser. */
export function readThemeCookieClient(): Theme {
  if (typeof document === "undefined") return "dark";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`),
  );
  const value = match ? decodeURIComponent(match[1]) : "dark";
  return isTheme(value) ? value : "dark";
}

/** Client-side cookie write — the toggle's optimistic persistence (the
 *  server action re-sets the same cookie authoritatively). Attributes
 *  mirror lib/theme-actions.ts. */
export function writeThemeCookieClient(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
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
  // No cookie -> "dark" (brand default). Explicit "system" still follows
  // the OS preference; explicit "dark"/"light" win unchanged.
  return `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);var t=m?decodeURIComponent(m[1]):"dark";var resolved=t==="light"||t==="dark"?t:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=resolved;}catch(e){}})();`;
}
