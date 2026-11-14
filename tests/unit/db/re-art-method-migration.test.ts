import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REART_METHODS } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck — how a card's picture was made (migration 0212):
// deck_reart_cards gains `method`, 'paint' (from the prompt alone) or
// 'restyle' (the card's own art, repainted). One nullable text column with a
// check: every stored row stays as it is (NULL = painted before, i.e. from
// the prompt), no card is touched, and the table's grants (table-level,
// 0191) cover it. The database's words are the model's. Found by NAME,
// never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_method\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("0212 re-art deck: how a card's picture was made", () => {
  it("exists after the migration that records who painted it", () => {
    expect(file).not.toBe("");
    const model = files.find((f) => /^\d{4}_re_art_painting_model\.sql$/.test(f)) ?? "";
    expect(model).not.toBe("");
    expect(file > model).toBe(true);
  });

  it("adds one nullable column: every stored row stays as it is", () => {
    expect(code).toMatch(/alter table public\.deck_reart_cards\s+add column if not exists method text;/);
    expect(code).not.toMatch(/method text not null/);
    expect(code).not.toMatch(/\bdefault\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/public\.cards\b/);
    expect(code).not.toMatch(/\b(drop table|drop column|truncate|delete from)\b/i);
  });

  it("takes the model's two words and nothing else", () => {
    const words = REART_METHODS.map((method) => `'${method}'`).join(", ");
    expect(code).toContain(`check (method is null or method in (${words}));`);
  });

  it("is idempotent: the constraint is dropped before it is made", () => {
    const name = "deck_reart_cards_method_check";
    expect(code.indexOf(`drop constraint if exists ${name}`)).toBeGreaterThan(0);
    expect(code.indexOf(`drop constraint if exists ${name}`)).toBeLessThan(code.indexOf(`add constraint ${name}`));
  });

  it("changes no grant, policy, function, trigger or key — the table's own (0191) cover the column", () => {
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(policy|function|trigger)\b/i);
    expect(code).not.toMatch(/row level security/i);
    expect(code).not.toMatch(/primary\s+key/i);
  });

  it("the generated types know the column on the row, an insert and an update", () => {
    const table = types.slice(types.indexOf("deck_reart_cards: {"));
    const block = table.slice(0, table.indexOf("Relationships:"));
    expect(block.match(/\bmethod: string \| null/g)).toHaveLength(1);
    expect(block.match(/\bmethod\?: string \| null/g)).toHaveLength(2);
  });
});
