import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";
import { fillDays, type DayPoint } from "@/lib/admin/analytics/series";

// ---------------------------------------------------------------------------
// /admin/analytics — the Content tab's data (2026-11): what people make and
// look at. ONE call, 0203's admin_content_stats, for the period and the one
// before it: cards and decks created, who can see those cards now, likes,
// card and deck views, three per-day series and the most viewed PUBLIC cards
// and decks (a private or unlisted title is never listed — the SQL leaves
// them out; the counts take every visibility).
//
// The answer is jsonb, so it is read defensively (parseContentStats — pure,
// unit-tested): a missing number is 0, a row with no id or slug is dropped.
// A read that fails is null and the tab says so.
// Every reader here checks the viewer is an admin ITSELF (requireAdminClient:
// null for anyone else) — the page's gate is not the only thing between a
// service-role read and a caller, so a later import of one of these into a
// route or an action cannot hand the data out.
// ---------------------------------------------------------------------------

export type ContentTotals = {
  cardsCreated: number;
  /** Of the cards created in the period: who can see them now. */
  cardsPublic: number;
  cardsUnlisted: number;
  cardsPrivate: number;
  decksCreated: number;
  /** Likes given in the period that still stand. */
  cardLikes: number;
  deckLikes: number;
  /** One per viewer, card (or deck) and UTC day; never the owner's own. */
  cardViews: number;
  deckViews: number;
};

export type ContentTopRow = {
  id: string;
  title: string;
  slug: string;
  ownerId: string | null;
  username: string | null;
  views: number;
};

export type ContentStats = {
  current: ContentTotals;
  previous: ContentTotals;
  /** Per UTC day of the period, oldest first, zero-filled. */
  cardsPerDay: DayPoint[];
  decksPerDay: DayPoint[];
  cardViewsPerDay: DayPoint[];
  /** The 10 most viewed public cards / decks of the period, most first. */
  topCards: ContentTopRow[];
  topDecks: ContentTopRow[];
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function parseTotals(raw: unknown): ContentTotals {
  const o = object(raw);
  return {
    cardsCreated: num(o.cardsCreated),
    cardsPublic: num(o.cardsPublic),
    cardsUnlisted: num(o.cardsUnlisted),
    cardsPrivate: num(o.cardsPrivate),
    decksCreated: num(o.decksCreated),
    cardLikes: num(o.cardLikes),
    deckLikes: num(o.deckLikes),
    cardViews: num(o.cardViews),
    deckViews: num(o.deckViews),
  };
}

function parseTop(raw: unknown): ContentTopRow[] {
  const rows: ContentTopRow[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const o = object(item);
    const id = text(o.id);
    const slug = text(o.slug);
    if (!id || !slug) continue;
    rows.push({ id, slug, title: text(o.title) ?? slug, ownerId: text(o.ownerId), username: text(o.username), views: num(o.views) });
  }
  // The SQL orders them; the page must not depend on it.
  return rows.sort((a, b) => b.views - a.views).slice(0, 10);
}

/** 0203's jsonb as the tab reads it. `dayKeys` are the period's UTC days
 *  (analyticsPeriod): a day the SQL has no row for is a zero. */
export function parseContentStats(raw: unknown, dayKeys: readonly string[]): ContentStats {
  const o = object(raw);
  const days = (Array.isArray(o.perDay) ? o.perDay : []).map(object).filter((d) => typeof d.day === "string");
  const series = (key: string): DayPoint[] =>
    fillDays(
      dayKeys,
      days.map((d) => ({ day: d.day as string, value: num(d[key]) })),
    );
  return {
    current: parseTotals(o.current),
    previous: parseTotals(o.previous),
    cardsPerDay: series("cardsCreated"),
    decksPerDay: series("decksCreated"),
    cardViewsPerDay: series("cardViews"),
    topCards: parseTop(o.topCards),
    topDecks: parseTop(o.topDecks),
  };
}

/** The Content tab's numbers for a period. `includeAdmins` = the page's
 *  "Include admins" switch (off: admins' own cards, decks and likes are left
 *  out). Null when the read fails. */
export async function getContentStats(period: AnalyticsPeriod, includeAdmins: boolean): Promise<ContentStats | null> {
  try {
    const admin = await requireAdminClient();
    if (!admin) return null;
    const { data, error } = await admin.rpc("admin_content_stats", {
      p_since: period.since.toISOString(),
      p_until: period.until.toISOString(),
      p_include_admins: includeAdmins,
    });
    if (error) {
      console.error("getContentStats: admin_content_stats failed:", error.message);
      return null;
    }
    return parseContentStats(data, period.dayKeys);
  } catch (error) {
    console.error("getContentStats:", error instanceof Error ? error.message : error);
    return null;
  }
}
