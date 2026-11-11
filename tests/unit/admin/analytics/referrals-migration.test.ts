import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The Referred friends list's function, as text — 0202 made it, 0206 made it
// again with the reward facts (the definition a database runs is 0206's, so
// that is the file read here): its signature and columns are the contract
// types/supabase.ts declares, it is the service role's alone, and it holds
// the rules the page relies on (newest first on a stable order, the page
// clamp, the friend's days by this referral's own reference with revoked
// entries left out, a row kept for a friend whose account is gone, each
// side's recorded reward, and the reward step's own tests for a confirmed
// email and a card on file). Its results are checked on a real database by
// the PR's Supabase preview.
// ---------------------------------------------------------------------------

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0206_admin_referred_friends_rewards.sql"), "utf8");
const first = readFileSync(join(process.cwd(), "supabase/migrations/0202_admin_referred_friends.sql"), "utf8");
const returnsOf = (text: string) =>
  (/returns table \(([\s\S]*?)\)\s*language sql/.exec(
    text
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n"),
  )?.[1] ?? "")
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("admin_referred_friends (0202, widened by 0206)", () => {
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
    expect(expected.length).toBe(27);
    expect(columns).toEqual(expected);
  });

  it("keeps 0202's nineteen columns as they were, in their places, and adds eight after them", () => {
    const before = returnsOf(first);
    const now = returnsOf(sql);
    expect(before).toHaveLength(19);
    expect(now.slice(0, 19)).toEqual(before);
    expect(now.slice(19)).toEqual([
      "referrer_reward text",
      "referee_reward text",
      "referrer_reward_detail jsonb",
      "referee_reward_detail jsonb",
      "grant_attempts integer",
      "referee_email_confirmed boolean",
      "referrer_email_confirmed boolean",
      "referee_has_plan boolean",
    ]);
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
    // Nothing else of auth.users is read: no address, phone or metadata.
    expect(code).not.toMatch(/_login\.(email|phone|raw_\w+|encrypted_password)\b(?!_confirmed_at)/);
  });

  it("judges a card on file as the reward step does (lib/referrals/server.ts CARD_ON_FILE_STATUSES)", () => {
    const server = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8");
    const statuses = /CARD_ON_FILE_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? "";
    const expected = [...statuses.matchAll(/"(\w+)"/g)].map((m) => `'${m[1]}'`).join(", ");
    expect(expected).not.toBe("");
    expect(code).toContain("friend.stripe_subscription_id is not null");
    expect(code).toContain(`coalesce(friend.subscription_status, '') in (${expected})`);
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

  it("runs as the migration runner sends it: no transaction or lock statements of its own, nothing written", () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(code).not.toMatch(/\block table\b/i);
    expect(code).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Ships through a PR; never");
    expect(sql).toContain("Grants are explicit (0097)");
  });
});
