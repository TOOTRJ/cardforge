import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0205 — a custom symbol's NAME and CODE are written by the server alone
// (owner 2026-11-11). They are public words that may hold no strong language,
// and the only check is the app's; 0193 let the owner's own database role
// insert a row and update `name`, so the check could be skipped through the
// database API. The migration takes those two writes away from the API role
// (no second word list in SQL) and leaves the rest of the owner's writes as
// they were. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_custom_symbol_words_server_only\.sql$/.test(f)) ?? "";
const raw = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements alone: every `--` comment line dropped. */
const sql = raw
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
/** The closing self-check (one DO block), and everything before it. */
const proofAt = sql.indexOf("do $$");
const proof = proofAt >= 0 ? sql.slice(proofAt) : "";
/** One entry per statement before the proof. A statement ends at a `;` that
 *  ends its line — the table comment's own text holds semicolons mid-line. */
const statements = (proofAt >= 0 ? sql.slice(0, proofAt) : sql)
  .split(/;[ \t]*(?:\n|$)/)
  .map((statement) => statement.replace(/\s+/g, " ").trim())
  .filter(Boolean);

describe("0205 custom symbol words are the server's", () => {
  it("exists, after 0193 — and is not mistaken for 0193 by the test that finds that one by name", () => {
    expect(file).not.toBe("");
    const first = readdirSync(dir).find((f) => /^\d{4}_custom_symbols\.sql$/.test(f)) ?? "";
    expect(first).not.toBe("");
    expect(file > first).toBe(true);
    expect(/^\d{4}_custom_symbols\.sql$/.test(file)).toBe(false);
  });

  it("takes INSERT away from the owner's role — a new row names its code and name", () => {
    expect(statements).toContain("revoke insert on public.custom_symbols from authenticated");
    // …and never hands an insert back to an API role, whole or by column.
    for (const statement of statements.filter((s) => s.startsWith("grant "))) {
      if (/\bto (anon|authenticated)\b|\bto anon, authenticated\b/.test(statement)) {
        expect(statement, statement).not.toMatch(/\binsert\b/);
      }
    }
  });

  it("takes UPDATE of `name` away, and leaves the meaning, the picture and deleted_at", () => {
    expect(statements).toContain("revoke update (name) on public.custom_symbols from authenticated");
    expect(statements).toContain(
      "grant update (mana_value, base_color, image_url, deleted_at) on public.custom_symbols to authenticated",
    );
    // No API-role grant names `name` or `code` as a column to write.
    for (const statement of statements.filter((s) => /^grant (insert|update)/.test(s) && /authenticated|anon/.test(s))) {
      expect(statement, statement).not.toMatch(/\((?:[^)]*,\s*)?(name|code)(?:\s*,[^)]*)?\)/);
    }
  });

  it("drops the insert policy with the grant — a policy no role can use says a thing that is not true", () => {
    expect(statements).toContain('drop policy if exists "Custom symbols: owner adds" on public.custom_symbols');
    expect(sql).not.toMatch(/create policy/i);
  });

  it("restates the table's grants in full: everyone reads, the owner's role edits and deletes, the server does everything", () => {
    expect(statements).toContain("grant select on public.custom_symbols to anon, authenticated");
    expect(statements).toContain("grant delete on public.custom_symbols to authenticated");
    expect(statements).toContain("grant select, insert, update, delete on public.custom_symbols to service_role");
    expect(sql).not.toMatch(/grant all/i);
    expect(sql).not.toMatch(/to anon\b(?!, authenticated)/);
  });

  it("ends by PROVING it on the database it ran on: it raises if an API role can still write a code or a name", () => {
    expect(proof.trim().endsWith("$$;")).toBe(true);
    for (const check of [
      "has_any_column_privilege('authenticated', 'public.custom_symbols', 'INSERT')",
      "has_any_column_privilege('anon', 'public.custom_symbols', 'INSERT')",
      "has_column_privilege('authenticated', 'public.custom_symbols', 'name', 'UPDATE')",
      "has_column_privilege('authenticated', 'public.custom_symbols', 'code', 'UPDATE')",
      "has_any_column_privilege('anon', 'public.custom_symbols', 'UPDATE')",
    ]) {
      expect(proof, check).toContain(check);
    }
    expect(proof).toContain("raise exception '0205: an API role can still write a custom symbol''s code or name'");
    // One DO block and nothing after it: the runner sends it as one statement.
    expect(sql.match(/\bdo \$\$/g)).toHaveLength(1);
    // It only asks; no line of it changes anything.
    expect(proof).not.toMatch(/^\s*(grant|revoke|drop|alter|create|insert|update|delete)\b/im);
  });

  it("teaches the database no word list and adds no function, trigger or definer", () => {
    expect(sql).not.toMatch(/create (or replace )?function|create trigger|security definer/i);
    expect(raw).toContain("a second detector to keep in step with the");
  });

  it("is a list of plain statements the branch runner can send one at a time — no transaction control, no lock", () => {
    for (const statement of statements) {
      expect(statement, statement).toMatch(/^(revoke|grant|drop policy if exists|comment on table) /);
    }
    // No transaction control and no lock among them (the proof's own
    // `begin … end` is the DO block's body, one statement).
    expect(statements.join("\n")).not.toMatch(/\b(begin|commit|rollback|lock table)\b/i);
  });

  it("says in the table's own comment who writes what now", () => {
    const comment = statements.find((s) => s.startsWith("comment on table public.custom_symbols")) ?? "";
    expect(comment).toContain("The SERVER alone inserts a row and writes its name (0205");
  });

  it("no app code inserts a symbol, or writes its name, as the caller's own role", () => {
    const actions = readFileSync(join(process.cwd(), "lib/symbols/actions.ts"), "utf8");
    expect(actions).toMatch(/await wordsClient\(\)\s*\.from\("custom_symbols"\)\s*\.insert\(/);
    expect(actions).not.toMatch(/supabase\s*\.from\("custom_symbols"\)\s*\.insert\(/);
    expect(actions).not.toMatch(/supabase\s*\.from\("custom_symbols"\)\s*\.update\(\{[^}]*\bname\b/);
    // The one other writer of rows is the remix copy, which is the service role already.
    const remix = readFileSync(join(process.cwd(), "lib/symbols/remix-copy.ts"), "utf8");
    expect(remix).toMatch(/admin\.from\("custom_symbols"\)\.insert\(/);
  });
});
