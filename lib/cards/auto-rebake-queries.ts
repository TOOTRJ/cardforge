import "server-only";

import { unstable_cache } from "next/cache";
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

/** Cache tag of the owed-re-bake count the admin dashboard tile reads. */
export const REBAKE_OWED_TAG = "rebake-owed";
/** How long the tile may reuse that count (seconds). */
export const REBAKE_OWED_REVALIDATE_SECONDS = 60;

/** A cached owed count and when it was taken (epoch ms). */
type OwedCount = { count: number; countedAt: number };

/**
 * The owed count (countSweepCandidates: a service-role head count over every
 * published card), reused across requests for up to a minute — /dashboard is
 * an admin's landing page, and the count needn't run on every visit. It is
 * one GLOBAL number (no viewer in it: service role, no cookies), so every
 * admin may share it. Keyed by the excluded poison ids (a Retry or a new
 * strike changes them → a fresh count) and the sweep version (the Data Cache
 * can outlive a deploy; a sweep bump must not show the old version's count).
 * A failed count throws, so nothing is cached; the caller's catch turns it
 * into null. Read it through countOwedRebakes(), never directly: see there.
 */
const countOwedRebakesCached = unstable_cache(
  async (excludeIds: string[]): Promise<OwedCount> => ({
    count: await countSweepCandidates(createAdminClient(), excludeIds),
    countedAt: Date.now(),
  }),
  [REBAKE_OWED_TAG, `sweep-v${latestSweepVersion()}`],
  { revalidate: REBAKE_OWED_REVALIDATE_SECONDS, tags: [REBAKE_OWED_TAG] },
);

/**
 * The owed count, at most REBAKE_OWED_REVALIDATE_SECONDS old. unstable_cache
 * alone doesn't promise that: in an App Router request it is
 * stale-while-revalidate — past `revalidate` it still RETURNS the old entry
 * and only refreshes it in the background, so the first visit after a quiet
 * afternoon would print the count from the previous visit (hours old, e.g.
 * "700 owed" long after the cron cleared them). An entry older than the
 * window (or of an unknown shape) is therefore counted again here.
 */
async function countOwedRebakes(
  admin: ReturnType<typeof createAdminClient>,
  excludeIds: string[],
  nowMs: number,
): Promise<number> {
  const cached: Partial<OwedCount> | null = await countOwedRebakesCached(excludeIds);
  if (
    typeof cached?.count === "number" &&
    typeof cached.countedAt === "number" &&
    nowMs - cached.countedAt <= REBAKE_OWED_REVALIDATE_SECONDS * 1000
  ) {
    return cached.count;
  }
  return countSweepCandidates(admin, excludeIds);
}

/** `poisonDetails: false` skips looking the poisoned cards up (titles,
 *  links) — for the admin dashboard tile, which prints only their count.
 *  `cachePending: true` reads the owed count through the ≤60 s cache above
 *  (the tile); /admin/renders keeps the default, a fresh count, because its
 *  Pause / Resume / Retry act on what it shows. */
export async function getAutoRebakeOverview(
  options: { poisonDetails?: boolean; cachePending?: boolean } = {},
): Promise<AutoRebakeOverview> {
  const { poisonDetails = true, cachePending = false } = options;
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
    (cachePending ? countOwedRebakes(admin, poisonIds, base.readAt) : countSweepCandidates(admin, poisonIds)).catch(
      () => null,
    ),
    poisonDetails ? describePoison(admin, state.poison) : Promise.resolve<PoisonCard[]>([]),
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
