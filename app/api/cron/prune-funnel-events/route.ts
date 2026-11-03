import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { PERMANENT_FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";
import { isBillingEnabled } from "@/lib/billing/flags";
import { DECK_HISTORY_PLUS_DAYS } from "@/lib/decks/deck-history";

// ---------------------------------------------------------------------------
// /api/cron/prune-funnel-events — weekly: drop funnel rows older than the
// retention window (180 days), except the once-per-user milestones (signup,
// first_*), which are the activation record and stay. The Funnel panel looks
// at 7/30-day windows; anything older is history the revenue log and Stripe
// already keep better. Secured by CRON_SECRET like every cron route.
//
// The deck view log rides the same run (migration 0151, lib/decks/views.ts):
// deck_views rows past 400 days (deck_views_by_day reads at most that far
// back; decks.view_count keeps the lifetime total) and any salt of a day
// already over — record_deck_view drops those itself, but only when a view
// comes in. Each prune is its own delete: one failing never stops the other.
//
// …and the AI receipts (migration 0162, lib/cards/ai-provenance-server.ts)
// past 90 days: a creator's claim is checked against the last 30.
//
// …and the deck change history (migration 0164, TODO DK5.13): rows past
// DECK_HISTORY_PLUS_DAYS of every deck whose owner isn't Pro (Pro keeps the
// full history) and every row of a deck that is gone — by plan only while
// billing is on (off, everyone is unlocked: only the orphans go). The
// History view also never reads past the plan's window, so a row a week
// from its prune is never shown.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const FUNNEL_RETENTION_DAYS = 180;
export const DECK_VIEW_RETENTION_DAYS = 400;
export const AI_RECEIPT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - FUNNEL_RETENTION_DAYS * DAY_MS).toISOString();
  const { error, count } = await admin
    .from("funnel_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
    .not("event", "in", `(${PERMANENT_FUNNEL_EVENTS.join(",")})`);

  // UTC days, as the log keeps them.
  const today = new Date().toISOString().slice(0, 10);
  const viewCutoff = new Date(Date.now() - DECK_VIEW_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
  const views = await admin.from("deck_views").delete({ count: "exact" }).lt("day", viewCutoff);
  const salts = await admin.from("deck_view_salts").delete({ count: "exact" }).lt("day", today);
  const receiptCutoff = new Date(Date.now() - AI_RECEIPT_RETENTION_DAYS * DAY_MS).toISOString();
  const receipts = await admin.from("card_ai_receipts").delete({ count: "exact" }).lt("created_at", receiptCutoff);

  const history = await admin.rpc("prune_deck_entry_changes", {
    p_keep_days: DECK_HISTORY_PLUS_DAYS,
    p_by_plan: isBillingEnabled(),
  });

  // A database 0164 has not reached yet (the app can deploy first): nothing
  // to prune there, never a failed run.
  const historyError =
    history.error && !["PGRST202", "42883"].includes(history.error.code ?? "") ? history.error : null;

  const failed = [error, views.error, salts.error, receipts.error, historyError].find(Boolean);
  if (failed) return NextResponse.json({ ok: false, error: failed.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    deckViewsDeleted: views.count ?? 0,
    deckViewCutoff: viewCutoff,
    aiReceiptsDeleted: receipts.count ?? 0,
    deckHistoryDeleted: history.data ?? 0,
  });
}
