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
      console.warn(`[funnel] ${input.event} not recorded:`, error.message);
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
 * like every funnel write.
 */
export async function recordActivity(
  admin: AdminClient,
  input: { userId: string; kind: ActivityKind; props?: FunnelProps | Record<string, unknown> },
): Promise<void> {
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
    if (data) return;
  } catch {
    return;
  }
  await recordFunnelEvent(admin, { event: first, userId: input.userId, props: input.props });
}

