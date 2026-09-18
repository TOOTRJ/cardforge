// ---------------------------------------------------------------------------
// Username rules shared by the signup, onboarding and settings forms.
//
// The DB is the authority (migration 0094): profiles.username is NOT NULL,
// UNIQUE, lowercase `[a-z0-9_]{3,32}`, and is_reserved_username() backs a
// guard trigger. This list mirrors that SQL function so the forms can answer
// with a field error instead of a constraint failure — keep the two in sync.
// Client-safe: no server imports.
// ---------------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

const RESERVED = new Set([
  // staff / impersonation
  "admin", "administrator", "pipglyph", "pipglyph_team", "pipglyph_admin",
  "support", "help", "staff", "team", "moderator", "mod", "mods", "official",
  "system", "root", "owner", "security", "billing", "abuse", "legal",
  "wizards", "wotc", "hasbro",
  // placeholders
  "null", "undefined", "anonymous", "deleted", "unknown", "everyone", "here",
  "user", "username", "guest", "test",
  // route words
  "api", "www", "app", "auth", "login", "logout", "signup", "signin",
  "register", "settings", "dashboard", "onboarding", "profile", "profiles",
  "gallery", "create", "card", "cards", "deck", "decks", "set", "sets",
  "feed", "news", "pricing", "press", "privacy", "terms", "about",
  "messages", "notifications", "feedback", "unsubscribe", "new", "edit",
]);

export function isReservedUsername(value: string): boolean {
  return RESERVED.has(value.trim().toLowerCase());
}

/** Handles minted by generate_username() (migration 0094) for signups that
 *  didn't choose one — "ember_sphinx_4821", or the "mage_<hex>" fallback.
 *  Onboarding uses this to nudge the user to claim a real one. */
export function isGeneratedUsername(value: string | null | undefined): boolean {
  if (!value) return true;
  return /^[a-z]+_[a-z]+_\d{4}$/.test(value) || /^mage_[0-9a-f]{16}$/.test(value);
}
