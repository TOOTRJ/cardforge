import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import { describeLedgerReason } from "@/lib/billing/ledger-reasons";
import { TOOL_CATALOG, type ToolSlug } from "@/lib/tools/catalog";
import { fillDays, type DayPoint } from "@/lib/admin/analytics/series";

// ---------------------------------------------------------------------------
// /admin/analytics — the "Credits and AI" tab's data.
//
// The credit ledger is the truth about AI credits: every charge, every
// refund of one and every grant is a row of `credit_ledger`.
// `admin_credit_flow` (migration 0201) sums it for a period — spent, given
// back and granted, by reason and by UTC day — and answers ONE json object,
// which `parseCreditFlow` reads key by key (a key it does not find is 0 or
// an empty list; an answer that is not that object at all is a failed
// read). The previous period is a second call with [previousSince, previousUntil):
// the same previous period every tab of the page compares against.
//
// What the words count (0201's header has the whole rule):
//   spent     every charge, GROSS — one later given back is still here;
//   refunded  charges given back (reason 'refund'), matched to the reason
//             they were charged under through the refund's key;
//   granted   everything else that added credits;
//   takenBack a refunded pack's credits following the money — not a spend.
//
// Admin accounts: an admin's AI use is free and writes NO ledger row
// (lib/ai/rate-limit.ts spendCredits), so leaving admins out changes what
// was GRANTED, and little else.
// Every reader here checks the viewer is an admin ITSELF (requireAdminClient:
// null for anyone else) — the page's gate is not the only thing between a
// service-role read and a caller, so a later import of one of these into a
// route or an action cannot hand the data out.
// ---------------------------------------------------------------------------

/**
 * The beta tool a ledger reason belongs to. The ledger is what a tool's AI
 * cost its users — a tool's own events only say what a browser or a route
 * reported. Token Kit is NOT here on purpose: its AI art is charged as
 * `fill_card`, the reason every fill in the card creator uses, so the
 * ledger cannot tell the two apart (the tab says so under the table).
 * tests/unit/admin/analytics/credits-flow.test.ts holds each reason to the
 * label its tool's code really spends under.
 */
export const CREDIT_REASON_TOOLS: Readonly<Record<string, ToolSlug>> = {
  build_collection_deck: "collection-builder",
  suggest_collection_commander: "collection-builder",
  generate_set_icon: "set-symbol-studio",
  forge_pip: "pip-forge",
  draft_table_sheet: "rule0-sheet",
  bulk_customize_art: "bulk-customize",
  deck_reart_art: "re-art-deck",
};

export type CreditTotals = {
  spent: number;
  spends: number;
  refunded: number;
  refunds: number;
  granted: number;
  grants: number;
  takenBack: number;
  takeBacks: number;
};

export type CreditSpendRow = { reason: string; spent: number; spends: number; refunded: number; refunds: number };
export type CreditGrantedRow = { reason: string; credits: number; grants: number };
export type CreditDay = { day: string; spent: number; granted: number; refunded: number };

export type CreditFlow = {
  totals: CreditTotals;
  /** Largest spend first. `refunded` is the period's refunds of charges
   *  made under that reason. */
  spentByReason: CreditSpendRow[];
  /** Refunds whose charge could not be found: in `totals.refunded`, in no
   *  reason's row. */
  refundedUnattributed: { credits: number; refunds: number };
  grantedByReason: CreditGrantedRow[];
  /** Only the UTC days that have a row, oldest first. */
  days: CreditDay[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A count from json: a finite number (or a numeric string), never below 0. */
function count(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/**
 * `admin_credit_flow`'s answer, read defensively. Null when it is not the
 * object the function builds (no `totals`): a failed read, never zeros. A
 * row without a reason, or a day that is not a date, is skipped.
 */
export function parseCreditFlow(value: unknown): CreditFlow | null {
  if (!isRecord(value) || !isRecord(value.totals)) return null;
  const totals = value.totals;
  const unattributed = isRecord(value.refunded_unattributed) ? value.refunded_unattributed : {};
  return {
    totals: {
      spent: count(totals.spent),
      spends: count(totals.spends),
      refunded: count(totals.refunded),
      refunds: count(totals.refunds),
      granted: count(totals.granted),
      grants: count(totals.grants),
      takenBack: count(totals.taken_back),
      takeBacks: count(totals.take_backs),
    },
    spentByReason: list(value.spent_by_reason).flatMap((row) =>
      typeof row.reason === "string" && row.reason
        ? [
            {
              reason: row.reason,
              spent: count(row.spent),
              spends: count(row.spends),
              refunded: count(row.refunded),
              refunds: count(row.refunds),
            },
          ]
        : [],
    ),
    refundedUnattributed: { credits: count(unattributed.credits), refunds: count(unattributed.refunds) },
    grantedByReason: list(value.granted_by_reason).flatMap((row) =>
      typeof row.reason === "string" && row.reason
        ? [{ reason: row.reason, credits: count(row.credits), grants: count(row.grants) }]
        : [],
    ),
    days: list(value.days).flatMap((row) =>
      typeof row.day === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.day)
        ? [{ day: row.day.slice(0, 10), spent: count(row.spent), granted: count(row.granted), refunded: count(row.refunded) }]
        : [],
    ),
  };
}

/** One measure of the flow for every day of the period, quiet days at 0. */
export function creditDaySeries(
  dayKeys: readonly string[],
  days: readonly CreditDay[],
  measure: "spent" | "granted" | "refunded",
): DayPoint[] {
  return fillDays(
    dayKeys,
    days.map((day) => ({ day: day.day, value: day[measure] })),
  );
}

export type CreditSpendGroup = {
  key: string;
  label: string;
  spent: number;
  spends: number;
  refunded: number;
  refunds: number;
};

const bySpent = (a: CreditSpendGroup, b: CreditSpendGroup) =>
  b.spent - a.spent || b.refunded - a.refunded || a.label.localeCompare(b.label);

/**
 * Where credits went, in the words the usage ledger prints
 * (describeLedgerReason). Reasons that share a label are ONE row — "AI deck
 * generation" is both `generate_deck` and `generate_deck_cards` — so a
 * label never appears twice. Largest spend first.
 */
export function spendingByLabel(rows: readonly CreditSpendRow[]): CreditSpendGroup[] {
  const groups = new Map<string, CreditSpendGroup>();
  for (const row of rows) {
    const label = describeLedgerReason(row.reason);
    const group = groups.get(label) ?? { key: label, label, spent: 0, spends: 0, refunded: 0, refunds: 0 };
    group.spent += row.spent;
    group.spends += row.spends;
    group.refunded += row.refunded;
    group.refunds += row.refunds;
    groups.set(label, group);
  }
  return [...groups.values()].sort(bySpent);
}

export type ToolSpending = {
  /** One row per tool that has a reason of its own, in the catalog's order
   *  — a tool nobody spent on is a row of zeros. */
  tools: Array<CreditSpendGroup & { slug: ToolSlug }>;
  /** Every other reason: the card creator, decks — and Token Kit's art. */
  other: CreditSpendGroup;
};

/** What each beta tool's AI cost its users, from the ledger's reasons. */
export function spendingByTool(rows: readonly CreditSpendRow[]): ToolSpending {
  const mapped = new Set<ToolSlug>(Object.values(CREDIT_REASON_TOOLS));
  const tools = new Map<ToolSlug, CreditSpendGroup & { slug: ToolSlug }>();
  for (const tool of TOOL_CATALOG) {
    if (mapped.has(tool.slug)) {
      tools.set(tool.slug, { slug: tool.slug, key: tool.slug, label: tool.name, spent: 0, spends: 0, refunded: 0, refunds: 0 });
    }
  }
  const other: CreditSpendGroup = {
    key: "other",
    label: "The card creator and everything else",
    spent: 0,
    spends: 0,
    refunded: 0,
    refunds: 0,
  };
  const toolOf = new Map(Object.entries(CREDIT_REASON_TOOLS));
  for (const row of rows) {
    const slug = toolOf.get(row.reason);
    const group = (slug && tools.get(slug)) || other;
    group.spent += row.spent;
    group.spends += row.spends;
    group.refunded += row.refunded;
    group.refunds += row.refunds;
  }
  return { tools: [...tools.values()], other };
}

type Window = { since: Date; until: Date };

/**
 * The ledger's flow for [since, until). Null when the read failed (the tab
 * says so) — logged here.
 */
export async function getCreditFlow(window: Window, includeAdmins: boolean): Promise<CreditFlow | null> {
  try {
    const admin = await requireAdminClient();
    if (!admin) return null;
    const { data, error } = await admin.rpc("admin_credit_flow", {
      p_since: window.since.toISOString(),
      p_until: window.until.toISOString(),
      p_include_admins: includeAdmins,
    });
    if (error) {
      console.error("[admin] admin_credit_flow failed:", error.message);
      return null;
    }
    const flow = parseCreditFlow(data);
    if (!flow) console.error("[admin] admin_credit_flow answered something that is not its object.");
    return flow;
  } catch (error) {
    console.error("[admin] admin_credit_flow failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The PostgREST `or` filter that keeps every row but the admins' — and the
 *  rows with no user (an account since deleted), which `not.in` alone would
 *  drop. Null when there is no admin to leave out. */
export function withoutAdminsFilter(adminIds: readonly string[]): string | null {
  const ids = adminIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? `user_id.is.null,user_id.not.in.(${ids.join(",")})` : null;
}

export type AiGenerationCounts = { current: number; previous: number };

/**
 * AI jobs started (`funnel_events` rows `ai_generation`: a card, a card
 * fill, a deck — written by /api/ai/jobs when a job starts) in the period
 * and in the one before. Two head counts; with admins left out, the rows
 * of admin accounts are not counted. Null when a count — or the admins'
 * ids it needs — could not be read: no number, never a wrong one.
 */
export async function getAiGenerationCounts(
  period: { since: Date; until: Date; previousSince: Date; previousUntil: Date },
  includeAdmins: boolean,
): Promise<AiGenerationCounts | null> {
  try {
    const admin = await requireAdminClient();
    if (!admin) return null;
    let notAdmin: string | null = null;
    if (!includeAdmins) {
      const { data, error } = await admin.from("profiles").select("id").eq("is_admin", true);
      if (error) {
        console.error("[admin] AI generations: the admins' ids could not be read:", error.message);
        return null;
      }
      notAdmin = withoutAdminsFilter((data ?? []).map((row) => row.id));
    }
    const countIn = async (since: Date, until: Date): Promise<number | null> => {
      let query = admin
        .from("funnel_events")
        .select("id", { count: "exact", head: true })
        .eq("event", "ai_generation")
        .gte("created_at", since.toISOString())
        .lt("created_at", until.toISOString());
      if (notAdmin) query = query.or(notAdmin);
      const { count: n, error } = await query;
      if (error) {
        console.error("[admin] AI generations could not be counted:", error.message);
        return null;
      }
      return n ?? 0;
    };
    const [current, previous] = await Promise.all([
      countIn(period.since, period.until),
      countIn(period.previousSince, period.previousUntil),
    ]);
    return current === null || previous === null ? null : { current, previous };
  } catch (error) {
    console.error("[admin] AI generations could not be counted:", error instanceof Error ? error.message : error);
    return null;
  }
}
