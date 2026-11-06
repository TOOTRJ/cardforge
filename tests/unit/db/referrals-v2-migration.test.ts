import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The referrals v2 migration (0180, owner 2026-11-06): the two bars (cards
// saved + a card on file) and the ladder step on the row, the statuses and
// reward kinds widened (never narrowed), the claim's v2 — the friends cap
// and the referrer's step under the NAMED lock, service role only — the
// admin stats answering the chain, the per-day counts, the ladder and the
// days bank, and the settings row rewritten to the v2 shape with the
// switch and the friends cap kept. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_referrals_v2\.sql$/.test(f));
const file = files[0] ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

/** The body of one `create [or replace] function public.<name>(` … `$$;`. */
function fn(name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$", start);
  const tag = sql.slice(open, sql.indexOf("$", open + 1) + 1);
  const end = sql.indexOf(tag, sql.indexOf(tag, open) + tag.length);
  return sql.slice(start, end + tag.length);
}

describe("the referrals v2 migration", () => {
  it("is one file, after the days bank", () => {
    expect(files).toHaveLength(1);
    const bank = readdirSync(dir).find((f) => /^\d{4}_day_bank\.sql$/.test(f)) ?? "";
    expect(file.slice(0, 4) > bank.slice(0, 4)).toBe(true);
  });

  it("adds the two stamps and the ladder step, widens the statuses and reward kinds (never narrows), and grants the user the new columns", () => {
    expect(sql).toContain("add column if not exists cards_saved_at timestamptz");
    expect(sql).toContain("add column if not exists card_on_file_at timestamptz");
    expect(sql).toMatch(/add column if not exists ladder_step integer check \(ladder_step is null or ladder_step >= 1\)/);
    expect(sql).toMatch(/check \(status in \('signed_up', 'first_card', 'cards_saved', 'rewarded', 'capped', 'blocked', 'expired'\)\)/);
    for (const side of ["referrer", "referee"]) {
      expect(sql).toMatch(new RegExp(`check \\(${side}_reward is null or ${side}_reward in \\('free_days', 'banked_days', 'credits', 'none'\\)\\)`));
    }
    // 0177's qualified rows carry the new stamp too.
    expect(sql).toContain("update public.referrals set cards_saved_at = first_card_at where cards_saved_at is null and first_card_at is not null;");
    expect(sql).toContain("grant select (cards_saved_at, card_on_file_at, ladder_step) on public.referrals to authenticated;");
  });

  it("the claim v2: the friends cap and a block reason only, the step counted under the referrer's NAMED lock, one qualified row moved once; service role only", () => {
    const body = fn("claim_referral_reward_v2");
    expect(body).toContain("returns table (outcome text, step int)");
    expect(body).toContain("security definer");
    expect(body).toContain("perform pg_advisory_xact_lock(hashtext('pipglyph.referrals'), hashtext(v_row.referrer_id::text));");
    expect(body).toContain("for update");
    expect(body).toContain("if v_row.status not in ('cards_saved', 'first_card') then");
    // The friends cap counts rewarded, capped and referrer-blocked rows alike (each rewarded the friend).
    expect(body).toMatch(/status in \('rewarded', 'capped', 'blocked'\)\s+and referee_reward is distinct from 'none'/);
    expect(body).toContain("v_step := case when v_outcome = 'rewarded' then v_rewarded + 1 else null end;");
    expect(body).not.toContain("p_monthly_cap");
    expect(body).not.toContain("p_lifetime_cap");
    expect(sql).toContain("revoke all on function public.claim_referral_reward_v2(uuid, int, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_referral_reward_v2(uuid, int, text) to service_role;");
  });

  it("the admin stats answer the chain with the card on file, the per-day counts, the ladder's distribution and credits, and the days bank — admins or the service role only", () => {
    const body = fn("admin_referral_stats");
    expect(body).toMatch(/if not public\.viewer_is_admin\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role' then/);
    for (const key of ["'cardsSaved'", "'cardOnFile'", "'waiting'", "'grantsOwed'", "'perDay'", "'ladderSteps'", "'ladderCredits'", "'bank'", "'bySource'", "'usersWithBank'", "'signupRevoked'"]) {
      expect(body, key).toContain(key);
    }
    expect(body).toContain("from public.day_bank_entries");
    expect(body).toContain("where reason = 'referral_credits'");
    expect(sql).toContain("revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.admin_referral_stats(timestamptz) to service_role;");
  });

  it("the sweep's reads are the database's (check P2): cards_saved rows whose friend now holds a subscription, and stranded signups judged on the card count — service role only", () => {
    const awaiting = fn("referrals_awaiting_plan");
    expect(awaiting).toContain("returns setof public.referrals");
    expect(awaiting).toContain("join public.profiles p on p.id = r.referee_id");
    expect(awaiting).toContain("and r.card_on_file_at is null");
    expect(awaiting).toContain("and p.subscription_status in ('trialing', 'active', 'past_due', 'unpaid')");
    const stranded = fn("referrals_stranded_signups");
    expect(stranded).toContain("returns table (id uuid, referee_id uuid)");
    expect(stranded).toMatch(/select count\(\*\) from public\.cards c where c\.owner_id = r\.referee_id\) >= greatest\(1, coalesce\(p_cards, 1\)\)/);
    for (const sig of ["referrals_awaiting_plan(int)", "referrals_stranded_signups(int, timestamptz, timestamptz, int)"]) {
      expect(sql).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${sig} to service_role;`);
    }
  });

  it("rewrites the settings row to the v2 shape, keeping the switch and the friends cap, and seeds it where missing", () => {
    expect(sql).toMatch(/'enabled', coalesce\(\(value->>'enabled'\)::boolean, true\)/);
    expect(sql).toMatch(/'friendsPerMonth', coalesce\(\(value->'caps'->>'friendsPerMonth'\)::int, 5\)/);
    expect(sql).toContain("and not (value ? 'ladder')");
    // The owner's ladder (2026-11-06): 7d, 5cr, 7d, 10cr, 14d, 20cr, 21d, 50cr, 21d, 30d; the tail 7d.
    const ladder = [...sql.matchAll(/jsonb_build_object\('kind', '(days|credits)', '(days|amount)', (\d+)\)/g)].map((m) => `${m[1]}:${m[3]}`);
    expect(ladder).toEqual(["days:7", "credits:5", "days:7", "credits:10", "days:14", "credits:20", "days:21", "credits:50", "days:21", "days:30", "days:7"]);
    expect(sql).toMatch(/on conflict \(key\) do nothing;/);
  });

  it("the seed shows a v2 row and bank entries with no credential", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds", "37_referrals.sql"), "utf8");
    expect(seed).toContain("cards_saved_at");
    expect(seed).toContain("ladder_step");
    expect(seed).toContain("'banked_days'");
    expect(seed).toContain("referral-step:");
    expect(seed).not.toMatch(/password|sk_(live|test)_|service_role_key/i);
  });
});
