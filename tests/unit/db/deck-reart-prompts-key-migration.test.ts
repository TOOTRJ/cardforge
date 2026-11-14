import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0210 — `deck_reart_prompts` is keyed on its ENTRY alone.
//
// 0209 keyed it on (deck_id, entry_id): foreign keys to decks and to
// deck_cards that together were the PRIMARY KEY. The database API reads a
// table shaped like that as a many-to-many link between the two tables it
// points at — and decks and deck_cards already had their own link, so every
// embedded read between them that named no foreign key was refused as
// ambiguous (PGRST201) on production: deck tiles lost their art, Bulk
// Customize and Re-art deck read no entry (2026-11-13).
//
// The fix keeps every row and every caller working at every moment: the
// pair stays UNIQUE (the app's upsert and the seed name it), added BEFORE
// the key is swapped, and the swap is one statement.
//
// And the CLASS is held: a later migration that declares a composite
// primary key says `-- api-junction: checked` — its author looked for a
// direct foreign key between the two tables it points at. Found by NAME,
// never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_deck_reart_prompts_entry_key\.sql$/.test(f)) ?? "";
const read = (name: string) => readFileSync(join(dir, name), "utf8");
/** The statements, without the comments (a word in a comment proves nothing). */
const codeOf = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const sql = file ? read(file) : "";
const code = codeOf(sql);

/** A table-level primary key over two or more columns — or one handed an
 *  existing index (which may hold any number of columns). */
const COMPOSITE_KEY = /primary\s+key\s*(\(\s*[a-z0-9_"]+\s*,|using\s+index)/i;
const CHECKED = /^\s*--\s*api-junction:\s*checked\b/m;

describe("0210 deck_reart_prompts — keyed on the entry alone", () => {
  it("exists right after the migration that made the table", () => {
    expect(file).not.toBe("");
    const made = files.find((f) => /^\d{4}_re_art_custom_prompts\.sql$/.test(f)) ?? "";
    expect(made).not.toBe("");
    expect(file > made).toBe(true);
    // The table it fixes was keyed on both foreign keys.
    expect(codeOf(read(made))).toMatch(/primary key \(deck_id, entry_id\)/);
  });

  it("swaps the primary key to (entry_id) in ONE statement — never a moment with no key", () => {
    expect(code).toMatch(
      /alter table public\.deck_reart_prompts\s+drop constraint if exists deck_reart_prompts_pkey,\s+add constraint deck_reart_prompts_pkey primary key \(entry_id\);/,
    );
    // No composite key is left, or made, by it.
    expect(code).not.toMatch(COMPOSITE_KEY);
  });

  it("keeps (deck_id, entry_id) unique, from BEFORE the swap: the app's upsert and the seed name the pair", () => {
    const unique = code.indexOf("add constraint deck_reart_prompts_deck_entry_key unique (deck_id, entry_id);");
    const swap = code.indexOf("drop constraint if exists deck_reart_prompts_pkey");
    expect(unique).toBeGreaterThan(0);
    expect(unique).toBeLessThan(swap);
    // Made only when missing (a second run changes nothing), never dropped.
    expect(code).toMatch(/if not exists \(\s*select 1\s+from pg_constraint[\s\S]*conname = 'deck_reart_prompts_deck_entry_key'/);
    expect(code).not.toMatch(/drop constraint if exists deck_reart_prompts_deck_entry_key/);

    const server = readFileSync(join(process.cwd(), "lib/tools/re-art/server.ts"), "utf8");
    expect(server).toContain('{ onConflict: "deck_id,entry_id" }');
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/55_re_art_prompts.sql"), "utf8");
    expect(seed).toContain("on conflict (deck_id, entry_id)");
  });

  it("changes no row, grant, policy, function or trigger", () => {
    expect(code).not.toMatch(/\b(insert into|update\s+public\.|delete from|truncate)\b/i);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(policy|function|trigger)\b/i);
    expect(code).not.toMatch(/row level security/i);
    expect(code).not.toMatch(/\bdrop\s+(table|column)\b/i);
    // The one index it drops is the one the new key replaces.
    expect(code.match(/drop index[^;]*;/gi)).toEqual(["drop index if exists public.deck_reart_prompts_entry_idx;"]);
  });

  it("tells the API to read the schema again", () => {
    expect(code).toMatch(/notify pgrst, 'reload schema';/);
  });
});

describe("a composite primary key is a many-to-many link to the API", () => {
  const later = files.filter((f) => file !== "" && f >= file);

  it("every migration from 0210 on that declares one says its author checked", () => {
    const unchecked = later.filter((name) => {
      const text = read(name);
      return COMPOSITE_KEY.test(codeOf(text)) && !CHECKED.test(text);
    });
    expect(
      unchecked,
      "A table whose PRIMARY KEY holds foreign keys to two tables is read by the API as a link between them. " +
        "If those tables already have a foreign key between them, every embedded read that names none is refused (PGRST201). " +
        "Key the table on one column (keep the pair UNIQUE), or check there is no other link, and add `-- api-junction: checked — <why>`.",
    ).toEqual([]);
  });

  it("the check reads a key as the database would", () => {
    expect(COMPOSITE_KEY.test("primary key (deck_id, entry_id)")).toBe(true);
    expect(COMPOSITE_KEY.test("  PRIMARY KEY ( user_id ,card_id )")).toBe(true);
    expect(COMPOSITE_KEY.test("primary key (deck2_id, entry_id)")).toBe(true);
    expect(COMPOSITE_KEY.test("add constraint x_pkey primary key using index x_pair_idx")).toBe(true);
    expect(COMPOSITE_KEY.test("id uuid primary key default gen_random_uuid()")).toBe(false);
    expect(COMPOSITE_KEY.test("primary key (entry_id)")).toBe(false);
    expect(CHECKED.test("-- api-junction: checked — no other link between the two")).toBe(true);
    expect(CHECKED.test("select 1; -- api-junction: checked")).toBe(false);
  });
});
