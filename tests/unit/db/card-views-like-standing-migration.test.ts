import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_VIEW_RETENTION_DAYS } from "@/app/api/cron/prune-funnel-events/route";

// ---------------------------------------------------------------------------
// 0168 — the card page's two numbers (TODO CP3 + CP4). What the SQL must keep
// (its behaviour — the per-day dedupe, the owner and visibility rules, the
// ties, the owner's like left out, the grants — is proved on the local stack
// in ONE rolled-back transaction, PR body):
//   * views grow only through record_card_view, the service role's alone;
//     increment_card_view is gone and only the rollout fallback names it;
//   * no API role reads the log or its salts; the prune keeps 400 days;
//   * the rank reads PUBLIC cards only, leaves the owner's like out, says
//     "tied", and card_like_rank is gone.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = strip(readFileSync(join(dir, "0168_card_views_and_like_standing.sql"), "utf8"));
const FLAT = squash(SQL);

function fnBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = SQL.indexOf("$$", start);
  return squash(SQL.slice(open + 2, SQL.indexOf("$$", open + 2)));
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const p = join(root, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

describe("0168: card views", () => {
  it("record_card_view: the service role's alone, one row per card, day and viewer, never the owner", () => {
    expect(FLAT).toContain("revoke all on function public.record_card_view(uuid, text, uuid) from public, anon, authenticated;");
    expect(FLAT).toContain("grant execute on function public.record_card_view(uuid, text, uuid) to service_role;");
    const body = fnBody("record_card_view");
    expect(body).toContain("c.visibility in ('public', 'unlisted')");
    expect(body).toContain("c.owner_id is distinct from p_viewer_id");
    expect(body).toContain("on conflict do nothing; if not found then return false;");
    expect(body).toContain("update public.cards set view_count = view_count + 1 where id = p_card_id;");
    expect(FLAT).toContain("primary key (card_id, day, viewer_key)");
    expect(FLAT).toMatch(/security definer set search_path = ''/);
  });

  it("the log and its salts: no API role; pruned like the deck's", () => {
    for (const table of ["card_views", "card_view_salts"]) {
      expect(FLAT).toContain(`alter table public.${table} enable row level security;`);
      expect(FLAT).toContain(`revoke all on table public.${table} from public, anon, authenticated;`);
      expect(FLAT).toContain(`grant select, insert, update, delete on table public.${table} to service_role;`);
    }
    expect(FLAT).not.toMatch(/create policy/);
    expect(CARD_VIEW_RETENTION_DAYS).toBe(400);
  });

  it("increment_card_view is dropped and only the rollout fallback calls it", () => {
    expect(FLAT).toContain("drop function if exists public.increment_card_view(uuid);");
    const callers = ["app", "lib", "components"]
      .flatMap((d) => walk(join(process.cwd(), d)))
      .filter((f) => readFileSync(f, "utf8").includes("increment_card_view"))
      .map((f) => f.slice(process.cwd().length + 1));
    expect(callers).toEqual(["lib/cards/views.ts"]);
  });
});

describe("0168: the like standing", () => {
  it("public cards only, the owner's like left out, ties said", () => {
    const body = fnBody("card_like_standing");
    expect(body).toContain("where c.id = p_card_id and c.visibility = 'public'");
    expect(body).toContain("where c.visibility = 'public' and c.id <> me.id");
    expect(body.match(/l\.user_id = c\.owner_id/g)).toHaveLength(2);
    expect(body).toContain("filter (where r.likes > me.likes)");
    expect(body).toContain("filter (where r.likes = me.likes) > 0 as tied");
    expect(body).toContain("where me.likes > 0");
    expect(body).not.toContain("unlisted");
  });

  it("leaves admin-owned cards out on BOTH sides, through 0091's owner_is_admin (owner 2026-11-04)", () => {
    // An admin's card has no place (no row: its page shows no trophy) and
    // takes none from anyone: a real creator's card tied with another keeps
    // its shared place under an admin's card with more likes. Checked on the
    // local database in a rolled-back transaction (2026-11-04): A and B tied
    // at #1 beside an admin's card with more likes, which had no row; with
    // the flag off, the admin's card took #1 and A fell to a tied #2.
    const body = fnBody("card_like_standing");
    expect(body.match(/and not public\.owner_is_admin\(c\.owner_id\)/g)).toHaveLength(2);
    expect(body).toMatch(/where c\.id = p_card_id and c\.visibility = 'public' and not public\.owner_is_admin\(c\.owner_id\)/);
    expect(body).toMatch(/and c\.likes_count >= me\.likes and not public\.owner_is_admin\(c\.owner_id\)/);
    // The one shared rule, never a restated predicate.
    expect(body).not.toContain("is_admin from");
    expect(body).not.toMatch(/profiles/);
  });

  it("runs as the caller, readable by anyone; card_like_rank is gone", () => {
    const head = squash(SQL.slice(SQL.indexOf("create or replace function public.card_like_standing("), SQL.indexOf("$$", SQL.indexOf("card_like_standing("))));
    expect(head).not.toContain("security definer");
    expect(FLAT).toContain("grant execute on function public.card_like_standing(uuid) to anon, authenticated, service_role;");
    expect(FLAT).toContain("drop function if exists public.card_like_rank(uuid);");
  });
});
