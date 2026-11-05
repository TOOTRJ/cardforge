import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0171 — deck_clones_by_day, the deck activity panel's clones (TODO DK7.4a).
// It mirrors 0154's deck_likes_by_day: the owner only, the same clamp and
// span, a pinned search_path, grants stated (authenticated + service role;
// never anon) — and counts the clones recorded in deck_remix_sources (0164)
// by UTC day, never the owner's own copy. Behaviour proved on the local
// stack (PR body).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (file: string) => strip(readFileSync(join(dir, file), "utf8"));

function fn(sql: string, name: string): { head: string; body: string } {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = sql.indexOf("$$", start);
  return { head: squash(sql.slice(start, open)), body: squash(sql.slice(open + 2, sql.indexOf("$$", open + 2))) };
}

const SQL = read("0171_deck_clones_by_day.sql");
const CLONES = fn(SQL, "deck_clones_by_day");
const LIKES = fn(read("0154_deck_activity.sql"), "deck_likes_by_day");

describe("0171: deck_clones_by_day", () => {
  it("is a stable security definer with a pinned search_path", () => {
    expect(CLONES.head).toContain("returns table (day date, clones integer)");
    expect(CLONES.head).toContain("security definer");
    expect(CLONES.head).toContain("set search_path = ''");
    expect(CLONES.head).toContain("stable");
  });

  it("answers the deck's owner alone, over the same span and clamp as the likes", () => {
    expect(CLONES.body).toContain("where d.id = p_deck_id and d.owner_id = auth.uid()");
    const spanOf = (body: string) => body.slice(body.indexOf("span as"), body.indexOf("), "));
    expect(spanOf(CLONES.body)).toBe(spanOf(LIKES.body));
    expect(CLONES.body).toContain("least(greatest(coalesce(p_days, 30), 1), 400)");
  });

  it("counts the lineage rows of clones of this deck, by UTC day", () => {
    expect(CLONES.body).toContain("join public.deck_remix_sources r on r.source_deck_id = deck.id");
    expect(CLONES.body).toContain("(c.created_at at time zone 'utc')::date = s.day");
  });

  it("never counts a clone its source's owner made", () => {
    expect(CLONES.body).toContain("join public.decks c on c.id = r.deck_id where c.owner_id <> deck.owner_id");
  });

  it("states its grants: authenticated and the service role, never anon", () => {
    const sql = squash(SQL);
    expect(sql).toContain("revoke all on function public.deck_clones_by_day(uuid, integer) from public, anon;");
    expect(sql).toContain(
      "grant execute on function public.deck_clones_by_day(uuid, integer) to authenticated, service_role;",
    );
    expect(sql).not.toMatch(/grant[^;]*deck_clones_by_day[^;]*anon/);
  });

  it("changes nothing stored and opens no table to an API role", () => {
    expect(SQL).not.toMatch(/\b(alter|create) table\b|\binsert into\b|\bupdate public\.|\bdelete from\b|create policy/i);
    expect(SQL).not.toMatch(/grant[^;]*on table/i);
  });
});
