import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import tokenPrintings from "../scryfall/fixtures/token-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { REMIX_FRAME_UNAVAILABLE, finalizeImportMatch, remixFrameFor, resolveImportFrame } from "@/lib/creator/frame-resolve";
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
const without = (...templates: string[]) =>
  new Set([...PROD].filter((key) => !templates.some((t) => key.startsWith(`${t}/`))));

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
  it("falls forward to M15 where the printing's frame isn't verified", () => {
    // Built explicitly: production verified modernland in every colour on
    // 2026-09-29 (supabase/seed.sql mirrors it); agclassic still isn't.
    const unverified = without("agclassic", "modernland");
    expect(remixOf("lea-255", unverified)).toMatchObject({ template: "m15artifact", colorKey: "c", cardType: "creature" });
    expect(remixOf("mrd-283", unverified)).toMatchObject({ template: "m15land", colorKey: "u", cardType: "land" });
    expect(remixOf("c13-281", unverified)).toMatchObject({ template: "m15land", colorKey: "m", cardType: "land" });
    // What production does today: Juggernaut still falls forward; the
    // Mirrodin / C13 lands keep their own frame.
    expect(remixOf("lea-255")).toMatchObject({ template: "m15artifact", colorKey: "c", cardType: "creature" });
    expect(remixOf("mrd-283")).toMatchObject({ template: "modernland", colorKey: "u", cardType: "land" });
    expect(remixOf("c13-281")).toMatchObject({ template: "modernland", colorKey: "m", cardType: "land" });
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

  it("adventure and aftermath are verified on production (2026-10-06): the remix lands there with no help", () => {
    // supabase/seed.sql mirrors production, where both were ticked in every
    // colour on 2026-10-06 — so the printing keeps its layout, second face
    // included, against the production set alone.
    expect(remixOf("eld-115")).toMatchObject({ template: "adventure", colorKey: "r", cardType: "creature" });
    expect(remixOf("eld-115").mechanics.back_face).toMatchObject({ title: "Stomp", card_type: "instant" });
    expect(remixOf("woe-38")).toMatchObject({ template: "adventure", colorKey: "w", cardType: "enchantment" });
    expect(remixOf("akh-211")).toMatchObject({ template: "aftermath", colorKey: "u", cardType: "instant" });
    expect(remixOf("akh-211").mechanics.back_face).toMatchObject({ title: "Memory", card_type: "sorcery" });
  });

  it("prints on the card type's standard frame while the layout frame is unpublished (split, production today)", () => {
    // split isn't verified on production (TODO 4.21b rebuilds it first): the
    // remix saves where it always did (M15), with the printed type…
    expect(remixOf("dgm-123")).toMatchObject({ template: "m15", cardType: "sorcery" });
    // …and never becomes a double-faced card on it.
    expect(remixOf("dgm-123").mechanics.back_face).toBeUndefined();
    // The same rule for the two layouts production has since verified, with
    // their ticks taken away: back onto M15, one face.
    const unpublished = without("adventure", "aftermath");
    expect(remixOf("eld-115", unpublished)).toMatchObject({ template: "m15", cardType: "creature" });
    expect(remixOf("woe-38", unpublished)).toMatchObject({ template: "m15", cardType: "enchantment" });
    expect(remixOf("akh-211", unpublished)).toMatchObject({ template: "m15", cardType: "instant" });
    expect(remixOf("eld-115", unpublished).mechanics.back_face).toBeUndefined();
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

  it("never lands on a fallback frame published only in another colour", () => {
    // Juggernaut (colourless) wants agclassic; with nothing of its kind in
    // colourless, the resolver's last resort is a candidate (m15artifact,
    // m15) in ANOTHER colour, reported as "frame-switched" with that
    // colour's key. The save's frame gate would refuse it — after the art.
    const whiteOnly = new Set(["m15", "m15artifact"].map((t) => frameComboKey(t as FrameTemplate, "w")));
    expect(remixFrameFor(patchOf("lea-255"), whiteOnly)).toEqual({ ok: false, error: REMIX_FRAME_UNAVAILABLE });
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

// ---------------------------------------------------------------------------
// The remix follows the import's VERIFIED landing (2026-10-13). The mapper's
// landing is static; /api/scryfall/named finalizes it against the verified
// combos (finalizeImportMatch) before the creator resolves the frame. The
// remix read the static landing, so a remixed Vehicle kept the silver
// artifact frame after `m15vehicle` was ticked in all seven colours.
// supabase/seed.sql lags production's Vehicle ticks: they are added here.
// ---------------------------------------------------------------------------

const COLOUR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const VEHICLE_TICKS = COLOUR_KEYS.map((k): [string, string] => ["m15vehicle", k]);

/** The remix of a mapped patch, held to the save's two gates. */
function remixOfPatch(patch: ScryfallImportPatch, verified: ReadonlySet<string>) {
  const result = scryfallRemixMechanics(patch, "Entry", verified);
  if (!result.ok) throw new Error(result.error);
  const m = result.mechanics;
  expect(frameGateError(m.frame_template, m.color_identity, verified)).toBeNull();
  expect(
    frameKindGateError(
      m.frame_template,
      cardFieldsFace({ card_type: m.card_type, supertype: m.supertype, subtypes: m.subtypes, title: m.title, rules_text: m.rules_text }),
    ),
  ).toBeNull();
  return m;
}

/** Where the creator's import lands the same printing: the named route's
 *  finalization, then the form's resolveImportFrame. */
function importLanding(patch: ScryfallImportPatch, verified: ReadonlySet<string>) {
  const finalized = finalizeImportMatch(patch, verified);
  const { resolution } = resolveImportFrame({
    patch: finalized,
    kind: finalized.kind ?? null,
    current: { template: null, cardType: finalized.card_type ?? null, colors: finalized.color_identity ?? ["colorless"] },
    verifiedKeys: verified,
  });
  return resolution.status === "exact" || resolution.status === "frame-switched" ? resolution.template : null;
}

const vehicle = (over: Record<string, unknown> = {}) =>
  mapScryfallToFormPatch(
    scryfallCardSchema.parse({
      id: "00000000-0000-4000-8000-000000000235", name: "Smuggler's Copter", layout: "normal", set: "kld", set_type: "expansion", collector_number: "235",
      frame: "2015", frame_effects: [], border_color: "black", full_art: false, textless: false, keywords: ["Flying", "Crew"],
      type_line: "Artifact — Vehicle", colors: [], color_identity: [], mana_cost: "{2}", power: "3", toughness: "3", released_at: "2016-09-30",
      oracle_text: "Flying\nCrew 1", rarity: "rare",
      ...over,
    }),
  );

describe("remixFrameFor — the remix follows the import's verified landing", () => {
  const plain = vehicle();
  const blue = vehicle({ name: "Mindlink Mech", set: "neo", collector_number: "62", colors: ["U"], color_identity: ["U"], mana_cost: "{2}{U}" });
  const extended = vehicle({ name: "Mindlink Mech", set: "neo", collector_number: "448", frame_effects: ["extendedart"], colors: ["U"], color_identity: ["U"], mana_cost: "{2}{U}" });
  const borderless = vehicle({ name: "Boommobile", set: "dft", collector_number: "310", frame_effects: ["inverted"], border_color: "borderless", colors: ["R"], color_identity: ["R"], mana_cost: "{2}{R}{R}" });
  const VERIFIED = plus(...VEHICLE_TICKS);

  it("seed.sql has no Vehicle tick of its own yet (drop VEHICLE_TICKS' part of this suite's setup once it has)", () => {
    // The unverified side below is built with `without`, so it holds either way.
    expect(without("m15vehicle").has(frameComboKey("m15vehicle", "c"))).toBe(false);
  });

  it("a plain Vehicle lands on the Vehicle frame once it is verified in its colour, on the artifact frame until then", () => {
    const unticked = without("m15vehicle");
    expect(plain.frame_template).toBe("m15artifact");
    expect(remixOfPatch(plain, unticked).frame_template).toBe("m15artifact");
    expect(remixOfPatch(plain, VERIFIED).frame_template).toBe("m15vehicle");
    expect(remixOfPatch(blue, unticked).frame_template).toBe("m15artifact");
    expect(remixOfPatch(blue, VERIFIED).frame_template).toBe("m15vehicle");
  });

  it("keeps the Vehicle's mechanics and price: the subtype, the P/T, one credit", () => {
    const before = remixOfPatch(plain, without("m15vehicle"));
    const after = remixOfPatch(plain, VERIFIED);
    expect(after).toEqual({ ...before, frame_template: "m15vehicle" });
    expect(after.subtypes).toEqual(["Vehicle"]);
    expect(remixCreditsOf(after)).toBe(1);
    expect(remixCreditsOf(before)).toBe(1);
  });

  it("another colour's tick never counts: an unverified colour stays on the verified artifact frame", () => {
    const unticked = [...without("m15vehicle")];
    for (const key of COLOUR_KEYS.filter((k) => k !== "u")) {
      const verified = new Set([...unticked, frameComboKey("m15vehicle", key)]);
      expect(remixOfPatch(blue, verified).frame_template).toBe("m15artifact");
      expect(remixOfPatch(extended, verified).frame_template).toBe("m15artifact");
    }
    expect(remixOfPatch(blue, new Set([...unticked, frameComboKey("m15vehicle", "u")])).frame_template).toBe("m15vehicle");
  });

  it("borderless and extended-art Vehicles land there too (nearest), and on the artifact frame until it is verified", () => {
    const unticked = without("m15vehicle");
    expect(remixOfPatch(extended, unticked).frame_template).toBe("m15artifact");
    expect(remixOfPatch(extended, VERIFIED).frame_template).toBe("m15vehicle");
    expect(remixOfPatch(borderless, unticked).frame_template).toBe("m15artifact");
    expect(remixOfPatch(borderless, VERIFIED).frame_template).toBe("m15vehicle");
    // The match is still the printing's own frame, nearest — only the landing moved.
    expect(finalizeImportMatch(borderless, VERIFIED).frame_match).toMatchObject({ status: "nearest", template: "m15borderlessartifact", landOn: "m15vehicle" });
  });

  it("Dominaria's silver-plated Weatherlight stays pinned to the artifact frame, whatever is verified", () => {
    for (const [set, collector_number] of [["dom", "237"], ["pdom", "237s"], ["plst", "DOM-237"]] as const) {
      const weatherlight = vehicle({
        name: "Weatherlight", set, collector_number, frame_effects: ["legendary"], type_line: "Legendary Artifact — Vehicle",
        mana_cost: "{4}", power: "4", toughness: "5", released_at: "2018-04-27", rarity: "mythic",
      });
      expect(remixOfPatch(weatherlight, without("m15vehicle")).frame_template, set).toBe("m15artifact");
      expect(remixOfPatch(weatherlight, VERIFIED).frame_template, set).toBe("m15artifact");
    }
  });

  it("a non-Vehicle artifact is unchanged", () => {
    const ring = vehicle({ name: "Sol Ring", set: "c21", collector_number: "263", type_line: "Artifact", keywords: [], mana_cost: "{1}", power: undefined, toughness: undefined, oracle_text: "{T}: Add {C}{C}." });
    const equipment = vehicle({ name: "Bonesplitter", type_line: "Artifact — Equipment", keywords: ["Equip"], mana_cost: "{1}", power: undefined, toughness: undefined, oracle_text: "Equip {1}" });
    for (const patch of [ring, equipment, patchOf("lea-255")]) {
      expect(remixOfPatch(patch, VERIFIED)).toEqual(remixOfPatch(patch, without("m15vehicle")));
      expect(remixOfPatch(patch, VERIFIED).frame_template).not.toBe("m15vehicle");
    }
  });

  it("lands where the creator's import lands the same printing, verified or not", () => {
    const unticked = without("m15vehicle");
    for (const patch of [plain, blue, extended, borderless, patchOf("lea-255")]) {
      for (const verified of [unticked, VERIFIED, new Set([...unticked, frameComboKey("m15vehicle", "u")])]) {
        expect(remixOfPatch(patch, verified).frame_template).toBe(importLanding(patch, verified));
      }
    }
  });

  it("an M20+ token lands on the full-art design where it is verified, and on the arch where it isn't (token/m20)", () => {
    const soldier = mapScryfallToFormPatch(scryfallCardSchema.parse(tokenPrintings["tfdn-6"]));
    const landed = remixOfPatch(soldier, PROD).frame_template;
    expect(landed).toBe(importLanding(soldier, PROD));
    expect(landed.startsWith("m20token")).toBe(true);
    const unticked = without("m20token", "m20tokentext", "m20tokentall");
    expect(remixOfPatch(soldier, unticked).frame_template).toBe(soldier.frame_template);
    expect(remixOfPatch(soldier, unticked).frame_template.startsWith("m15token")).toBe(true);
  });

  it("a patch without a match (an older caller) resolves from its frame_template as before", () => {
    const { frame_match: _match, ...bare } = plain;
    void _match;
    expect(remixFrameFor(bare, VERIFIED)).toMatchObject({ ok: true, template: "m15artifact" });
  });
});
