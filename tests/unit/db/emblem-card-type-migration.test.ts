import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_TYPE_VALUES } from "@/types/card";
import { createCardSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 6.23 — the emblem card type. The DB CHECK (cards_card_type_valid,
// migration *_emblem_card_type.sql — found by name so a renumber at rebase
// doesn't break this) and the app's list (CARD_TYPE_VALUES, which the zod
// enum reads) must name the same values, 'emblem' among them.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_emblem_card_type\.sql$/.test(f));

describe("the emblem card type migration", () => {
  it("has its migration", () => {
    expect(file).toBeDefined();
  });

  const sql = file ? readFileSync(join(dir, file), "utf8") : "";
  const body = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  it("the CHECK names exactly CARD_TYPE_VALUES, emblem included", () => {
    const list = /card_type\s+in\s*\(([^)]*)\)/i.exec(body)?.[1] ?? "";
    const values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toContain("emblem");
    expect([...values].sort()).toEqual([...CARD_TYPE_VALUES].sort());
  });

  it("replaces the constraint idempotently and touches nothing else", () => {
    expect(body).toMatch(/drop constraint if exists cards_card_type_valid/i);
    expect(body).toMatch(/add constraint cards_card_type_valid/i);
    expect(body.match(/^\s*(grant|revoke|create|update|insert|delete)\b/gim)).toBeNull();
    expect(sql).toMatch(/Grants: none/);
  });

  it("the shared schema accepts an emblem", () => {
    const parsed = createCardSchema.safeParse({
      title: "Kaito, Cunning Infiltrator",
      game_system_id: "33333333-3333-4333-8333-333333333333",
      card_type: "emblem",
      color_identity: ["colorless"],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("the dev seed gives previews an emblem: its own card type on the emblem frame, colourless, common, no cost or stats", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/10_dev_data.sql"), "utf8");
    const row = seed.split("\n").findIndex((line) => /'emblem', array\[\]::text\[\], 'common'/.test(line));
    expect(row, "an emblem row").toBeGreaterThan(-1);
    const [head, body] = seed.split("\n").slice(row, row + 2);
    // title, slug, cost (null), colours, supertype (null), card_type…
    expect(head).toMatch(/'Veyra, Stormbound', '[a-z-]+', null, array\['colorless'\], null, 'emblem'/);
    // …rules, flavour, power, toughness, loyalty (all null), art, template.
    expect(body).toMatch(/, null, null, null, null, \d+, 'emblem', 'regular', 'public'/);
  });
});
