import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0208_referrals_cards_only.sql, as text (owner 2026-11-11: a referral
// rewards on the friend's CARDS ALONE; a plan with a card on file is no
// condition any more). The rule itself lives in the app; this file is the
// database's half: ONE new function, three restated ones and one column
// grant taken back.
//
//   referral_qualifying_cards   NEW — the ONE count of the cards a referral
//                               counts: the DIFFERENT pictures on the
//                               owner's cards that sit in their own
//                               card-art/<id>/ folder (no picture, a
//                               built-in image, a frame preview or a
//                               picture already counted adds nothing). The
//                               app (lib/referrals/server.ts), the stranded
//                               read and the admin's list all call it — no
//                               second spelling of "has art" anywhere;
//   referrals_stranded_signups  the sweep's read of signed-up rows whose
//                               friend has the cards — by that count;
//   claim_referral_reward_v2    0180's claim with ONE predicate changed: the
//                               friends cap counts every rewarded referral
//                               (0180 skipped a rewarded row whose friend's
//                               side was 'none', so a friend reward of 0
//                               days never tripped the cap);
//   admin_referred_friends      the admin's list, with the cards that count
//                               (its columns are tests/unit/admin/analytics/
//                               referrals-migration.test.ts's);
//   referrals.card_on_file_at   the column grant 0180 gave signed-in users
//                               is REVOKED (a referrer no longer reads
//                               whether a friend subscribed), with a
//                               self-check that fails the migration if an
//                               API role can still read it. The two other
//                               columns 0180 granted stay granted.
//
// Everything else about the stranded read and the claim is held to 0180's
// text, statement for statement. Results are checked on a real database by
// the PR's Supabase preview.
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

/** The file's `--` comment lines as running prose (their wraps taken out). */
const header = sql
  .split("\n")
  .filter((line) => line.trim().startsWith("--"))
  .map((line) => line.trim().replace(/^--\s?/, ""))
  .join(" ")
  .replace(/\s+/g, " ");

const COUNT = "referral_qualifying_cards";
const qualifying = statementOf(code, COUNT);
const stranded = statementOf(code, "referrals_stranded_signups");
const claim = statementOf(code, "claim_referral_reward_v2");
const friends = statementOf(code, "admin_referred_friends");

/** The bar's test in the stranded read: the ONE count, for the row's friend. */
const STRANDED_BAR = `public.${COUNT}(r.referee_id) >= greatest(1, coalesce(p_cards, 1))`;
/** The anonymous block(s) the file runs: `do $$ … $$;`. */
const doBlocks = [...code.matchAll(/^do \$\$([\s\S]*?)\$\$;/gm)].map((m) => m[1]);

describe("0208 referral_qualifying_cards — the ONE count of the cards a referral counts", () => {
  it("is a new function of one owner that returns a count: SQL, stable, security definer, an EMPTY search_path", () => {
    expect(qualifying).toMatch(
      /^create or replace function public\.referral_qualifying_cards\(p_owner uuid\)\s*returns bigint\s*language sql\s*stable\s*security definer\s*set search_path = ''\s*as \$\$/,
    );
    // New in this file: nothing to drop, and defined once.
    expect(code).not.toMatch(/drop function[^;]*referral_qualifying_cards/);
    expect(code.match(/create (?:or replace )?function public\.referral_qualifying_cards\(/g)).toHaveLength(1);
    // Never STRICT: asked of a friend whose account is gone (a NULL owner)
    // it still answers a count — 0 — and the admin's list never holds NULL.
    expect(qualifying).not.toMatch(/\bstrict\b|returns null on null input/i);
  });

  it("counts the DIFFERENT pictures on the owner's cards that sit in the owner's own card-art folder — no frame preview", () => {
    expect(squash(bodyOf(qualifying))).toBe(
      "select count(distinct split_part(c.art_url, '?', 1)) from public.cards c " +
        "where c.owner_id = p_owner " +
        "and c.frame_preview is not true " +
        "and c.art_url like '%/card-art/' || p_owner::text || '/%';",
    );
  });

  it("each half of the rule, by itself: a picture once, the owner's cards, the owner's folder, never a preview — and never every row", () => {
    const body = squash(bodyOf(qualifying));
    // One picture on five cards is one: the count is of pictures, not rows —
    // and of the stored OBJECT, not its address: media_url_allowed (0127)
    // lets an address carry `?v=<digits>`, so the same upload under five
    // version suffixes must still be one picture.
    expect(body).toContain("count(distinct split_part(c.art_url, '?', 1))");
    expect(body).not.toContain("count(distinct c.art_url)");
    const allowed = readFileSync(join(process.cwd(), "supabase/migrations/0160_admin_articles.sql"), "utf8");
    // The only thing an allowed address may carry after the file's name.
    expect(allowed).toContain("(?:\\?v=[0-9]{1,20})?$'");
    expect(body).not.toContain("count(*)");
    // The owner's own cards…
    expect(body).toContain("c.owner_id = p_owner");
    // …whose picture is in THEIR folder: the owner's id sits between
    // `/card-art/` and the next `/` (a built-in image, or a NULL / empty
    // art_url, matches nothing).
    expect(body).toContain("c.art_url like '%/card-art/' || p_owner::text || '/%'");
    // An admin's frame preview is no card made (`is not true` keeps a NULL flag in).
    expect(body).toContain("c.frame_preview is not true");
    // With an empty search_path every object is schema-qualified.
    expect(body.match(/\b(?:from|join)\s+(\S+)/g)).toEqual(["from public.cards"]);
    // It reads: one statement, no write.
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(body.match(/;/g)).toHaveLength(1);
  });

  it("says what it is in the catalog", () => {
    expect(outsideBodies).toMatch(/comment on function public\.referral_qualifying_cards\(uuid\) is\s+'The cards a referral counts toward its bar \(0208\)/);
  });
});

describe("0208 referrals_stranded_signups — the same count", () => {
  it("keeps its signature, return shape and settings", () => {
    expect(stranded).toMatch(
      /^create or replace function public\.referrals_stranded_signups\(\s*p_cards int,\s*p_since timestamptz,\s*p_until timestamptz,\s*p_limit int default 100\s*\)\s*returns table \(id uuid, referee_id uuid\)\s*language sql\s*stable\s*security definer\s*set search_path = public\s*as \$\$/,
    );
    // Replaced in place: the signature did not change, so nothing is dropped.
    expect(code).not.toMatch(/drop function[^;]*referrals_stranded_signups/);
  });

  it("asks referral_qualifying_cards for the row's friend, against the bar — and counts no card itself", () => {
    const body = squash(bodyOf(stranded));
    expect(body).toContain(`and ${STRANDED_BAR}`);
    // The function is called once, schema-qualified (this reader's
    // search_path is `public`, the count's is empty).
    expect(body.match(/referral_qualifying_cards\(/g)).toHaveLength(1);
    // No count of its own is left: neither 0180's "every card" nor the first
    // version's inline art test — the cards table is not read here at all.
    expect(body).not.toContain("count(");
    expect(body).not.toContain("public.cards");
    expect(body).not.toContain("art_url");
    expect(body.match(/\b(?:from|join)\s+(\S+)/g)).toEqual(["from public.referrals"]);
  });

  it("is otherwise 0180's function, word for word: the same rows (signed_up, a friend, the window), order and clamp", () => {
    const before = squash(statementOf(v2, "referrals_stranded_signups"));
    const oldCount = "(select count(*) from public.cards c where c.owner_id = r.referee_id) >= greatest(1, coalesce(p_cards, 1))";
    expect(before.split(oldCount)).toHaveLength(2);
    expect(squash(stranded)).toBe(before.replace(oldCount, STRANDED_BAR));
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

describe("0208 — the app and the database count the same cards: ONE function", () => {
  const server = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8");
  /** The module without its comment lines. */
  const serverCode = server
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

  it("the app asks the database's function by the migration's own name, for the friend — and has no count of its own", () => {
    expect(serverCode).toContain(`rpc("${COUNT}"`);
    expect(serverCode).toContain(`admin.rpc("${COUNT}", { p_owner: refereeId })`);
    expect(serverCode.match(/referral_qualifying_cards/g)).toHaveLength(1);
    // The parameter the app names is the function's own.
    expect(qualifying).toContain(`public.${COUNT}(p_owner uuid)`);
    // No second spelling of "has art" in the app: the first version's
    // constant and its two filters are gone, and nothing reads art_url.
    expect(serverCode).not.toContain("QUALIFYING_CARD");
    expect(serverCode).not.toContain("art_url");
    // The `cards` table is read NOWHERE in the module (owner 2026-11-11,
    // code entry for new accounts): the bar's count is the database's
    // function, and "is this account new" at the claim is the account's age
    // and its plan history — it counted EVERY card until then, which refused
    // exactly the friends who type their code after making their cards.
    expect(serverCode.match(/\.from\("cards"\)/g)).toBeNull();
    expect(serverCode).not.toMatch(/from\(\s*["'`]cards["'`]\s*\)/);
    const claim = serverCode.slice(serverCode.indexOf("export async function recordReferralSignup"), serverCode.indexOf("export type GrantedReward"));
    expect(claim.length).toBeGreaterThan(500);
    // What the claim does read about the account: its plan history from the
    // profile, and WHEN IT WAS MADE from the sign-in record — never the
    // profile row's own created_at, which its owner can rewrite.
    expect(claim).toContain('.select("subscription_status")');
    expect(claim).toContain("authUserOf(admin, input.refereeId)");
    expect(claim).not.toContain("created_at");
    expect(claim).toContain("REFERRAL_CLAIM_WINDOW_DAYS");
    // …and nothing about its cards: no table, no count, no settings' bar.
    expect(claim).not.toMatch(/cards/i);
    expect(claim).not.toMatch(/\bcount\b/);
    expect(claim).not.toContain(COUNT);
  });

  it("types/supabase.ts declares it as the database defines it: one owner in, a number out", () => {
    const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
    expect(types).toMatch(/\n\s+referral_qualifying_cards: \{\s*Args: \{ p_owner: string \};\s*Returns: number;?\s*\};/);
    expect(types.match(/referral_qualifying_cards:/g)).toHaveLength(1);
  });

  it("BOTH database readers call it — the sweep's stranded read and the admin's list — and nothing else in the file says what a counted card is", () => {
    expect(squash(bodyOf(stranded))).toContain(`public.${COUNT}(r.referee_id)`);
    const list = squash(bodyOf(friends));
    expect(list).toContain(`public.${COUNT}(l.referee_id)`);
    // Every use of the function in the file, in order: its definition, its
    // comment and grants, then the two calls.
    const uses = [...code.matchAll(/public\.referral_qualifying_cards\(([^)]*)\)/g)].map((m) => m[1]);
    expect(uses).toEqual(["p_owner uuid", "uuid", "uuid", "uuid", "r.referee_id", "l.referee_id"]);
    // It is the list's LAST value, in its last column's place, as declared.
    const returns = /returns table \(([\s\S]*?)\)\s*language sql/.exec(friends)?.[1] ?? "";
    expect(returns.split(",").map((part) => part.trim().replace(/\s+/g, " ")).at(-1)).toBe("referee_art_cards bigint");
    const selected = /\n  select\n([\s\S]*?)\n  from listed l\n/.exec(bodyOf(friends))?.[1] ?? "";
    expect(selected.trim().split("\n").map((line) => line.trim()).at(-1)).toBe(`public.${COUNT}(l.referee_id)`);
    // The ONE count: `art_url` is named in the function's own body and
    // nowhere else — no inline "is not null and <> ''" test, no filtered
    // count in the list's lateral, no second folder pattern.
    expect(code.match(/art_url/g)).toHaveLength(2);
    expect(bodyOf(qualifying).match(/art_url/g)).toHaveLength(2);
    expect(code.match(/card-art/g)).toHaveLength(2);
    expect(bodyOf(qualifying).match(/card-art/g)).toHaveLength(1);
    expect(outsideBodies.match(/card-art/g)).toHaveLength(1); // the function's catalog comment
    for (const reader of [stranded, friends]) {
      expect(bodyOf(reader)).not.toContain("art_url");
      expect(bodyOf(reader)).not.toContain("art_cards");
    }
    expect(code).not.toMatch(/art_url is not null|art_url <> ''/);
    // The list still counts EVERY card beside it (the Cards column), in one
    // read of the friend's cards that no longer counts art.
    const made = /left join lateral \(\s*select\s+count\(\*\) as cards,[\s\S]*?\) made on true/.exec(bodyOf(friends))?.[0] ?? "";
    expect(squash(made)).toContain("from public.cards c where c.owner_id = l.referee_id");
    expect(made).not.toMatch(/art/);
  });

  it("no other migration defines the count: 0208's is the one a database runs", () => {
    const makers = readdirSync(dir)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort()
      .filter((name) => stripComments(readFileSync(join(dir, name), "utf8")).includes(`function public.${COUNT}(`));
    expect(makers).toEqual(["0208_referrals_cards_only.sql"]);
  });
});

describe("0208 — grants, and what the file does not do", () => {
  const signatures = [
    "referral_qualifying_cards(uuid)",
    "referrals_stranded_signups(int, timestamptz, timestamptz, int)",
    "claim_referral_reward_v2(uuid, int, text)",
    "admin_referred_friends(integer, integer)",
  ];
  /** The one privilege statement that is not about a function. */
  const COLUMN_REVOKE = "revoke select (card_on_file_at) on public.referrals from authenticated;";

  it("defines exactly the four functions — the count first, before the two readers that call it", () => {
    const created = [...code.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(created).toEqual(["referral_qualifying_cards", "referrals_stranded_signups", "claim_referral_reward_v2", "admin_referred_friends"]);
  });

  it("states each function's grants: nothing through PUBLIC, anon or authenticated — the service role alone", () => {
    for (const signature of signatures) {
      expect(outsideBodies, signature).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(outsideBodies, signature).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    // Those four are every GRANT statement in the file: nothing is granted
    // to an API role, and nothing on a table.
    const grants = [...outsideBodies.matchAll(/^\s*grant\b[^;]*;/gim)].map((m) => squash(m[0]));
    expect(grants).toEqual(signatures.map((signature) => `grant execute on function public.${signature} to service_role;`));
    // …and every REVOKE is one of theirs, or the one column taken back.
    const revokes = [...outsideBodies.matchAll(/^\s*revoke\b[^;]*;/gim)].map((m) => squash(m[0]));
    expect(revokes).toEqual([
      ...signatures.map((signature) => `revoke all on function public.${signature} from public, anon, authenticated;`),
      COLUMN_REVOKE,
    ]);
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
    // `outsideBodies` still holds the column revoke and its `do` block: a
    // privilege taken back and a check that raises — neither touches a row.
    expect(outsideBodies).toContain(COLUMN_REVOKE);
    expect(outsideBodies).toMatch(/^do \$\$/m);
    expect(outsideBodies).not.toMatch(/\b(insert into|update public\.|delete from|truncate)\b/i);
    expect(outsideBodies).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(outsideBodies).not.toMatch(/\balter table\b/i);
    expect(code.match(/\bupdate public\.\w+/g)).toEqual(["update public.referrals"]);
    expect(code).not.toMatch(/\b(insert into|delete from)\b/i);
    // The count and the two readers read.
    for (const reader of [qualifying, stranded, friends]) {
      expect(reader).toMatch(/language sql\s+stable/);
      expect(bodyOf(reader)).not.toMatch(/\b(insert|update|delete)\b/i);
    }
  });

  it("a referrer no longer reads whether a friend subscribed: the card_on_file_at column grant is taken back from signed-in users — that column alone", () => {
    // 0180 granted three columns in one statement; this file takes back one.
    expect(v2).toContain("grant select (cards_saved_at, card_on_file_at, ladder_step) on public.referrals to authenticated;");
    expect(outsideBodies.split(COLUMN_REVOKE)).toHaveLength(2);
    // A COLUMN revoke of SELECT, naming exactly one column.
    const columns = /revoke select \(([^)]*)\) on public\.referrals from authenticated;/.exec(outsideBodies)?.[1];
    expect(columns).toBe("card_on_file_at");
    // It comes after every function (the list that still hands the stamp to
    // admins is the service role's) and before its own check.
    expect(code.indexOf(COLUMN_REVOKE)).toBeGreaterThan(code.indexOf("grant execute on function public.admin_referred_friends(integer, integer) to service_role;"));
    expect(code.indexOf(COLUMN_REVOKE)).toBeLessThan(code.search(/^do \$\$/m));
  });

  it("the two other columns 0180 granted — cards_saved_at and ladder_step — are NOT revoked: the user's own page still reads them", () => {
    const revokes = [...outsideBodies.matchAll(/^\s*revoke\b[^;]*;/gim)].map((m) => squash(m[0]));
    for (const revoke of revokes) {
      expect(revoke, revoke).not.toMatch(/cards_saved_at|ladder_step/);
    }
    // No table-wide revoke either (it would take every column grant with it):
    // the one statement about the table names its one column.
    const onTable = revokes.filter((revoke) => /on (?:table )?public\.referrals\b/.test(revoke));
    expect(onTable).toEqual([COLUMN_REVOKE]);
    expect(code).not.toMatch(/revoke\s+(?:all|select)\s+on\s+(?:table\s+)?public\.referrals/i);
    // Nothing in the file names the two columns in a privilege statement at all.
    for (const statement of [...outsideBodies.matchAll(/^\s*(?:grant|revoke)\b[^;]*;/gim)].map((m) => m[0])) {
      expect(statement).not.toMatch(/cards_saved_at|ladder_step/);
    }
    // The app's read through the user's session asks for both — and never for the revoked one.
    const queries = readFileSync(join(process.cwd(), "lib/referrals/queries.ts"), "utf8");
    const selected = (/const REFERRAL_COLUMNS =\s*"([^"]+)"/.exec(queries)?.[1] ?? "").split(",").map((column) => column.trim());
    expect(selected).toContain("cards_saved_at");
    expect(selected).toContain("ladder_step");
    expect(selected).not.toContain("card_on_file_at");
    expect(queries).not.toContain("card_on_file_at");
  });

  it("checks itself: a `do` block after the revoke raises insufficient_privilege if authenticated OR anon can still read the column", () => {
    // One anonymous block in the file, and it is the file's last statement.
    expect(doBlocks).toHaveLength(1);
    expect(code.trimEnd().endsWith("end $$;")).toBe(true);
    const block = squash(doBlocks[0]);
    expect(block).toBe(
      "begin " +
        "if has_column_privilege('authenticated', 'public.referrals', 'card_on_file_at', 'SELECT') " +
        "or has_column_privilege('anon', 'public.referrals', 'card_on_file_at', 'SELECT') " +
        "then raise exception '0208: an API role can still read referrals.card_on_file_at' using errcode = 'insufficient_privilege'; " +
        "end if; end",
    );
    // Both API roles are asked about the SAME column with SELECT — a table
    // grant (which makes a column revoke a silent no-op) is caught too,
    // because has_column_privilege answers for either.
    const asked = [...block.matchAll(/has_column_privilege\('(\w+)', '([\w.]+)', '(\w+)', '(\w+)'\)/g)].map((m) => m.slice(1));
    expect(asked).toEqual([
      ["authenticated", "public.referrals", "card_on_file_at", "SELECT"],
      ["anon", "public.referrals", "card_on_file_at", "SELECT"],
    ]);
    // It only checks: no grant, revoke or write of its own, and it does not
    // swallow what it raises.
    expect(block).not.toMatch(/\b(insert|update|delete|truncate|alter|grant|revoke|drop|create)\b/i);
    expect(block).not.toMatch(/\bexception when\b/i);
    // The service role is not asked about: it keeps the column (the webhook's note, the admin's list).
    expect(block).not.toContain("service_role");
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

  it("says in its header how it ships, and what it changes", () => {
    expect(header).toContain("Ships through a PR; never applied ad-hoc.");
    expect(header).toContain("Grants are explicit (0097): all four functions are the service role's alone");
    expect(header).toContain("Idempotent.");
    // The four parts, as numbered.
    expect(header).toContain("1. ONLY CARDS WITH ARTWORK OF THEIR OWN COUNT toward the bar, each picture once.");
    expect(header).toContain("`referral_qualifying_cards(owner)` is the ONE count");
    expect(header).toContain("2. THE FRIENDS CAP COUNTS EVERY REWARDED REFERRAL.");
    expect(header).toContain("3. THE ADMIN'S LIST CARRIES THE COUNT THAT MATTERS.");
    expect(header).toContain("4. A REFERRER NO LONGER READS WHETHER A FRIEND SUBSCRIBED.");
  });
});
