"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  createClient,
  getCurrentProfile,
  getCurrentUser,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardRenderPath } from "@/lib/cards/storage-paths";
import { REPORT_REASONS } from "@/lib/moderation/reasons";

// User reporting + admin moderation actions for public cards.

const reportSchema = z.object({
  cardId: z.string().uuid("Invalid card."),
  reason: z.enum(REPORT_REASONS),
  details: z
    .string()
    .trim()
    .max(1000, "Keep details under 1000 characters.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type ReportResult = { ok: true } | { ok: false; error: string };

export async function reportCardAction(input: unknown): Promise<ReportResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to report a card." };

  const supabase = await createClient();
  const { error } = await supabase.from("card_reports").insert({
    card_id: parsed.data.cardId,
    reporter_id: user.id,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });

  if (error) {
    // 23505 = already reported by this user → treat as success (idempotent).
    if ((error as { code?: string }).code === "23505") return { ok: true };
    return { ok: false, error: "Couldn't file the report. Please try again." };
  }
  return { ok: true };
}

export type ResolveAction = "hide" | "dismiss";
export type ResolveResult = { ok: true } | { ok: false; error: string };

// Admin-only. Resolves ALL pending reports for a card: "hide" un-publishes the
// card (→ private, render cleaned) and marks reports actioned; "dismiss" clears
// the reports with no change to the card. Runs via the service role (bypasses
// owner RLS) — gated on is_admin here.
export async function resolveCardReportsAction(input: {
  cardId: string;
  action: ResolveAction;
}): Promise<ResolveResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(input.cardId)) return { ok: false, error: "Invalid card id." };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  if (input.action === "hide") {
    const { data: card } = await admin
      .from("cards")
      .select("owner_id")
      .eq("id", input.cardId)
      .maybeSingle();

    await admin
      .from("cards")
      .update({ visibility: "private", rendered_image_url: null, rendered_at: null })
      .eq("id", input.cardId);

    if (card?.owner_id) {
      await admin.storage
        .from("card-renders")
        .remove([cardRenderPath(card.owner_id, input.cardId)]);
    }

    await admin
      .from("card_reports")
      .update({ status: "actioned", resolved_at: nowIso, resolved_by: profile.id })
      .eq("card_id", input.cardId)
      .eq("status", "pending");
  } else {
    await admin
      .from("card_reports")
      .update({ status: "dismissed", resolved_at: nowIso, resolved_by: profile.id })
      .eq("card_id", input.cardId)
      .eq("status", "pending");
  }

  revalidatePath("/admin/moderation");
  revalidatePath("/gallery");
  return { ok: true };
}
