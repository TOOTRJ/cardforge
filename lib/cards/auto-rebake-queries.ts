import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { buildCardPath } from "@/lib/cards/utils";
import { isUuid } from "@/lib/ids";
import { CARD_LAYOUT_VERSION, latestSweepVersion } from "@/lib/cards/layout-version";
import { countSweepCandidates, readSweepState } from "@/lib/cards/auto-rebake";
import {
  EMPTY_AUTO_REBAKE_STATE,
  type AutoRebakeState,
  type PoisonEntry,
} from "@/lib/cards/auto-rebake-state";

// ---------------------------------------------------------------------------
// What /admin/renders shows about the automatic re-bake. Service-role reads
// (render_sweep_state is not readable by API roles — it names unlisted
// cards): the CALLER must have checked is_admin first.
// ---------------------------------------------------------------------------

export type PoisonCard = PoisonEntry & {
  title: string | null;
  href: string | null;
  visibility: string | null;
};

export type AutoRebakeOverview = {
  state: AutoRebakeState;
  /** Published cards that may owe a re-bake (an upper bound; poison list
   *  excluded), or null when the count failed. */
  pending: number | null;
  layoutVersion: number;
  /** Cards stamped at or above this owe no correction. */
  sweepVersion: number;
  billingEnabled: boolean;
  poisonCards: PoisonCard[];
  error: string | null;
  /** When this was read — the one clock for every "5m ago" on the page. */
  readAt: number;
};

export async function getAutoRebakeOverview(): Promise<AutoRebakeOverview> {
  const base: AutoRebakeOverview = {
    state: EMPTY_AUTO_REBAKE_STATE,
    pending: null,
    layoutVersion: CARD_LAYOUT_VERSION,
    sweepVersion: latestSweepVersion(),
    billingEnabled: isBillingEnabled(),
    poisonCards: [],
    error: null,
    readAt: Date.now(),
  };
  if (!isAdminConfigured()) return { ...base, error: "The admin key isn't configured on this deployment." };
  const admin = createAdminClient();

  let state: AutoRebakeState;
  try {
    state = await readSweepState(admin);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "Couldn't read the re-bake state." };
  }

  const poisonIds = state.poison.map((p) => p.id);
  const [pending, poisonCards] = await Promise.all([
    countSweepCandidates(admin, poisonIds).catch(() => null),
    describePoison(admin, state.poison),
  ]);
  return { ...base, state, pending, poisonCards };
}

async function describePoison(
  admin: ReturnType<typeof createAdminClient>,
  poison: readonly PoisonEntry[],
): Promise<PoisonCard[]> {
  if (poison.length === 0) return [];
  // `in (…)` lists travel in the URL: look them up 100 at a time.
  const cards: Array<Record<string, unknown>> = [];
  for (const part of chunk(poison.map((p) => p.id).filter(isUuid), 100)) {
    const { data } = await admin.from("cards").select("id, title, slug, visibility, owner_id").in("id", part);
    cards.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  const usernameById = new Map<string, string | null>();
  for (const part of chunk([...new Set(cards.map((c) => c.owner_id as string))], 100)) {
    const { data: owners } = await admin.from("profiles").select("id, username").in("id", part);
    for (const o of owners ?? []) usernameById.set(o.id as string, (o.username as string | null) ?? null);
  }
  const cardById = new Map(cards.map((c) => [c.id as string, c]));
  return poison.map((entry) => {
    const card = cardById.get(entry.id);
    if (!card) return { ...entry, title: null, href: null, visibility: null };
    const visibility = (card.visibility as string | null) ?? null;
    return {
      ...entry,
      title: (card.title as string | null) ?? null,
      visibility,
      // A private card has no public page (and no render to fix any more).
      href:
        visibility === "private"
          ? null
          : buildCardPath({
              slug: card.slug as string,
              owner: { username: usernameById.get(card.owner_id as string) ?? null },
            }),
    };
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
