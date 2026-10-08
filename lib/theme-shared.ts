// Theme constants + pure helpers, safe for BOTH client and server imports
// (the server action that writes the cookie is lib/theme-actions.ts).
//
// Persistence model:
//   - User preference lives in a `cardforge-theme` cookie. Values:
//       "dark"   — force dark
//       "light"  — force light
//       "system" — follow the OS / browser via prefers-color-scheme
//     Missing cookie defaults to "dark" (the brand surface).
//   - The cookie is set by the server action in lib/theme-actions.ts and
//     is deliberately NOT httpOnly so the inline no-flash script and the
//     Settings control can read it.
//
// Render model:
//   - The root layout renders `data-theme="dark"` unconditionally (it
//     reads no cookies, so the shell HTML is cacheable). The inline
//     no-flash script re-evaluates the cookie + prefers-color-scheme on
//     the client and overwrites data-theme before the stylesheet
//     evaluates — light-theme users never see a dark flash.
//   - That script only runs in HTML the SERVER sent. A document React
//     renders in the browser (a notFound() above the Suspense boundaries,
//     an error there, a hydration it gives up on) gets the layout's
//     data-theme="dark" and a script that is never executed;
//     components/layout/theme-restore.tsx puts the saved theme back.
//   - The dark @theme block in globals.css is the baseline; the
//     `:root[data-theme="light"]` block overrides each token.
//
// ONE resolution, in two forms that must agree case for case:
// noFlashScript() — a string, because it has to run before anything is
// loaded — and resolveSavedTheme(), which everything else calls. A page
// where they disagreed would repaint right after hydration;
// tests/unit/lib/theme-resolution.test.ts runs the script against the
// function. Never read the cookie or prefers-color-scheme anywhere else.

export const THEME_COOKIE = "cardforge-theme";

export type Theme = "dark" | "light" | "system";
/** What `<html data-theme>` carries: "system" resolved against the OS. */
export type ResolvedTheme = Exclude<Theme, "system">;

const THEME_VALUES: ReadonlySet<Theme> = new Set(["dark", "light", "system"]);
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_VALUES.has(value as Theme);
}

/** The saved preference as the no-flash script reads it: no cookie is
 *  "dark", any value that is neither "dark" nor "light" follows the OS
 *  ("system"), and a cookie that cannot be read or decoded is "dark" (the
 *  script gives up there and the server's attribute stays). Never throws —
 *  the root layout runs it on every page. Returns "dark" outside the
 *  browser. */
export function readThemeCookieClient(): Theme {
  if (typeof document === "undefined") return "dark";
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`),
    );
    const value = match ? decodeURIComponent(match[1]) : "dark";
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "dark";
  }
}

/** "system" follows the OS; "dark" and "light" are themselves. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  try {
    return typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/** The theme this visitor's document should carry right now — exactly what
 *  the no-flash script writes. */
export function resolveSavedTheme(): ResolvedTheme {
  return resolveTheme(readThemeCookieClient());
}

/** Paint a preference now (the Settings control's instant feedback). */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(theme);
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
