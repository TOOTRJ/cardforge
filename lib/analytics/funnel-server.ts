import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { isFunnelEvent, sanitizeFunnelProps, type FunnelEvent, type FunnelProps } from "./funnel-events";

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
