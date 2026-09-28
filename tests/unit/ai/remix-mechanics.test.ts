import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { REMIX_FRAME_UNAVAILABLE, remixFrameFor } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import { backFaceSchema } from "@/lib/validation/card";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.22 — the AI deck remix resolves its frame like the creator import.
// executeDeckRemixStep (lib/ai/generation-jobs.ts) maps a deck entry's
// printing and hands scryfallRemixMechanics' result to createCardAction; it
// used to pass the printing's frame_template straight through, so an
// old-border printing failed the save's frame gate (Juggernaut LEA →
// agclassic/c, Seat of the Synod MRD → modernland/u, Command Tower C13 →
// modernland/m) and a layout kind saved on the default M15 frame.
//
// Real (trimmed) Scryfall payloads; production's verified frames come from
// supabase/seed.sql, which mirrors them.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;
const patchOf = (key: PrintingKey) =>
  mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));

function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/
    .exec(sql)?.[1]
    .replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const keys = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of ["w", "u", "b", "r", "g", "c", "m"]) {
      keys.add(frameComboKey(template as FrameTemplate, colour));
    }
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  return keys;
}
const PROD = productionVerifiedKeys();
const plus = (...combos: [string, string][]) =>
  new Set([...PROD, ...combos.map(([t, k]) => frameComboKey(t as FrameTemplate, k))]);

/** The remix's landing + a check that the save's two gates let it through. */
function remixOf(key: PrintingKey, verified: ReadonlySet<string> = PROD) {
  const result = scryfallRemixMechanics(patchOf(key), "Entry", verified);
  if (!result.ok) throw new Error(`${key}: ${result.error}`);
  const m = result.mechanics;
  expect(frameGateError(m.frame_template, m.color_identity, verified), key).toBeNull();
  expect(
    frameKindGateError(
      m.frame_template,
      cardFieldsFace({
        card_type: m.card_type,
        supertype: m.supertype,
        subtypes: m.subtypes,
        title: m.title,
        rules_text: m.rules_text,
      }),
    ),
    key,
  ).toBeNull();
  if (m.back_face) expect(backFaceSchema.safeParse(m.back_face).success, key).toBe(true);
  return {
    template: m.frame_template,
    colorKey: pickFrameColorKey(m.color_identity),
    cardType: m.card_type,
    mechanics: m,
  };
}

describe("remixFrameFor — the old-border printings that failed the step", () => {
  it("falls forward to M15 where production hasn't verified the printing's frame", () => {
    // agclassic and modernland (in blue / gold) are unverified on production.
    expect(remixOf("lea-255")).toMatchObject({ template: "m15artifact", colorKey: "c", cardType: "creature" });
    expect(remixOf("mrd-283")).toMatchObject({ template: "m15land", colorKey: "u", cardType: "land" });
    expect(remixOf("c13-281")).toMatchObject({ template: "m15land", colorKey: "m", cardType: "land" });
  });

  it("keeps the printing's own frame once it is verified in the card's colour", () => {
    const verified = plus(["agclassic", "c"], ["modernland", "u"], ["modernland", "m"]);
    expect(remixOf("lea-255", verified)).toMatchObject({ template: "agclassic", colorKey: "c" });
    expect(remixOf("mrd-283", verified)).toMatchObject({ template: "modernland", colorKey: "u" });
    expect(remixOf("c13-281", verified)).toMatchObject({ template: "modernland", colorKey: "m" });
  });

  it("keeps the Artifact word, so Juggernaut is an Artifact Creature on either frame", () => {
    expect(remixOf("lea-255").mechanics.supertype).toBe("Artifact");
  });
});

describe("remixFrameFor — layout kinds land on their layout template", () => {
  it("an adventure lands on the adventure frame with its storybook page", () => {
    const { template, cardType, mechanics } = remixOf("eld-115", plus(["adventure", "r"]));
    expect(template).toBe("adventure");
    expect(cardType).toBe("creature");
    // The adventure spell rides as the second face the frame paints.
    expect(mechanics.back_face).toMatchObject({
      title: "Stomp",
      card_type: "instant",
      subtypes: ["Adventure"],
    });
    // Its text, never the printing's artist: the remix's art is new.
    expect(mechanics.back_face?.artist_credit).toBeUndefined();
  });

  it("keeps the printed card type the layout template can draw (TODO 1.21)", () => {
    expect(remixOf("woe-38", plus(["adventure", "w"]))).toMatchObject({ template: "adventure", cardType: "enchantment" });
    expect(remixOf("akh-211", plus(["aftermath", "u"]))).toMatchObject({ template: "aftermath", cardType: "instant" });
    expect(remixOf("dgm-123", plus(["split", "m"]))).toMatchObject({ template: "split", cardType: "sorcery" });
  });

  it("a saga lands on the saga frame (verified on production), which paints no second face", () => {
    const fable = remixOf("neo-141");
    expect(fable).toMatchObject({ template: "saga", cardType: "enchantment" });
    expect(fable.mechanics.back_face).toBeUndefined();
  });

  it("prints on the card type's standard frame while the layout frame is unpublished (production today)", () => {
    // adventure / split / aftermath aren't verified on production: the
    // remix saves where it always did (M15), now with the printed type.
    expect(remixOf("eld-115")).toMatchObject({ template: "m15", cardType: "creature" });
    expect(remixOf("woe-38")).toMatchObject({ template: "m15", cardType: "enchantment" });
    expect(remixOf("akh-211")).toMatchObject({ template: "m15", cardType: "instant" });
    // …and never becomes a double-faced card on it.
    expect(remixOf("eld-115").mechanics.back_face).toBeUndefined();
  });
});

describe("remixFrameFor — nothing published in the card's colour", () => {
  it("fails the step with a plain reason instead of the save's frame gate", () => {
    expect(remixFrameFor(patchOf("dom-168"), new Set())).toEqual({
      ok: false,
      error: REMIX_FRAME_UNAVAILABLE,
    });
    expect(scryfallRemixMechanics(patchOf("dom-168"), "Llanowar Elves", new Set())).toEqual({
      ok: false,
      error: REMIX_FRAME_UNAVAILABLE,
    });
  });

  it("never recolours the card to reach a published frame", () => {
    // Llanowar Elves is green; only white frames are published.
    const whiteOnly = new Set(["m15", "m15artifact"].map((t) => frameComboKey(t as FrameTemplate, "w")));
    expect(remixFrameFor(patchOf("dom-168"), whiteOnly)).toEqual({ ok: false, error: REMIX_FRAME_UNAVAILABLE });
  });

  it("never invents a card type for a printing with none PipGlyph models", () => {
    // A Conspiracy / Scheme-style type line: no kind, no card type.
    const card = scryfallCardSchema.parse({
      id: "x",
      name: "Backup Plan",
      layout: "normal",
      frame: "2015",
      type_line: "Conspiracy",
      colors: [],
    });
    const patch = mapScryfallToFormPatch(card);
    expect(patch.kind).toBeUndefined();
    expect(patch.card_type).toBeUndefined();
    expect(remixFrameFor(patch, PROD)).toEqual({ ok: true, template: "m15", card_type: undefined });
  });

  it("reads a colourless card with no colour field as colourless", () => {
    const patch = { ...patchOf("lea-255"), color_identity: undefined };
    expect(remixFrameFor(patch, PROD)).toMatchObject({ ok: true, template: "m15artifact" });
  });
});
