// ---------------------------------------------------------------------------
// Signup attribution — first touch, per tab, no cookie (owner decision
// 2026-09-24). A tiny client snippet stores the landing referrer host and
// the UTM source/medium/campaign in sessionStorage the first time a tab
// opens the site; the signup form posts them as hidden fields; the signup
// action validates and records a `signup` funnel event. Nothing leaves the
// browser until the user signs up, and the tab closing forgets it.
// Client-safe; the server reuses the sanitizer.
// ---------------------------------------------------------------------------

export const ATTRIBUTION_STORAGE_KEY = "pg_attribution_v1";

export type Attribution = {
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

/** Form field names the signup form posts (hidden inputs). */
export const ATTRIBUTION_FIELDS: Record<keyof Attribution, string> = {
  referrer: "attr_referrer",
  utmSource: "attr_utm_source",
  utmMedium: "attr_utm_medium",
  utmCampaign: "attr_utm_campaign",
};

const MAX = 48;
const SAFE = /^[\w .:@/-]+$/;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase().slice(0, MAX);
  return v && SAFE.test(v) ? v : undefined;
}

/** Keep only the four fields, lowercased, short, safe characters. */
export function sanitizeAttribution(raw: Record<string, unknown> | null | undefined): Attribution {
  const out: Attribution = {};
  if (!raw) return out;
  const referrer = clean(raw.referrer);
  const utmSource = clean(raw.utmSource);
  const utmMedium = clean(raw.utmMedium);
  const utmCampaign = clean(raw.utmCampaign);
  if (referrer) out.referrer = referrer;
  if (utmSource) out.utmSource = utmSource;
  if (utmMedium) out.utmMedium = utmMedium;
  if (utmCampaign) out.utmCampaign = utmCampaign;
  return out;
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
  });
}

/** The source label the admin panel groups by. */
export function attributionSource(a: Attribution): string {
  return a.utmSource ?? a.referrer ?? "direct";
}
