import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0154 — deck_likes_by_day, the deck activity panel's likes (TODO DK7.4).
// It mirrors 0151's deck_views_by_day: the owner only, the same clamp and
// span, a pinned search_path, and grants stated (authenticated + service
// role; never anon). Behaviour proved on the local stack (PR body).
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

const SQL = read("0154_deck_activity.sql");
const LIKES = fn(SQL, "deck_likes_by_day");
const VIEWS = fn(read("0151_deck_privacy_and_views.sql"), "deck_views_by_day");

describe("0154: deck_likes_by_day", () => {
  it("is a stable security definer with a pinned search_path", () => {
    expect(LIKES.head).toContain("returns table (day date, likes integer)");
    expect(LIKES.head).toContain("security definer");
    expect(LIKES.head).toContain("set search_path = ''");
    expect(LIKES.head).toContain("stable");
  });

  it("answers the deck's owner alone, over the same span and clamp as the views", () => {
    expect(LIKES.body).toContain("where d.id = p_deck_id and d.owner_id = auth.uid()");
    const spanOf = (body: string) => body.slice(body.indexOf("span as"), body.indexOf(") select"));
    expect(spanOf(LIKES.body)).toBe(spanOf(VIEWS.body));
    expect(LIKES.body).toContain("least(greatest(coalesce(p_days, 30), 1), 400)");
    expect(LIKES.body).toContain("(l.created_at at time zone 'utc')::date = s.day");
  });

  it("states its grants: authenticated and the service role, never anon", () => {
    const sql = squash(SQL);
    expect(sql).toContain("revoke all on function public.deck_likes_by_day(uuid, integer) from public, anon;");
    expect(sql).toContain(
      "grant execute on function public.deck_likes_by_day(uuid, integer) to authenticated, service_role;",
    );
    expect(sql).not.toMatch(/grant[^;]*deck_likes_by_day[^;]*anon/);
  });

  it("changes nothing stored", () => {
    expect(SQL).not.toMatch(/\b(alter|create) table\b|\binsert into\b|\bupdate public\.|\bdelete from\b|create policy/i);
  });
});
