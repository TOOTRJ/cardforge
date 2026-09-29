import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { CARD_TITLE_MAX, cardTitleSchema, createCardSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 1.12 — card titles up to 150 characters. The DB CHECK
// (cards_title_length, migration *_card_title_150.sql — found by name so a
// renumber at rebase doesn't break this) and the shared zod schema must say
// the same number, and the longest printed name must import and validate:
// Unhinged #107 (captured 2026-09-28), 141 characters.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_card_title_150\.sql$/.test(f));

describe("the card title limit", () => {
  it("has its migration", () => {
    expect(file).toBeDefined();
  });

  const sql = file ? readFileSync(join(dir, file), "utf8") : "";
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("the CHECK and CARD_TITLE_MAX agree", () => {
    const check = /char_length\(title\)\s+between\s+1\s+and\s+(\d+)/i.exec(body);
    expect(Number(check?.[1])).toBe(CARD_TITLE_MAX);
    expect(CARD_TITLE_MAX).toBe(150);
  });

  it("replaces the constraint idempotently and touches nothing else", () => {
    expect(body).toMatch(/drop constraint if exists cards_title_length/i);
    expect(body).toMatch(/add constraint cards_title_length/i);
    // Only the two ALTERs: no grant change, no table, no data.
    expect(body.match(/^\s*(grant|revoke|create|update|insert|delete)\b/gim)).toBeNull();
    expect(sql).toMatch(/Grants: none/);
  });

  it("the longest printed name (UNH #107, 141 characters) imports and validates", () => {
    const card = scryfallCardSchema.parse(printings["unh-107"]);
    const patch = mapScryfallToFormPatch(card);
    expect(patch.title).toHaveLength(141);
    expect(cardTitleSchema.safeParse(patch.title).success).toBe(true);
    const parsed = createCardSchema.safeParse({
      title: patch.title,
      game_system_id: "33333333-3333-4333-8333-333333333333",
      card_type: patch.card_type,
      color_identity: patch.color_identity,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
