"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { applyBankToPlan, readBank } from "@/lib/billing/day-bank";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";

// ---------------------------------------------------------------------------
// "Apply my banked days" — the billing page's button (lib/billing/day-bank.ts
// `applyBankToPlan`): the viewer's own banked days are added to the time of
// the plan they are on. The page shows the button only for a live plan; a
// viewer with none is sent to /pricing instead (the checkout applies the
// bank). Never money: the days move a date on a plan that already bills.
// ---------------------------------------------------------------------------

export type ApplyBankedDaysResult =
  | { ok: true; days: number; message: string }
  | { ok: false; error: string; code?: "nothing_banked" | "no_live_plan" | "refused" };

export async function applyBankedDaysAction(): Promise<ApplyBankedDaysResult> {
  if (!isBillingEnabled() || !isAdminConfigured()) return { ok: false, error: "Billing isn't available right now." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in." };
  const profile = await getCurrentProfile();
  const tier = profile?.subscription_tier === "pro" ? "pro" : profile?.subscription_tier === "plus" ? "plus" : null;
  const live = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";
  if (!tier || !live) {
    return { ok: false, error: "Start a plan first — your banked days become its free period.", code: "no_live_plan" };
  }
  const admin = createAdminClient();
  const before = await readBank(admin, user.id);
  if (before.banked < 1) return { ok: false, error: "You have no banked days to apply.", code: "nothing_banked" };
  const result = await applyBankToPlan(admin, { userId: user.id, tier });
  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  await recordFunnelEvent(admin, {
    event: "bank_days_applied",
    userId: user.id,
    props: { tier, bankDays: result.days },
  });
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
  return {
    ok: true,
    days: result.days,
    message: `${result.days} free day${result.days === 1 ? "" : "s"} added to your plan. ${result.note}`,
  };
}
