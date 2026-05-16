"use server";

import { cookies } from "next/headers";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  isTheme,
  type Theme,
} from "@/lib/theme";

// ---------------------------------------------------------------------------
// Theme server actions (Phase 11 chunk 12).
//
// Split from lib/theme.ts so the utilities there (getTheme,
// noFlashScript, THEME_COOKIE, isTheme) can be imported from server
// components without flipping every export into a server-action RPC
// reference.
// ---------------------------------------------------------------------------

/**
 * Persist the user's theme preference. Cookie attributes:
 *   - `path: "/"`         so it covers every route
 *   - `sameSite: "lax"`   so it survives top-level navigations
 *   - `maxAge` ~1 year
 *   - `httpOnly: false`   so the inline no-flash script in <head> can
 *     read it pre-hydration. The value is non-sensitive (it just
 *     selects which palette to render).
 */
export async function setThemeAction(next: Theme): Promise<void> {
  if (!isTheme(next)) return;
  const store = await cookies();
  store.set(THEME_COOKIE, next, {
    path: "/",
    sameSite: "lax",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  });
}
