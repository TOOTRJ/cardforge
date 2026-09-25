// ---------------------------------------------------------------------------
// Funnel instrumentation — the vocabulary. Client-safe (no server imports).
//
// Server events are written where the money moves (lib/stripe/actions.ts,
// lib/stripe/webhook-handlers.ts). Client events are the steps only the
// browser sees, posted to /api/events. Both land in funnel_events (0112) and
// the admin Funnel panel reads them; client events are also mirrored to
// Vercel Analytics and GA4 when those are configured.
//
// Props are allow-listed — short scalars only, never free text, never an
// email or a name — so a row can't carry anything a viewer typed.
// ---------------------------------------------------------------------------

export const SERVER_FUNNEL_EVENTS = [
  // Signup + activation (owner decision 2026-09-24): the first save, first
  // AI generation and first download are recorded once per user and kept
  // forever; the plain activity rows feed trial engagement and age out.
  "signup",
  "card_saved",
  "ai_generation",
  "download",
  "first_card_saved",
  "first_ai_generation",
  "first_download",
  "checkout_started",
  "checkout_completed",
  "checkout_expired",
  "trial_started",
  "trial_converted",
  "trial_lapsed",
  "subscription_started",
  "subscription_changed",
  "subscription_cancelled",
  "payment_received",
  "payment_failed",
  "pack_purchased",
] as const;

export const CLIENT_FUNNEL_EVENTS = [
  "pricing_view",
  "cta_click",
  "upgrade_modal_open",
] as const;

export type ServerFunnelEvent = (typeof SERVER_FUNNEL_EVENTS)[number];

/** Activity a user does with the product; each has a once-per-user "first". */
export const ACTIVITY_KINDS = ["card_saved", "ai_generation", "download"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const FIRST_EVENT: Record<ActivityKind, ServerFunnelEvent> = {
  card_saved: "first_card_saved",
  ai_generation: "first_ai_generation",
  download: "first_download",
};

/** Per-user milestones the prune cron never deletes. */
export const PERMANENT_FUNNEL_EVENTS = [
  "signup",
  "first_card_saved",
  "first_ai_generation",
  "first_download",
] as const;
export type ClientFunnelEvent = (typeof CLIENT_FUNNEL_EVENTS)[number];
export type FunnelEvent = ServerFunnelEvent | ClientFunnelEvent;

export type FunnelProps = Record<string, string | number | boolean>;

const PROP_KEYS = new Set([
  "kind", "tier", "period", "pack", "surface", "reason", "trial", "discount",
  "signedIn", "mode", "interval", "amountCents", "credits", "billingReason",
  "cancelReason", "cancelFeedback", "attempt", "fromTier", "toTier",
  "scheduled", "sessionId", "subscriptionId",
  "referrer", "utmSource", "utmMedium", "utmCampaign",
  "visibility", "format", "layout", "preset", "clean",
]);
const MAX_PROPS = 10;
const MAX_STRING = 48;

export function isClientFunnelEvent(value: unknown): value is ClientFunnelEvent {
  return typeof value === "string" && (CLIENT_FUNNEL_EVENTS as readonly string[]).includes(value);
}

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return (
    isClientFunnelEvent(value) ||
    (typeof value === "string" && (SERVER_FUNNEL_EVENTS as readonly string[]).includes(value))
  );
}

/** Keep only allow-listed keys with short scalar values. */
export function sanitizeFunnelProps(input: unknown): FunnelProps {
  const out: FunnelProps = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!PROP_KEYS.has(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value * 100) / 100;
    else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && trimmed.length <= MAX_STRING && /^[\w .:@/-]+$/.test(trimmed)) out[key] = trimmed;
    }
    if (Object.keys(out).length >= MAX_PROPS) break;
  }
  return out;
}
