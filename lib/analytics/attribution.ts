// ---------------------------------------------------------------------------
// Signup attribution — first touch, per tab, no cookie (owner decision
// 2026-09-24). A tiny client snippet stores the landing referrer host and
// the UTM source/medium/campaign in sessionStorage the first time a tab
// opens the site; the signup form posts them as hidden fields; the signup
// action validates and records a `signup` funnel event. Nothing leaves the
// browser until the user signs up, and the tab closing forgets it.
// `surface` is the one LAST-touch field (owner 2026-11-04): the create
// button the visitor pressed most recently before signing up
// (`rememberSignupSurface`), so the funnel can say which button converts.
// Client-safe; the server reuses the sanitizer.
// ---------------------------------------------------------------------------

import { REFERRAL_PARAM, normalizeReferralCode } from "@/lib/referrals/rules";

export const ATTRIBUTION_STORAGE_KEY = "pg_attribution_v1";

/** The referral code alone, kept in the browser PAST the tab (owner
 *  2026-11-11): localStorage, for REFERRAL_CODE_KEEP_DAYS. sessionStorage
 *  dies with the tab — the tab closed and the site opened again later, the
 *  account made in another tab — and the code died with it. (It does NOT
 *  reach another browser: a link opened inside an app's built-in browser
 *  and an account made in the real one share no storage; that case is what
 *  the typed code is for.) Not a cookie: it is never
 *  sent anywhere by itself; the sign-up form and onboarding read it. It
 *  holds the code and the day it was kept, nothing else. */
export const REFERRAL_CODE_STORAGE_KEY = "pg_referral_code_v1";
export const REFERRAL_CODE_KEEP_DAYS = 30;

/** What is written under REFERRAL_CODE_STORAGE_KEY for a code kept `now`. */
export function referralCodeToKeep(code: string, now: number): string {
  return JSON.stringify({ code, at: now });
}

/** The code a stored value still holds at `now`: undefined when there is
 *  none, it is not a code, or it was kept longer ago than the keep days. */
export function keptReferralCode(raw: string | null | undefined, now: number): string | undefined {
  if (!raw) return undefined;
  try {
    const stored = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = normalizeReferralCode(stored.code);
    const at = typeof stored.at === "number" && Number.isFinite(stored.at) ? stored.at : null;
    if (!code || at == null) return undefined;
    const age = now - at;
    return age >= 0 && age <= REFERRAL_CODE_KEEP_DAYS * 86_400_000 ? code : undefined;
  } catch {
    return undefined;
  }
}

export type Attribution = {
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** The create button pressed last before signing up (`CTA_SURFACES`). */
  surface?: string;
  /** A referral link's code (`?ref=`, lib/referrals/rules.ts) — the friend
   *  who sent it. Rides the same first-touch blob and hidden field; never a
   *  funnel prop (the signup action turns it into a `referrals` row). */
  ref?: string;
};

/** Form field names the signup form posts (hidden inputs). */
export const ATTRIBUTION_FIELDS: Record<keyof Attribution, string> = {
  referrer: "attr_referrer",
  utmSource: "attr_utm_source",
  utmMedium: "attr_utm_medium",
  utmCampaign: "attr_utm_campaign",
  surface: "attr_surface",
  ref: "attr_ref",
};

const MAX = 48;
const SAFE = /^[\w .:@/-]+$/;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase().slice(0, MAX);
  return v && SAFE.test(v) ? v : undefined;
}

/** Keep only the known fields, lowercased, short, safe characters (a
 *  referral code: exactly its shape). */
export function sanitizeAttribution(raw: Record<string, unknown> | null | undefined): Attribution {
  const out: Attribution = {};
  if (!raw) return out;
  const referrer = clean(raw.referrer);
  const utmSource = clean(raw.utmSource);
  const utmMedium = clean(raw.utmMedium);
  const utmCampaign = clean(raw.utmCampaign);
  const surface = clean(raw.surface);
  if (referrer) out.referrer = referrer;
  if (utmSource) out.utmSource = utmSource;
  if (utmMedium) out.utmMedium = utmMedium;
  if (utmCampaign) out.utmCampaign = utmCampaign;
  if (surface) out.surface = surface;
  const ref = normalizeReferralCode(raw.ref);
  if (ref) out.ref = ref;
  return out;
}

/** The stored attribution with the button just pressed as its `surface` —
 *  the first-touch fields kept as they were. Pure: the storage write is
 *  `rememberSignupSurface`'s. */
export function withSignupSurface(stored: Record<string, unknown> | null | undefined, surface: string): Attribution {
  const next = sanitizeAttribution({ ...(stored ?? {}), surface });
  if (!next.surface) delete next.surface;
  return next;
}

/** Remember the create button a visitor pressed, for the signup that may
 *  follow (sessionStorage, the same blob as the first touch; never a
 *  cookie). Browser only; a storage failure loses the label, nothing else. */
export function rememberSignupSurface(surface: string): void {
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(withSignupSurface(stored, surface)));
  } catch {
    // Storage unavailable (private mode, blocked) — attribution is optional.
  }
}

/** The button label the admin panel groups by. */
export function attributionSurface(a: Attribution): string {
  return a.surface ?? "none";
}

/** What a landing looks like: the referrer's host (external only) and the
 *  UTM parameters — pure so it can be tested. */
export function attributionFromLanding(input: {
  referrer: string;
  search: string;
  ownHost: string;
}): Attribution {
  let referrer: string | undefined;
  try {
    const host = input.referrer ? new URL(input.referrer).hostname.replace(/^www\./, "") : "";
    const own = input.ownHost.replace(/^www\./, "");
    if (host && host !== own && !host.endsWith(`.${own}`)) referrer = host;
  } catch {
    referrer = undefined;
  }
  const params = new URLSearchParams(input.search);
  return sanitizeAttribution({
    referrer,
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    ref: params.get(REFERRAL_PARAM),
  });
}

/**
 * The first-touch blob after another landing in the same tab: the first
 * touch is kept as it was, but a referral code the tab doesn't hold yet is
 * added (someone browsing, then opening a friend's link). The FIRST code
 * wins — a later link never takes a referral over.
 */
export function mergeLandingAttribution(stored: Attribution | null, landing: Attribution): Attribution {
  if (!stored) return landing;
  if (stored.ref || !landing.ref) return stored;
  return { ...stored, ref: landing.ref };
}

/** The signup event's props: attribution without the referral code (the
 *  code is a `referrals` row, not an analytics prop). */
export function attributionProps(a: Attribution): Omit<Attribution, "ref"> & { referred?: boolean } {
  const { ref, ...rest } = a;
  return ref ? { ...rest, referred: true } : rest;
}

/** The source label the admin panel groups by. */
export function attributionSource(a: Attribution): string {
  return a.utmSource ?? a.referrer ?? "direct";
}
