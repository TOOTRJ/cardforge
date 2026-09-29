"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { readSweepState } from "@/lib/cards/auto-rebake";
import { POISON_AFTER_STRIKES, type SweepStrike } from "@/lib/cards/auto-rebake-state";

// ---------------------------------------------------------------------------
// The /admin/renders controls for the automatic re-bake. Each action checks
// is_admin itself (the page's 404 is not a gate for a server action) and
// writes render_sweep_state with the service-role client — the table is not
// writable, or even readable, by API roles (migration 0120).
//
//   pause   the cron skips every invocation until resumed. Manual re-bakes
//           (the script, the compare page) still run.
//   resume  clears the breaker (paused + reason) and the idle fingerprint,
//           so the next invocation scans afresh.
//   retry   empties the poison list. Those cards get ONE more attempt: they
//           come back with POISON_AFTER_STRIKES - 1 strikes, so a card that
//           fails again goes straight back on the list and doesn't count as
//           a "new" failure for the breaker.
// ---------------------------------------------------------------------------

export type AutoRebakeActionResult = { ok: true } | { ok: false; error: string };

const ADMIN_PAGE = "/admin/renders";

async function requireAdmin(): Promise<
  | { ok: true; admin: ReturnType<typeof createAdminClient>; username: string | null }
  | { ok: false; error: string }
> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) return { ok: false, error: "The admin key isn't configured." };
  return { ok: true, admin: createAdminClient(), username: profile.username ?? null };
}

async function writeState(
  admin: ReturnType<typeof createAdminClient>,
  patch: Record<string, unknown>,
  what: string,
): Promise<AutoRebakeActionResult> {
  const { error } = await admin
    .from("render_sweep_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) {
    console.warn(`${what}:`, error.message);
    return { ok: false, error: "Couldn't update the automatic re-bake." };
  }
  revalidatePath(ADMIN_PAGE);
  return { ok: true };
}

export async function pauseAutoRebakeAction(): Promise<AutoRebakeActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  return writeState(
    gate.admin,
    {
      paused: true,
      paused_reason: `Paused by ${gate.username ? `@${gate.username}` : "an admin"}.`,
      paused_at: new Date().toISOString(),
    },
    "pauseAutoRebakeAction",
  );
}

export async function resumeAutoRebakeAction(): Promise<AutoRebakeActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  return writeState(
    gate.admin,
    { paused: false, paused_reason: null, paused_at: null, idle: null },
    "resumeAutoRebakeAction",
  );
}

export async function retryPoisonedCardsAction(): Promise<AutoRebakeActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  let state;
  try {
    state = await readSweepState(gate.admin);
  } catch (err) {
    console.warn("retryPoisonedCardsAction:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't read the automatic re-bake." };
  }
  if (state.poison.length === 0) return { ok: true };
  const now = new Date().toISOString();
  const strikes: Record<string, SweepStrike> = { ...state.strikes };
  for (const entry of state.poison) {
    strikes[entry.id] = { n: POISON_AFTER_STRIKES - 1, error: entry.error, at: now };
  }
  return writeState(gate.admin, { poison: [], strikes, idle: null }, "retryPoisonedCardsAction");
}
