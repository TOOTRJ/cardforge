import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The Referred friends list's function, as text — 0202 made it, 0206 made it
// again with the reward facts, and 0208 once more with the friend's cards
// WITH ARTWORK (the cards a referral counts since 2026-11-11). The
// definition a database runs is 0208's, so that is the file read here: its
// signature and columns are the contract types/supabase.ts declares, it is
// the service role's alone, and it holds the rules the page relies on
// (newest first on a stable order, the page clamp, the friend's days by this
// referral's own reference with revoked entries left out, a row kept for a
// friend whose account is gone, each side's recorded reward, the reward
// step's own tests for a confirmed email and a card on file — a fact now,
// no condition — and the artwork count by the very test the sweep and the
// app use). Its results are checked on a real database by the PR's Supabase
// preview.
// ---------------------------------------------------------------------------

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const migration = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
/** A migration's statements, its `--` comment lines left out. */
const codeOf = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const LIVE = "0208_referrals_cards_only.sql";
const sql = migration(LIVE);
const whole = codeOf(sql);
// 0208 makes three functions; the list's is the last: from its drop to the
// file's end. Everything below that speaks of "the function" reads this.
const listStart = whole.indexOf("drop function if exists public.admin_referred_friends(");
const code = listStart >= 0 ? whole.slice(listStart) : "";
const first = codeOf(migration("0202_admin_referred_friends.sql"));
const widened = codeOf(migration("0206_admin_referred_friends_rewards.sql"));
/** The columns of the first `returns table (…) language sql` in `text`. */
const returnsOf = (text: string) =>
  (/returns table \(([\s\S]*?)\)\s*language sql/.exec(text)?.[1] ?? "")
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
/** The cards a referral counts, as SQL says it of a `public.cards c`. */
const WITH_ARTWORK = "c.art_url is not null and c.art_url <> ''";

describe("admin_referred_friends (0202, widened by 0206 and 0208)", () => {
  it("0208's is the definition a database runs: no later migration makes the function again", () => {
    const makers = readdirSync(MIGRATIONS)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort()
      .filter((name) => codeOf(migration(name)).includes("function public.admin_referred_friends("));
    expect(makers).toEqual(["0202_admin_referred_friends.sql", "0206_admin_referred_friends_rewards.sql", LIVE]);
    expect(listStart).toBeGreaterThan(-1);
    // One definition in the file, and the slice read here holds it.
    expect(whole.match(/create or replace function public\.admin_referred_friends\(/g)).toHaveLength(1);
    expect(code).toContain("create or replace function public.admin_referred_friends(");
  });

  it("has the declared signature and is idempotent", () => {
    expect(code).toMatch(/drop function if exists public\.admin_referred_friends\(integer, integer\);/);
    expect(code).toMatch(/create or replace function public\.admin_referred_friends\(\s*p_limit integer default 50,\s*p_offset integer default 0\s*\)/);
  });

  it("returns exactly the columns types/supabase.ts declares, in order", () => {
    const declared = /admin_referred_friends: \{\s*Args: \{[^}]*\};\s*Returns: \{([^}]*)\}\[\];/.exec(types)?.[1] ?? "";
    const expected = [...declared.matchAll(/(\w+):/g)].map((m) => m[1]);
    const returns = /returns table \(([\s\S]*?)\)\s*language sql/.exec(code)?.[1] ?? "";
    const columns = returns
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(expected.length).toBe(28);
    expect(columns).toEqual(expected);
    expect(expected.at(-1)).toBe("referee_art_cards");
    // A count: never null (the page reads null as "a database before 0208").
    expect(declared).toMatch(/referee_art_cards: number;/);
  });

  it("keeps 0202's nineteen columns as they were, in their places, 0206's eight after them, and adds one last", () => {
    const before = returnsOf(first);
    const then = returnsOf(widened);
    const now = returnsOf(code);
    expect(before).toHaveLength(19);
    expect(now.slice(0, 19)).toEqual(before);
    const eight = [
      "referrer_reward text",
      "referee_reward text",
      "referrer_reward_detail jsonb",
      "referee_reward_detail jsonb",
      "grant_attempts integer",
      "referee_email_confirmed boolean",
      "referrer_email_confirmed boolean",
      "referee_has_plan boolean",
    ];
    expect(then.slice(19)).toEqual(eight);
    expect(now.slice(19, 27)).toEqual(eight);
    // 0206's twenty-seven, untouched, in their places…
    expect(then).toHaveLength(27);
    expect(now.slice(0, 27)).toEqual(then);
    // …and the twenty-eighth after them.
    expect(now).toHaveLength(28);
    expect(now.slice(27)).toEqual(["referee_art_cards bigint"]);
  });

  it("the 28th column counts the friend's cards WITH ARTWORK, beside the count of all of them", () => {
    // One read of the friend's cards gives every count: all, public, with artwork.
    const made = /left join lateral \(\s*select([\s\S]*?)from public\.cards c\s+where c\.owner_id = l\.referee_id\s*\) made on true/.exec(code)?.[1] ?? "";
    expect(made).toContain("count(*) as cards,");
    expect(made).toContain(`count(*) filter (where ${WITH_ARTWORK}) as art_cards,`);
    // The last value selected, in the 28th column's place — and never NULL.
    const selected = /\n  select\n([\s\S]*?)\n  from listed l\n/.exec(code)?.[1] ?? "";
    const values = selected.trim().split("\n").map((line) => line.trim());
    expect(values.at(-1)).toBe("coalesce(made.art_cards, 0)");
    expect(code.match(/made\.art_cards/g)).toHaveLength(1);
    // Every card is still counted as it was (the Cards column).
    expect(selected).toContain("coalesce(made.cards, 0),");
  });

  it("counts the same cards as the hourly sweep's stranded signups and the app's own count", () => {
    // The sweep's read of signed-up friends who have the cards (0208, part 1).
    const stranded = /create or replace function public\.referrals_stranded_signups\(([\s\S]*?)\$\$;/.exec(whole)?.[1] ?? "";
    expect(stranded).not.toBe("");
    expect(stranded.replace(/\s+/g, " ")).toContain(
      `( select count(*) from public.cards c where c.owner_id = r.referee_id and ${WITH_ARTWORK} ) >= greatest(1, coalesce(p_cards, 1))`,
    );
    // The app (lib/referrals/server.ts): the same column, set and not empty.
    const server = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8");
    const column = /QUALIFYING_CARD = \{ column: "(\w+)" \}/.exec(server)?.[1];
    expect(column).toBe("art_url");
    expect(WITH_ARTWORK).toBe(`c.${column} is not null and c.${column} <> ''`);
    expect(server).toMatch(/\.not\(QUALIFYING_CARD\.column, "is", null\)\s*\.neq\(QUALIFYING_CARD\.column, ""\)/);
  });

  it("hands out each side's reward as the reward step recorded it", () => {
    for (const column of ["referrer_reward", "referee_reward", "referrer_reward_detail", "referee_reward_detail", "grant_attempts"]) {
      expect(code).toContain(`r.${column},`);
      expect(code).toContain(`l.${column},`);
    }
  });

  it("judges a confirmed email as the reward step does — a flag, never an address — and NULL for an account that is gone", () => {
    expect(code).toMatch(/left join auth\.users friend_login on friend_login\.id = \w+\.referee_id/);
    expect(code).toMatch(/left join auth\.users referrer_login on referrer_login\.id = \w+\.referrer_id/);
    expect(code).toContain("case when friend_login.id is null then null else friend_login.email_confirmed_at is not null end");
    expect(code).toContain("case when referrer_login.id is null then null else referrer_login.email_confirmed_at is not null end");
    // Nothing else of auth.users is read — no address, phone, token or
    // metadata: every column named is the id (the join) or the stamp.
    const columns = [...code.matchAll(/\b(?:friend|referrer)_login\.(\w+)/g)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThanOrEqual(6);
    expect([...new Set(columns)].sort()).toEqual(["email_confirmed_at", "id"]);
    expect(code.match(/\bauth\.\w+/g)).toEqual(["auth.users", "auth.users"]);
  });

  it("judges a card on file as the app does (lib/referrals/server.ts CARD_ON_FILE_STATUSES) — a fact it still hands out", () => {
    const server = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8");
    const statuses = /CARD_ON_FILE_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? "";
    const expected = [...statuses.matchAll(/"(\w+)"/g)].map((m) => `'${m[1]}'`).join(", ");
    expect(expected).not.toBe("");
    expect(code).toContain("friend.stripe_subscription_id is not null");
    expect(code).toContain(`coalesce(friend.subscription_status, '') in (${expected})`);
    // …and the row's own stamp of it, as before.
    expect(code).toContain("r.card_on_file_at,");
    expect(code).toContain("l.card_on_file_at,");
  });

  it("is a stable SQL function with a fixed empty search_path, every object schema-qualified", () => {
    expect(code).toMatch(/language sql\s+stable\s+security definer\s+set search_path = ''/);
    for (const table of ["referrals", "profiles", "cards", "day_bank_entries"]) {
      expect(code).toContain(`public.${table}`);
      expect(code).not.toMatch(new RegExp(`(from|join)\\s+${table}\\b`));
    }
    expect(code).not.toMatch(/(from|join)\s+users\b/);
    expect(code).toContain("public.subscription_perks_on(");
  });

  it("is the service role's alone", () => {
    expect(code).toMatch(/revoke all on function public\.admin_referred_friends\(integer, integer\) from public, anon, authenticated;/);
    expect(code).toMatch(/grant execute on function public\.admin_referred_friends\(integer, integer\) to service_role;/);
    expect(code).not.toMatch(/to (anon|authenticated)\b/);
  });

  it("lists newest signups first on an order that ends on the id, and clamps the page", () => {
    expect(code.match(/order by \w+\.signed_up_at desc, \w+\.id desc/g)).toHaveLength(2);
    expect(code).toContain("limit greatest(1, least(coalesce(p_limit, 50), 200))");
    expect(code).toContain("offset greatest(0, coalesce(p_offset, 0))");
    expect(code).toContain("count(*) over () as total_count");
  });

  it("keeps a row for a friend whose account is gone (left joins, a NULL plan)", () => {
    expect(code).toMatch(/left join public\.profiles friend on friend\.id = \w+\.referee_id/);
    expect(code).toMatch(/when friend\.id is null then null/);
    expect(code).not.toMatch(/\n\s*join public\.profiles/);
  });

  it("counts the friend's days from THIS referral's entry, revoked ones left out", () => {
    expect(code).toContain("e.reference = 'referral:' || l.id::text || ':referee'");
    expect(code).toContain("e.source = 'referral_friend'");
    expect(code).toContain("e.status <> 'revoked'");
  });

  it("reads 0177's stamp on a row that has no cards_saved_at", () => {
    expect(code).toContain("coalesce(r.cards_saved_at, r.first_card_at) as cards_saved_at");
  });

  it("runs as the migration runner sends it: no transaction or lock statements of its own, and the list writes nothing", () => {
    // The whole file (its other two functions too).
    expect(whole).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(whole).not.toMatch(/\block table\b/i);
    // The list only reads.
    expect(code).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Ships through a PR; never");
    expect(sql).toContain("Grants are explicit (0097)");
  });
});
