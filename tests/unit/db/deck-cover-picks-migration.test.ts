import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DECK_COVERS, isDefaultDeckCover } from "@/lib/decks/default-covers";
import { FEATURED_PICKS_MAX } from "@/lib/decks/featured";

// ---------------------------------------------------------------------------
// 0151 — the deck's cover picks and the built-in backgrounds (TODO DK6.4,
// DK6.2's shuffle). What the SQL itself must keep (its behaviour — rank
// uniqueness, the owner-only writes, the RPC's refusals, the cover guard
// taking the sixteen defaults and refusing every crafted value, the grants —
// is proved on the local stack in one rolled-back transaction, PR body):
//   * the rank is 1–5 (a CHECK the app's FEATURED_PICKS_MAX mirrors) and
//     one entry per rank and deck (a PARTIAL unique index);
//   * the RPC is SECURITY INVOKER (RLS applies), takes the deck's entry
//     lock, checks the owner, refuses more than five / a repeat / another
//     deck's entry, and CLEARS the ranks that change before it SETS them;
//   * media_url_allowed is 0127's, word for word, plus ONE branch: exactly
//     the sixteen site-relative defaults isDefaultDeckCover knows;
//   * grants: the RPC to authenticated + service_role only; media_url_allowed
//     restated as 0127's; no row is rewritten.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(readFileSync(join(dir, "0151_deck_cover_picks.sql"), "utf8"));
const SQL_0127 = strip(readFileSync(join(dir, "0127_media_url_guards.sql"), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** `create or replace function public.<name>(` … `$$;`, squashed. */
const fn = (sql: string, name: string) =>
  squash(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(sql)?.[0] ?? "");

/** Every `;`-terminated statement outside function bodies. */
const statements = SQL.replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;")
  .split(";")
  .map(squash)
  .filter(Boolean);

/** The deck-cover branch's pattern, as a JS RegExp (a plain ERE: the same
 *  in Postgres and JS for this alphabet). */
const BRANCH =
  "if p_kind = 'deck-cover' and p_url ~ '^/defaults/deck-covers/(white|blue|black|red|green|multicolor|colorless|neutral)-[12]\\.webp$' then return true; end if;";
const PATTERN = new RegExp(/p_url ~ '(\^\/defaults\/deck-covers\/[^']+)'/.exec(fn(SQL, "media_url_allowed"))![1]);

describe("0151 — featured_rank", () => {
  it("a nullable smallint, 1–5, one entry per rank and deck — idempotent", () => {
    expect(statements).toContain("alter table public.deck_cards add column if not exists featured_rank smallint");
    expect(statements).toContain("alter table public.deck_cards drop constraint if exists deck_cards_featured_rank_range");
    expect(statements).toContain(
      "alter table public.deck_cards add constraint deck_cards_featured_rank_range check (featured_rank is null or featured_rank between 1 and 5)",
    );
    expect(statements).toContain(
      "create unique index if not exists deck_cards_featured_rank_key on public.deck_cards (deck_id, featured_rank) where featured_rank is not null",
    );
    // The app's cap is the CHECK's.
    expect(FEATURED_PICKS_MAX).toBe(5);
  });

  it("no guard on which entry, no new policy: the rank rides the entry rules (0144's update policy, 0143's triggers)", () => {
    expect(statements.filter((s) => /^(create|drop) (policy|trigger)\b/.test(s))).toEqual([]);
  });
});

describe("0151 — set_deck_featured_entries", () => {
  const body = fn(SQL, "set_deck_featured_entries");

  it("SECURITY INVOKER with an empty search_path: RLS applies to its updates", () => {
    expect(body).toMatch(/returns integer language plpgsql security invoker set search_path = ''/);
    expect(body).not.toMatch(/security definer/);
  });

  it("refuses a NULL list or id, more than five, and a repeat — before it takes the lock", () => {
    const lock = body.indexOf("pg_advisory_xact_lock");
    for (const check of [
      "if p_entry_ids is null or array_position(p_entry_ids, null) is not null then raise exception 'deck_featured_invalid:",
      "if v_count > 5 then raise exception 'deck_featured_limit:",
      "if (select count(distinct x.id) from unnest(p_entry_ids) as x(id)) <> v_count then raise exception 'deck_featured_invalid:",
    ]) {
      expect(body).toContain(check);
      expect(body.indexOf(check)).toBeLessThan(lock);
    }
  });

  it("the deck's entry lock (0143's key), then the owner, then every id an entry of THAT deck", () => {
    expect(body).toContain("perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));");
    expect(body).toContain(
      "if not exists ( select 1 from public.decks d where d.id = p_deck_id and d.owner_id = (select auth.uid()) ) then raise exception 'deck_not_owned: deck not found or not yours' using errcode = 'insufficient_privilege';",
    );
    expect(body).toContain(
      "if ( select count(*) from public.deck_cards dc where dc.deck_id = p_deck_id and dc.id = any (p_entry_ids) ) <> v_count then raise exception 'deck_featured_invalid:",
    );
    expect(body.indexOf("deck_not_owned")).toBeGreaterThan(body.indexOf("pg_advisory_xact_lock"));
  });

  it("clears the ranks that change FIRST, then sets the new ones (a unique index is checked row by row)", () => {
    const clear = body.indexOf("set featured_rank = null");
    const set = body.indexOf("set featured_rank = pick.rank::smallint");
    expect(clear).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(clear);
    expect(body).toContain(
      "update public.deck_cards dc set featured_rank = null where dc.deck_id = p_deck_id and dc.featured_rank is not null and not exists ( select 1 from unnest(p_entry_ids) with ordinality as pick(entry_id, rank) where pick.entry_id = dc.id and pick.rank = dc.featured_rank );",
    );
    expect(body).toContain(
      "update public.deck_cards dc set featured_rank = pick.rank::smallint from unnest(p_entry_ids) with ordinality as pick(entry_id, rank) where dc.deck_id = p_deck_id and dc.id = pick.entry_id and dc.featured_rank is distinct from pick.rank::smallint;",
    );
  });

  it("grants: authenticated and service_role only — never PUBLIC or anon", () => {
    expect(statements).toContain("revoke all on function public.set_deck_featured_entries(uuid, uuid[]) from public, anon");
    expect(statements).toContain(
      "grant execute on function public.set_deck_featured_entries(uuid, uuid[]) to authenticated, service_role",
    );
  });
});

describe("0151 — media_url_allowed: 0127's, plus the sixteen defaults", () => {
  it("is 0127's function word for word but for ONE added branch", () => {
    const now = fn(SQL, "media_url_allowed");
    const before = fn(SQL_0127, "media_url_allowed");
    expect(now).toContain(BRANCH);
    expect(now.replace(`${BRANCH} `, "")).toBe(before);
  });

  it("the branch sits before the storage-object rules, for the deck-cover kind alone", () => {
    const now = fn(SQL, "media_url_allowed");
    expect(now.indexOf(BRANCH)).toBeLessThan(now.indexOf("v_buckets := case p_kind"));
    expect(now.match(/'deck-cover'/g)).toHaveLength(2); // the branch, and 0127's bucket row
  });

  it("accepts exactly the sixteen paths isDefaultDeckCover knows", () => {
    for (const path of DEFAULT_DECK_COVERS) expect(PATTERN.test(path), path).toBe(true);
    const identities = ["white", "blue", "black", "red", "green", "multicolor", "colorless", "neutral", "gold", "purple", "Red", "multicolour"];
    const candidates = identities.flatMap((identity) =>
      ["0", "1", "2", "3", "10", "01"].flatMap((n) => [
        `/defaults/deck-covers/${identity}-${n}.webp`,
        `/defaults/deck-covers/${identity}-${n}.png`,
      ]),
    );
    const accepted = candidates.filter((path) => PATTERN.test(path));
    expect(accepted.sort()).toEqual([...DEFAULT_DECK_COVERS].sort());
    for (const path of candidates) expect(PATTERN.test(path), path).toBe(isDefaultDeckCover(path));
  });

  it.each([
    "https://evil.example/defaults/deck-covers/red-1.webp",
    "https://pipglyph.com/defaults/deck-covers/red-1.webp",
    "//evil.example/defaults/deck-covers/red-1.webp",
    "/defaults/deck-covers/../avatars/avatar-01.webp",
    "/defaults/x/../deck-covers/red-1.webp",
    "/defaults//deck-covers/red-1.webp",
    "/defaults/deck-covers/x/red-1.webp",
    "/defaults/deck-covers/red-1.webp?x=1",
    "/defaults/deck-covers/red-1.webp#x",
    "/defaults/deck-covers/red-1.webp/",
    "/defaults/deck-covers/red-1.webp\n",
    " /defaults/deck-covers/red-1.webp",
    "/defaults/deck-covers/red%2D1.webp",
    "/defaults/avatars/avatar-01.webp",
    "javascript:alert(1)",
  ])("refuses a crafted value — %j — as isDefaultDeckCover does", (value) => {
    expect(PATTERN.test(value)).toBe(false);
    expect(isDefaultDeckCover(value)).toBe(false);
  });

  it("grants restated as 0127's: EXECUTE for anon, authenticated, service_role; PUBLIC revoked", () => {
    expect(statements).toContain("revoke all on function public.media_url_allowed(text, text, uuid) from public");
    expect(statements).toContain(
      "grant execute on function public.media_url_allowed(text, text, uuid) to anon, authenticated, service_role",
    );
  });

  it("rewrites no existing row", () => {
    expect(statements.filter((s) => /^(update|delete|insert)\b/i.test(s))).toEqual([]);
  });
});

describe("supabase/seeds/28_deck_cover_picks.sql", () => {
  const seed = readFileSync(join(process.cwd(), "supabase/seeds/28_deck_cover_picks.sql"), "utf8");

  it("stores only a built-in default, and only where the deck has none", () => {
    const covers = [...seed.matchAll(/cover_url = '([^']+)'/g)].map((m) => m[1]);
    expect(covers.length).toBeGreaterThan(0);
    for (const cover of covers) expect(isDefaultDeckCover(cover), cover).toBe(true);
    expect(seed).toContain("and cover_url is null;");
  });

  it("writes a deck's picks only while it has none, ranks 1–5", () => {
    expect(seed).toMatch(/and not exists \(\s*select 1 from public\.deck_cards other\s*where other\.deck_id = p\.deck_id and other\.featured_rank is not null\s*\)/);
    for (const [, rank] of seed.matchAll(/, (\d+)::smallint\)/g)) {
      expect(Number(rank)).toBeGreaterThanOrEqual(1);
      expect(Number(rank)).toBeLessThanOrEqual(FEATURED_PICKS_MAX);
    }
  });

  it("refuses a database with real users", () => {
    expect(seed).toContain("Refusing to seed dev data: this database has real users. Wrong target?");
  });
});
