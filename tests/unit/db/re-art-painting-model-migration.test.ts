import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REART_MODEL_IDS } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck — who painted a card (migration 0211): deck_reart_cards gains
// `image_model`, the gateway model that painted the picture(s) Re-art put on
// the card last. One nullable text column with a length check: every stored
// row stays as it is (NULL = painted before, or not known), no card is
// touched, and the table's grants (table-level, 0191) cover it. Found by
// NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_painting_model\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("0211 re-art deck: who painted a card", () => {
  it("exists after the tool's own migration and its own prompts'", () => {
    expect(file).not.toBe("");
    const tool = files.find((f) => /^\d{4}_re_art_deck\.sql$/.test(f)) ?? "";
    const prompts = files.find((f) => /^\d{4}_re_art_custom_prompts\.sql$/.test(f)) ?? "";
    expect(file > tool).toBe(true);
    expect(file > prompts).toBe(true);
  });

  it("adds one nullable column: every stored row stays as it is", () => {
    expect(code).toMatch(/alter table public\.deck_reart_cards\s+add column if not exists image_model text;/);
    expect(code).not.toMatch(/image_model text not null/);
    expect(code).not.toMatch(/\bdefault\b/i);
    // Nothing stored is rewritten, and no card is touched.
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/public\.cards\b/);
    expect(code).not.toMatch(/\b(drop table|drop column|truncate|delete from)\b/i);
  });

  it("holds the text to 1–200 characters — room for two of the tool's models joined by “ + ”", () => {
    expect(code).toContain("check (image_model is null or char_length(image_model) between 1 and 200);");
    const longest = Math.max(...REART_MODEL_IDS.map((id) => id.length));
    expect(longest * 2 + " + ".length).toBeLessThanOrEqual(200);
  });

  it("is idempotent: the constraint is dropped before it is made", () => {
    const name = "deck_reart_cards_image_model_check";
    expect(code.indexOf(`drop constraint if exists ${name}`)).toBeGreaterThan(0);
    expect(code.indexOf(`drop constraint if exists ${name}`)).toBeLessThan(code.indexOf(`add constraint ${name}`));
  });

  it("changes no grant, policy, function or trigger — the table's own (0191) cover the column", () => {
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(policy|function|trigger)\b/i);
    expect(code).not.toMatch(/row level security/i);
  });

  it("the generated types know the column on the row, an insert and an update", () => {
    const table = types.slice(types.indexOf("deck_reart_cards: {"));
    const block = table.slice(0, table.indexOf("Relationships:"));
    expect(block.match(/image_model: string \| null/g)).toHaveLength(1);
    expect(block.match(/image_model\?: string \| null/g)).toHaveLength(2);
  });
});
