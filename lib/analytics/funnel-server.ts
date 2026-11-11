import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  FIRST_EVENT,
  isFunnelEvent,
  sanitizeFunnelProps,
  type ActivityKind,
  type FunnelEvent,
  type FunnelProps,
} from "./funnel-events";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Postgres' unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Write one funnel row. Best effort by design: instrumentation must never
 * fail a checkout or a webhook, so every error is logged and swallowed.
 * Returns the row id (the checkout action stamps it into Stripe metadata so
 * the later webhook rows can be tied back to the click).
 */
export async function recordFunnelEvent(
  admin: AdminClient,
  input: {
    event: FunnelEvent;
    userId?: string | null;
    props?: FunnelProps | Record<string, unknown>;
    source?: "server" | "client";
  },
): Promise<string | null> {
  if (!isFunnelEvent(input.event)) return null;
  try {
    const { data, error } = await admin
      .from("funnel_events")
      .insert({
        event: input.event,
        user_id: input.userId ?? null,
        props: sanitizeFunnelProps(input.props ?? {}),
        source: input.source ?? "server",
      })
      .select("id")
      .single();
    if (error) {
      // 23505: a once-per-user event this user already has (0197's unique
      // index on signup and the three firsts) — recorded, just not by this
      // call. Anything else is worth a line.
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) {
        console.warn(`[funnel] ${input.event} not recorded:`, error.message);
      }
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    console.warn(`[funnel] ${input.event} not recorded:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * An activity row (card_saved / ai_generation / download) plus, the first
 * time this user does it, the matching once-per-user milestone
 * (first_card_saved / …). The milestone is what the Activation section and
 * time-to-value read; the activity rows feed trial engagement. Best effort,
 * like every funnel write. Answers true when THIS call wrote the milestone.
 */
export async function recordActivity(
  admin: AdminClient,
  input: { userId: string; kind: ActivityKind; props?: FunnelProps | Record<string, unknown> },
): Promise<boolean> {
  await recordFunnelEvent(admin, { event: input.kind, userId: input.userId, props: input.props });
  const first = FIRST_EVENT[input.kind];
  try {
    const { data } = await admin
      .from("funnel_events")
      .select("id")
      .eq("user_id", input.userId)
      .eq("event", first)
      .limit(1)
      .maybeSingle();
    if (data) return false;
  } catch {
    return false;
  }
  // Two saves at once both read "none yet": the database keeps ONE
  // milestone a user (0197) and refuses the other, which then wrote nothing.
  const written = await recordFunnelEvent(admin, { event: first, userId: input.userId, props: input.props });
  // The milestone (first_card_saved, …) was written by this call — what the
  // referral program waits for (lib/referrals/server.ts qualifyReferral).
  return written !== null;
}

/** The signup row's props that say where the account came from. */
const ATTRIBUTION_PROP_KEYS = ["referrer", "utmSource", "utmMedium", "utmCampaign", "surface", "referred"] as const;

/**
 * The account's `signup` row — ONE per account (0197), written where the
 * account is made and completed where its first touch is known:
 *
 *   - "written": the account had no row; this call wrote it. The email
 *     form writes its own at submit (app/(auth)/actions.ts); an account made
 *     with Google or Discord posts no form, so /auth/callback writes its row
 *     the moment the account exists — with `method` alone: the server has no
 *     attribution there (it lives in the tab's sessionStorage).
 *   - "enriched": the row was such a method-only row and this call added
 *     the tab's first touch to it (onboarding, lib/onboarding/actions.ts).
 *     Only a row whose `method` is NOT "email" and that holds no attribution
 *     yet: the email form's row is what that form posted, and a row 0197
 *     backfilled says it was (the tab at onboarding may be the one a
 *     confirmation link opened — its "first touch" is a mail client).
 *   - "kept": the row was left as it is.  - "failed": nothing could be read.
 *
 * Best effort like every funnel write; never throws.
 */
export async function recordSignup(
  admin: AdminClient,
  input: { userId: string; props?: FunnelProps | Record<string, unknown> },
): Promise<"written" | "enriched" | "kept" | "failed"> {
  const props = sanitizeFunnelProps(input.props ?? {});
  let existing: { id: string; props: unknown } | null;
  try {
    const { data, error } = await admin
      .from("funnel_events")
      .select("id, props")
      .eq("user_id", input.userId)
      .eq("event", "signup")
      .limit(1)
      .maybeSingle();
    if (error) return "failed";
    existing = data as { id: string; props: unknown } | null;
  } catch {
    return "failed";
  }
  if (!existing) {
    return (await recordFunnelEvent(admin, { event: "signup", userId: input.userId, props })) !== null ? "written" : "kept";
  }
  const had = existing.props && typeof existing.props === "object" ? (existing.props as Record<string, unknown>) : {};
  const method = typeof had.method === "string" ? had.method : "email";
  const firstTouch = Object.fromEntries(ATTRIBUTION_PROP_KEYS.flatMap((key) => (key in props ? [[key, props[key]]] : [])));
  if (
    method === "email" ||
    had.backfilled === true ||
    ATTRIBUTION_PROP_KEYS.some((key) => key in had) ||
    Object.keys(firstTouch).length === 0
  ) {
    return "kept";
  }
  try {
    const { error } = await admin
      .from("funnel_events")
      .update({ props: sanitizeFunnelProps({ ...had, ...firstTouch }) })
      .eq("id", existing.id);
    if (error) {
      console.warn("[funnel] signup row not enriched:", error.message);
      return "kept";
    }
    return "enriched";
  } catch {
    return "kept";
  }
}
