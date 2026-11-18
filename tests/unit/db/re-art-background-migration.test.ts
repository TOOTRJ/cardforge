import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeNotification } from "@/lib/notifications/describe";

// ---------------------------------------------------------------------------
// Re-art deck — runs the server carries on after their page is closed
// (migration 0218: deck_reart_background, deck_reart_background_tokens and
// the bell's `reart_run` kind).
//
//   * The run's row is keyed on ONE column (the job) — never a composite
//     primary key over its foreign keys, which the API reads as a link
//     between two tables and then refuses embedded reads between them (the
//     0209 incident; 0210). It holds NO sign-in, and is written by the
//     server only; the owner reads their own while the tool is open to
//     them; the job is the row owner's own Re-art run and the deck theirs,
//     whoever writes.
//   * The borrowed ACCESS token is kept in a table of its own, sealed by
//     the app, that NO API role can read or write: row level security with
//     no policy, and no grant. Never a refresh token.
//   * The notification list is rewritten WHOLE from the latest one, plus
//     `reart_run`; every kind allowed before is still allowed.
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_background_runs\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
const kinds = (text: string) => {
  const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("0218 re-art deck: runs that go on without their page", () => {
  it("exists after the migration for AI-written scenes", () => {
    expect(file).not.toBe("");
    const before = files.find((f) => /^\d{4}_re_art_scene\.sql$/.test(f)) ?? "";
    expect(before).not.toBe("");
    expect(file > before).toBe(true);
  });

  it("makes two tables; the only other table it alters is the notifications' kind list", () => {
    expect(code.match(/create table if not exists public\.(\w+)/g)).toEqual([
      "create table if not exists public.deck_reart_background",
      "create table if not exists public.deck_reart_background_tokens",
    ]);
    expect([...new Set([...code.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(["deck_reart_background", "deck_reart_background_tokens", "notifications"]);
    expect(code).not.toMatch(/\b(update|insert into|delete from|truncate|drop table|drop column)\b\s+public\./i);
    // Nothing of the notifications table but its CHECK is touched.
    for (const statement of code.match(/alter table public\.notifications[\s\S]*?;/g) ?? []) expect(statement).toMatch(/notifications_type_check/);
  });

  it("each table is keyed on the JOB alone — never a link between two tables to the API", () => {
    expect(code).toMatch(/job_id uuid primary key references public\.ai_generation_jobs \(id\) on delete cascade/);
    expect(code).toMatch(/job_id uuid primary key references public\.deck_reart_background \(job_id\) on delete cascade/);
    expect(code.match(/primary\s+key/gi)).toHaveLength(2);
    expect(code).not.toMatch(/primary key \(/i);
  });

  it("goes with its job, its deck and its owner", () => {
    expect(code).toMatch(/owner_id uuid not null references public\.profiles \(id\) on delete cascade/);
    expect(code).toMatch(/deck_id uuid not null references public\.decks \(id\) on delete cascade/);
  });

  const tableOf = (name: string) => {
    const from = code.indexOf(`create table if not exists public.${name} (`);
    return code.slice(from, code.indexOf("\n);", from));
  };
  const columnsOf = (table: string) => [...table.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((name) => name !== "check");

  it("the run's row — the one its owner can read — holds NO sign-in: no token, cookie, session or secret column", () => {
    const table = tableOf("deck_reart_background");
    expect(columnsOf(table)).toEqual(["job_id", "owner_id", "deck_id", "state", "reason", "driver", "driven_until", "beat_at", "door_errors", "limited_keys", "started_at", "finished_at"]);
    expect(table).not.toMatch(/token|cookie|session|secret|jwt|refresh|sealed/i);
  });

  it("the states and the reasons are the ones the app writes and the bell words", () => {
    expect(code).toMatch(/check \(state in \('running', 'paused', 'stopped', 'finished'\)\)/);
    expect(code).toMatch(/check \(reason is null or reason in \('expired', 'error', 'credits', 'capacity', 'stopped'\)\)/);
    expect(code).toMatch(/door_errors integer not null default 0 check \(door_errors between 0 and 1000\)/);
    expect(code).toMatch(/limited_keys text\[\] not null default '\{\}'/);
    // The driver's read is indexed: the runs being carried.
    expect(code).toMatch(/on public\.deck_reart_background \(beat_at\) where state = 'running'/);
  });

  it("the borrowed token is kept SEALED in a table of its own that no API role can reach — and goes with its run", () => {
    const table = tableOf("deck_reart_background_tokens");
    expect(columnsOf(table)).toEqual(["job_id", "sealed", "expires_at"]);
    // An access token only: nothing here could hold the session's refresh token.
    expect(table).not.toMatch(/refresh/i);
    expect(code).toContain("alter table public.deck_reart_background_tokens enable row level security;");
    // No policy at all for it (the one policy of the migration is the run row's).
    expect(code).not.toMatch(/create policy[^;]*deck_reart_background_tokens/);
    expect(code).toContain("revoke all on public.deck_reart_background_tokens from public, anon, authenticated;");
    expect(code).toContain("grant select, insert, update, delete on public.deck_reart_background_tokens to service_role;");
    expect(code).not.toMatch(/grant [^;]* on public\.deck_reart_background_tokens to (?!service_role)/);
  });

  it("the job is the row owner's own Re-art run and the deck theirs — asked by a trigger, whoever writes", () => {
    const fn = code.slice(code.indexOf("create or replace function public.deck_reart_background_check_owner()"), code.indexOf("drop trigger if exists deck_reart_background_check_owner"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/j\.id = new\.job_id and j\.owner_id = new\.owner_id and j\.kind = 'deck_reart'/);
    expect(fn).toMatch(/d\.id = new\.deck_id and d\.owner_id = new\.owner_id/);
    expect(fn).toMatch(/raise exception 'deck_reart_background_not_owner'/);
    // The chain's own writes (hop, beat, state) don't pay for the check.
    expect(code).toMatch(/create trigger deck_reart_background_check_owner\s+before insert or update of job_id, owner_id, deck_id on public\.deck_reart_background/);
    expect(code).toContain("revoke all on function public.deck_reart_background_check_owner() from public, anon, authenticated;");
  });

  it("is written by the server only; the owner reads their own while the tool is open to them", () => {
    expect(code).toContain("alter table public.deck_reart_background enable row level security;");
    const policies = code.match(/create policy [\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on public\.deck_reart_background for select\s+to authenticated/);
    expect(policies[0]).toMatch(/owner_id = \(select auth\.uid\(\)\) and public\.has_tool_access\('re-art-deck'\)/);
    expect(code).toContain("revoke all on public.deck_reart_background from public, anon, authenticated;");
    expect(code).toContain("grant select on public.deck_reart_background to authenticated;");
    expect(code).toContain("grant select, insert, update, delete on public.deck_reart_background to service_role;");
    expect(code).not.toMatch(/to anon/);
    // The maker's own role never writes the lease (a Stop goes through the server).
    for (const grant of code.match(/grant [^;]+ on public\.deck_reart_background to authenticated;/g) ?? []) expect(grant).not.toMatch(/\b(insert|update|delete|truncate|all)\b/i);
  });

  it("can be applied twice", () => {
    expect(code.match(/create table (?!if not exists)/g)).toBeNull();
    for (const index of code.match(/create index[^;]+;/g) ?? []) expect(index).toMatch(/create index if not exists/);
    expect(code).toMatch(/drop policy if exists "Deck re-art background: owner reads"/);
    expect(code).toMatch(/drop trigger if exists deck_reart_background_check_owner/);
    expect(code).toMatch(/create or replace function/);
    expect(code).toMatch(/drop constraint if exists notifications_type_check/);
  });

  it("the bell's kinds: every kind allowed before, in the same order, plus reart_run", () => {
    const before = files
      .filter((f) => f < file)
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((text) => text.includes("add constraint notifications_type_check"))
      .at(-1)!;
    expect(kinds(sql)).toEqual([...kinds(before), "reart_run"]);
    expect(kinds(sql)).toEqual(expect.arrayContaining(["exact_copy_unlisted", "tool_access", "banked_days", "referral_reward"]));
  });

  it("no later migration redefines the kinds without it", () => {
    for (const f of files.filter((name) => name > file)) {
      const text = readFileSync(join(dir, f), "utf8");
      if (text.includes("add constraint notifications_type_check")) expect(kinds(text), f).toContain("reart_run");
    }
  });

  it("the new kind has words of its own, not the generic fallback's", () => {
    const own = describeNotification({ type: "reart_run", payload: { state: "finished", painted: 2 }, actor: null } as never, { isAdmin: false });
    const fallback = describeNotification({ type: "no_such_kind", payload: {}, actor: null } as never, { isAdmin: false });
    expect(own.body).not.toBe(fallback.body);
    expect(own.subject).toBe("Re-art deck");
  });

  it("the generated types know the table", () => {
    const at = types.indexOf("deck_reart_background: {");
    expect(at).toBeGreaterThan(-1);
    const block = types.slice(at, types.indexOf("deck_reart_background_tokens: {", at));
    for (const column of ["job_id", "owner_id", "deck_id", "state", "reason", "driver", "driven_until", "beat_at", "door_errors", "limited_keys", "started_at", "finished_at"]) expect(block, column).toContain(`${column}:`);
    const tokens = types.slice(types.indexOf("deck_reart_background_tokens: {"), types.indexOf("deck_reart_locks: {"));
    for (const column of ["job_id", "sealed", "expires_at"]) expect(tokens, column).toContain(`${column}:`);
  });
});
