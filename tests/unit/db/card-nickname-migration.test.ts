import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_NICKNAME_MAX, cardNicknameSchema, createCardSchema, updateCardSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 6.3 — migration *_card_nickname.sql (found by name, so a renumber at
// rebase doesn't break this): the column, its CHECK mirrored by the shared
// zod schema, the search trigger and the gallery search that read it, and
// nothing else.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_card_nickname\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

/** list_gallery_cards()'s definition in a migration. */
function galleryFn(text: string): string {
  const from = text.indexOf("create or replace function public.list_gallery_cards(");
  return text.slice(from, text.indexOf("$$;", from));
}

describe("the nickname migration", () => {
  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("adds one nullable text column, idempotently, and backfills nothing", () => {
    expect(body).toMatch(/add column if not exists nickname text;/);
    expect(body).not.toMatch(/\bupdate public\.cards\b/i);
    expect(body).not.toMatch(/add column[^;]*not null/i);
  });

  it("its CHECK and the zod schema say the same: 1–150, never blank", () => {
    const check = /char_length\(nickname\) between 1 and (\d+) and btrim\(nickname\) <> ''/.exec(body);
    expect(Number(check?.[1])).toBe(CARD_NICKNAME_MAX);
    expect(cardNicknameSchema.safeParse("x".repeat(CARD_NICKNAME_MAX)).success).toBe(true);
    expect(cardNicknameSchema.safeParse("x".repeat(CARD_NICKNAME_MAX + 1)).success).toBe(false);
    // A blank never reaches the column: the schema trims it to "" and the
    // actions store NULL (BLANK_IS_NULL_TEXTS).
    expect(createCardSchema.parse({ title: "Kesh", game_system_id: "33333333-3333-4333-8333-333333333333", nickname: "  " }).nickname).toBe("");
    expect(updateCardSchema.parse({ nickname: null }).nickname).toBeNull();
  });

  it("indexes the nickname beside the title (weight A) and refreshes on it", () => {
    expect(body).toMatch(/setweight\(to_tsvector\('english', coalesce\(new\.title, ''\) \|\| ' ' \|\| coalesce\(new\.nickname, ''\)\), 'A'\)/);
    expect(body).toMatch(/before insert or update of title, nickname, supertype, card_type, subtypes, tags, rules_text, flavor_text/);
  });

  it("is 0136's gallery search with the nickname compared beside the title, and nothing else changed", () => {
    const ours = galleryFn(sql);
    const before = galleryFn(readFileSync(join(dir, "0136_gallery_search_print_typography.sql"), "utf8"));
    const nicknameLines = ours.split("\n").filter((line) => line.includes("c.nickname"));
    expect(nicknameLines).toHaveLength(2);
    for (const line of nicknameLines) expect(line).toContain("translate(coalesce(c.nickname, ''), '’‘“”—–', '''''\"\"--') ilike p.like_q escape '\\'");
    const comparison = " or translate(coalesce(c.nickname, ''), '’‘“”—–', '''''\"\"--') ilike p.like_q escape '\\'";
    const flat = ours.replace(/\s+/g, " ");
    expect(flat.split(comparison)).toHaveLength(3);
    expect(flat.split(comparison).join("")).toBe(before.replace(/\s+/g, " "));
  });

  it("restates the gallery function's grants (new projects do not auto-grant)", () => {
    expect(body).toMatch(/revoke all on function public\.list_gallery_cards\([^)]*\) from public;/);
    expect(body).toMatch(/grant execute on function public\.list_gallery_cards\([^)]*\) to anon, authenticated, service_role;/);
  });
});
