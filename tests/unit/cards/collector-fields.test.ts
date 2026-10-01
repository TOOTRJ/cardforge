import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BAKE_SELECT_COLUMNS, rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9a — the collector fields travel, but nothing draws them. Both
// preview mappers hand `CardPreviewData.setCode / collectorNumber / lang`
// the same values from one stored row, and every select that feeds a server
// render reads the three columns (BAKE_SELECT_COLUMNS, or `*`).
// ---------------------------------------------------------------------------

const ROW: CardRowForBake & Pick<Card, "set_code" | "collector_number" | "lang"> = {
  id: "00000000-0000-4000-8000-000000000107",
  owner_id: "00000000-0000-4000-8000-000000000001",
  title: "Sheoldred, the Apocalypse",
  cost: "{2}{B}{B}",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["Phyrexian", "Praetor"],
  rarity: "mythic",
  color_identity: ["black"],
  rules_text: "Deathtouch",
  flavor_text: null,
  power: "4",
  toughness: "5",
  loyalty: null,
  defense: null,
  artist_credit: "Chris Rahn",
  art_url: null,
  art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
  frame_style: { template: "m15", finish: "regular" },
  set_icon_url: null,
  set_icon_code: "dmu",
  back_face: null,
  face_content: null,
  watermark: null,
  set_code: "DMU",
  collector_number: "107/281",
  lang: "es",
};

/** The same stored row as the `Card` the page queries narrow to. */
const CARD = {
  ...ROW,
  slug: "sheoldred-the-apocalypse",
  game_system_id: "gs",
  tags: ["proxy"],
  visibility: "public",
  back_card_id: null,
  parent_card_id: null,
  source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
  footer_text: null,
  layout: "normal",
  layout_version: null,
  rendered_at: null,
  rendered_image_url: null,
  rendered_thumb_url: null,
  metadata: {},
  oracle_text: null,
  mana_value: 4,
  template_id: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
  likes_count: 0,
  view_count: 0,
  share_count: 0,
  search_vector: null,
  color_count: 1,
  frame_preview: false,
} as unknown as Card;

describe("the two preview mappers agree on the collector fields", () => {
  it("rowToPreviewData and cardToPreviewData hand over the same setCode / collectorNumber / lang", () => {
    const fromRow = rowToPreviewData(ROW);
    const fromCard = cardToPreviewData(CARD);
    const pick = (d: typeof fromRow) => ({ setCode: d.setCode, collectorNumber: d.collectorNumber, lang: d.lang });
    expect(pick(fromRow)).toEqual({ setCode: "DMU", collectorNumber: "107/281", lang: "es" });
    expect(pick(fromCard)).toEqual(pick(fromRow));
  });

  it("a bake row read without the columns carries null (never undefined), and `Card` requires them", () => {
    const { set_code: _s, collector_number: _c, lang: _l, ...older } = ROW;
    void _s;
    void _c;
    void _l;
    const data = rowToPreviewData(older);
    expect(data.setCode).toBeNull();
    expect(data.collectorNumber).toBeNull();
    expect(data.lang).toBeNull();
    // The `Card` row type names the three (types/supabase.ts): a caller
    // whose select lacks them fails typecheck, which is the point.
    const card: Pick<Card, "set_code" | "collector_number" | "lang"> = CARD;
    expect(card.lang).toBe("es");
  });
});

describe("every server render's select reads the collector columns", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("BAKE_SELECT_COLUMNS names them (the save bake, the sweep, the stepper's frame previews)", () => {
    for (const column of ["set_code", "collector_number", "lang"]) {
      expect(BAKE_SELECT_COLUMNS.split(/,\s*/)).toContain(column);
    }
    for (const consumer of ["lib/cards/bake-render.ts", "lib/cards/rebake-batch.ts", "lib/cards/frame-preview-cards.ts"]) {
      expect(read(consumer), consumer).toMatch(/BAKE_SELECT_COLUMNS/);
    }
  });

  it("the OG, PNG and PDF routes select the whole row", () => {
    for (const route of ["app/api/cards/[id]/og/route.ts", "app/api/cards/[id]/png/route.ts", "app/api/cards/[id]/pdf/route.ts"]) {
      const source = read(route);
      expect(source, route).toMatch(/\.from\("cards"\)\s*\.select\("\*"\)/);
      expect(source, route).toMatch(/rowToPreviewData\(/);
    }
  });

  it("the deck export reads its cards through listDeckCards, which selects the whole row", () => {
    const route = read("app/api/decks/[id]/download/route.ts");
    expect(route).not.toMatch(/\.from\("cards"\)/);
    const queries = read("lib/decks/queries.ts");
    const fn = /export async function listDeckCards[\s\S]*?\n}\n/.exec(queries)?.[0] ?? "";
    expect(fn).toMatch(/\.from\("cards"\)\s*\.select\("\*"\)/);
  });
});
