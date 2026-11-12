import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// lib/referrals/server.ts is read for ONE constant (the cards that count);
// its two heavy imports are stubs, as in its own tests.
vi.mock("@/lib/billing/day-bank", () => ({ bankDays: vi.fn(), releaseStaleReservations: vi.fn() }));
vi.mock("@/lib/referrals/settings-server", () => ({ readReferralSettings: vi.fn() }));

import { QUALIFYING_CARD } from "@/lib/referrals/server";

// ---------------------------------------------------------------------------
// 0208_referrals_cards_only.sql, as text (owner 2026-11-11: a referral
// rewards on the friend's CARDS ALONE; a plan with a card on file is no
// condition any more). The rule itself lives in the app; this file is the
// database's half and restates three functions:
//
//   referrals_stranded_signups  the sweep's read of signed-up rows whose
//                               friend has the cards — now only the cards
//                               WITH ARTWORK, the app's own count;
//   claim_referral_reward_v2    0180's claim with ONE predicate changed: the
//                               friends cap counts every rewarded referral
//                               (0180 skipped a rewarded row whose friend's
//                               side was 'none', so a friend reward of 0
//                               days never tripped the cap);
//   admin_referred_friends      the admin's list, with the cards that count
//                               (its columns are tests/unit/admin/analytics/
//                               referrals-migration.test.ts's).
//
// Everything else about the first two is held to 0180's text, statement for
// statement. Results are checked on a real database by the PR's Supabase
// preview.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
/** A migration without its `--` comment lines. */
const stripComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const sql = readFileSync(join(dir, "0208_referrals_cards_only.sql"), "utf8");
const code = stripComments(sql);
const v2 = stripComments(readFileSync(join(dir, "0180_referrals_v2.sql"), "utf8"));

/** One function's whole statement: `create or replace function public.<name>(` … `$$;`. */
function statementOf(text: string, name: string): string {
  const start = text.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("$$;", start);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return text.slice(start, end + 3);
}
/** A function's own SQL, between its dollar quotes. */
const bodyOf = (statement: string) => /as \$\$([\s\S]*?)\$\$;/.exec(statement)?.[1] ?? "";
/** The same SQL whatever its line breaks and indentation. */
const squash = (text: string) => text.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
/** The migration with every function body taken out: what runs as a statement of its own. */
const outsideBodies = code.replace(/as \$\$[\s\S]*?\$\$;/g, () => "as <body>;");

const stranded = statementOf(code, "referrals_stranded_signups");
const claim = statementOf(code, "claim_referral_reward_v2");
const friends = statementOf(code, "admin_referred_friends");

/** The bar's count, in SQL, for a table alias. */
const artPredicate = (alias: string) => `${alias}.${QUALIFYING_CARD.column} is not null and ${alias}.${QUALIFYING_CARD.column} <> ''`;

describe("0208 referrals_stranded_signups — only cards with artwork count", () => {
  it("keeps its signature, return shape and settings", () => {
    expect(stranded).toMatch(
      /^create or replace function public\.referrals_stranded_signups\(\s*p_cards int,\s*p_since timestamptz,\s*p_until timestamptz,\s*p_limit int default 100\s*\)\s*returns table \(id uuid, referee_id uuid\)\s*language sql\s*stable\s*security definer\s*set search_path = public\s*as \$\$/,
    );
    // Replaced in place: the signature did not change, so nothing is dropped.
    expect(code).not.toMatch(/drop function[^;]*referrals_stranded_signups/);
  });

  it("counts the friend's cards whose art_url is set AND not empty against the bar", () => {
    const body = squash(bodyOf(stranded));
    expect(body).toContain(
      `and (select count(*) from public.cards c where c.owner_id = r.referee_id and ${artPredicate("c")}) >= greatest(1, coalesce(p_cards, 1))`,
    );
    // One count, and it is the filtered one: no bare "every card" count is left.
    expect(body.match(/select count\(\*\)/g)).toHaveLength(1);
    expect(body).not.toContain("where c.owner_id = r.referee_id) >=");
  });

  it("is otherwise 0180's function, word for word: the same rows (signed_up, a friend, the window), order and clamp", () => {
    const before = squash(statementOf(v2, "referrals_stranded_signups"));
    const oldCount = "(select count(*) from public.cards c where c.owner_id = r.referee_id) >= greatest(1, coalesce(p_cards, 1))";
    const newCount = `(select count(*) from public.cards c where c.owner_id = r.referee_id and ${artPredicate("c")}) >= greatest(1, coalesce(p_cards, 1))`;
    expect(before.split(oldCount)).toHaveLength(2);
    expect(squash(stranded)).toBe(before.replace(oldCount, newCount));
    // …which still says what the sweep relies on.
    const body = squash(bodyOf(stranded));
    for (const rule of [
      "where r.status = 'signed_up'",
      "and r.referee_id is not null",
      "and r.signed_up_at >= p_since",
      "and r.signed_up_at < p_until",
      "order by r.signed_up_at asc",
      "limit greatest(1, least(coalesce(p_limit, 100), 500))",
    ]) {
      expect(body, rule).toContain(rule);
    }
  });
});

describe("0208 claim_referral_reward_v2 — the friends cap counts every rewarded referral", () => {
  it("keeps its signature and return shape (replaced in place, never dropped)", () => {
    expect(claim).toMatch(
      /^create or replace function public\.claim_referral_reward_v2\(\s*p_referral_id uuid,\s*p_friends_cap int default null,\s*p_block_reason text default null\s*\)\s*returns table \(outcome text, step int\)\s*language plpgsql\s*volatile\s*security definer\s*set search_path = public\s*as \$\$/,
    );
    expect(code).not.toMatch(/drop function[^;]*claim_referral_reward_v2/);
  });

  it("still takes the referrer's NAMED advisory lock, re-reads the row under it, and only moves a qualified row", () => {
    const lock = "perform pg_advisory_xact_lock(hashtext('pipglyph.referrals'), hashtext(v_row.referrer_id::text));";
    const reread = "select * into v_row from public.referrals where id = p_referral_id for update;";
    const gate = "if v_row.status not in ('cards_saved', 'first_card') then";
    const count = "select count(*) into v_friends";
    const write = "update public.referrals";
    for (const piece of [lock, reread, gate, count, write]) expect(claim.split(piece), piece).toHaveLength(2);
    // In that order: the lock before the re-read, the gate before any count, every count before the write.
    const places = [lock, reread, gate, count, write].map((piece) => claim.indexOf(piece));
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // The gate returns nothing (the claim was won elsewhere, or the row is not qualified).
    expect(squash(claim)).toContain(`${gate} return; end if;`);
  });

  it("the friends cap: a REWARDED row counts whatever the friend's side came to; a blocked row only while its friend was rewarded; a capped row never", () => {
    const cap = /select count\(\*\) into v_friends([\s\S]*?);/.exec(claim)?.[1] ?? "";
    expect(squash(cap)).toBe(
      "from public.referrals where referrer_id = v_row.referrer_id " +
        "and (status = 'rewarded' or (status = 'blocked' and referee_reward is distinct from 'none')) " +
        "and rewarded_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'",
    );
    expect(cap).not.toContain("'capped'");
    // 0180's predicate — a rewarded row skipped when the friend's side was 'none' — is gone.
    expect(squash(claim)).not.toContain("status in ('rewarded', 'capped', 'blocked')");
    // The cap is still compared as it was.
    expect(claim).toContain("when p_friends_cap is not null and v_friends >= p_friends_cap then 'capped_friends'");
  });

  it("is otherwise IDENTICAL to 0180's claim: the one predicate swapped, every other statement the same", () => {
    const before = squash(statementOf(v2, "claim_referral_reward_v2"));
    const oldPredicate = "and status in ('rewarded', 'capped', 'blocked') and referee_reward is distinct from 'none'";
    const newPredicate = "and (status = 'rewarded' or (status = 'blocked' and referee_reward is distinct from 'none'))";
    // The predicate is there once in 0180, so the swap is the whole difference.
    expect(before.split(oldPredicate)).toHaveLength(2);
    expect(squash(claim)).toBe(before.replace(oldPredicate, newPredicate));
  });

  it("writes the one row it claims and nothing else", () => {
    const body = bodyOf(claim);
    expect(body.match(/\bupdate public\.\w+/g)).toEqual(["update public.referrals"]);
    expect(squash(body)).toContain("end where id = p_referral_id;");
    expect(body).not.toMatch(/\b(insert into|delete from)\b/i);
    // The bank and the ledger are the app's (grantOwedSides), never the claim's.
    expect(body).not.toMatch(/day_bank_entries|credit_ledger|grant_credits/);
  });
});

describe("0208 — the app and the database count the same cards", () => {
  it("the app's bar is the art_url column, set and not empty", () => {
    expect(QUALIFYING_CARD).toEqual({ column: "art_url" });
    const server = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8");
    expect(server).toContain('.not(QUALIFYING_CARD.column, "is", null)');
    expect(server).toContain('.neq(QUALIFYING_CARD.column, "")');
  });

  it("the sweep's stranded read and the admin list's art_cards count use that column, with both halves of the test", () => {
    expect(squash(bodyOf(stranded))).toContain(artPredicate("c"));
    const list = squash(bodyOf(friends));
    expect(list).toContain(`count(*) filter (where ${artPredicate("c")}) as art_cards`);
    expect(list).toContain("coalesce(made.art_cards, 0)");
    // The count is of the friend's own cards, beside the total it was added to.
    const made = /left join lateral \(\s*select\s+count\(\*\) as cards,[\s\S]*?\) made on true/.exec(bodyOf(friends))?.[0] ?? "";
    expect(made).toContain("as art_cards");
    expect(squash(made)).toContain("from public.cards c where c.owner_id = l.referee_id");
    // …and it is the list's LAST column, as declared.
    const returns = /returns table \(([\s\S]*?)\)\s*language sql/.exec(friends)?.[1] ?? "";
    expect(returns.split(",").map((part) => part.trim().replace(/\s+/g, " ")).at(-1)).toBe("referee_art_cards bigint");
    // No other spelling of "has art" anywhere in the file.
    const predicates = code.match(/\bc\.art_url[^\n,)]*/g) ?? [];
    expect(predicates.map((p) => p.trim()).sort()).toEqual(
      ["c.art_url <> ''", "c.art_url is not null", "c.art_url is not null and c.art_url <> ''"].sort(),
    );
  });
});

describe("0208 — grants, and what the file does not do", () => {
  const signatures = [
    "referrals_stranded_signups(int, timestamptz, timestamptz, int)",
    "claim_referral_reward_v2(uuid, int, text)",
    "admin_referred_friends(integer, integer)",
  ];

  it("defines exactly the three functions", () => {
    const created = [...code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(created).toEqual(["referrals_stranded_signups", "claim_referral_reward_v2", "admin_referred_friends"]);
  });

  it("states each function's grants: nothing through PUBLIC, anon or authenticated — the service role alone", () => {
    for (const signature of signatures) {
      expect(outsideBodies, signature).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(outsideBodies, signature).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    // Those six are every grant statement in the file.
    const grants = [...outsideBodies.matchAll(/^\s*grant\b[^;]*;/gim)].map((m) => squash(m[0]));
    expect(grants).toEqual(signatures.map((signature) => `grant execute on function public.${signature} to service_role;`));
    const revokes = [...outsideBodies.matchAll(/^\s*revoke\b[^;]*;/gim)].map((m) => squash(m[0]));
    expect(revokes).toEqual(signatures.map((signature) => `revoke all on function public.${signature} from public, anon, authenticated;`));
    expect(code).not.toMatch(/\bto (anon|authenticated|public)\b/i);
    // Each grant follows its own function (a re-created function starts with PUBLIC's default execute).
    for (const [index, signature] of signatures.entries()) {
      const name = signature.slice(0, signature.indexOf("("));
      const defined = code.indexOf(`create or replace function public.${name}(`);
      const revoked = code.indexOf(`revoke all on function public.${signature}`);
      const next = index + 1 < signatures.length ? code.indexOf(`function public.${signatures[index + 1].slice(0, signatures[index + 1].indexOf("("))}(`) : code.length;
      expect(revoked, signature).toBeGreaterThan(defined);
      expect(revoked, signature).toBeLessThan(next);
    }
  });

  it("runs as the migration runner sends it: no transaction or lock statements of its own", () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(code).not.toMatch(/\bstart transaction\b/i);
    expect(code).not.toMatch(/\block table\b/i);
  });

  it("rewrites no row: outside the function bodies nothing is inserted, updated or deleted — the claim's own update is the only write in the file", () => {
    expect(outsideBodies).not.toMatch(/\b(insert into|update public\.|delete from|truncate)\b/i);
    expect(outsideBodies).not.toMatch(/\balter table\b/i);
    expect(code.match(/\bupdate public\.\w+/g)).toEqual(["update public.referrals"]);
    expect(code).not.toMatch(/\b(insert into|delete from)\b/i);
    // The two readers read.
    for (const reader of [stranded, friends]) {
      expect(reader).toMatch(/language sql\s+stable/);
      expect(bodyOf(reader)).not.toMatch(/\b(insert|update|delete)\b/i);
    }
  });

  it("leaves referrals_awaiting_plan alone — the deployment before this one still calls it — and drops only the admin list it re-types", () => {
    // Named in the header's comments only: neither dropped nor redefined.
    expect(sql).toContain("referrals_awaiting_plan");
    expect(code).not.toContain("referrals_awaiting_plan");
    const drops = [...code.matchAll(/^\s*drop\b[^;]*;/gim)].map((m) => squash(m[0]));
    expect(drops).toEqual(["drop function if exists public.admin_referred_friends(integer, integer);"]);
    // 0180's definition is the one a database keeps.
    expect(v2).toContain("create or replace function public.referrals_awaiting_plan(p_limit int default 100)");
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Ships through a PR; never");
    expect(sql).toContain("Grants are explicit (0097)");
    expect(sql).toContain("Idempotent.");
  });
});
