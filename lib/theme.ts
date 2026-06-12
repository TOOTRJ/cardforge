// Server-side theme access (Phase 11 chunk 12). The constants, types, and
// pure helpers live in lib/theme-shared.ts (client-safe) and are
// re-exported here so existing `@/lib/theme` imports keep working in
// server code. Client components should import from lib/theme-shared.

import { cookies } from "next/headers";
import { THEME_COOKIE, isTheme, type Theme } from "./theme-shared";

export {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  isTheme,
  noFlashScript,
  resolveThemeForServer,
  readThemeCookieClient,
  type Theme,
  type ResolvedTheme,
} from "./theme-shared";

/**
 * Read the user's theme preference from the cookie. Defaults to "dark".
 *
 * NOTE: calling this opts the rendering route out of static generation —
 * the root layout and AppShell deliberately do NOT call it (the no-flash
 * script + the toggle's client-side cookie read handle theming without a
 * server cookie read). Only use it where the route is already dynamic.
 */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : "dark";
}
