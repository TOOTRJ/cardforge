import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { dfcImportOf, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import printingsData from "./fixtures/saga-dfc-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.5d, part B — FIN's Dominants transform into summons whose BACK face
// is a saga creature (FIN #13, #16, #58, #104, #133, #185, #229, #245, PFIN's
// seven prerelease twins, the six extended-art and thirteen borderless
// printings: 34, fixtures/saga-dfc-printings.json, Scryfall 2026-10-16).
// Until 4.5d part B they imported onto the front's standard frame with a
// legacy back (`face-type`); tests/unit/scryfall/saga-dfc-imports.test.ts
// holds every one to origin/main's landing while the new body is unticked.
// Here, once the saga creature back is verified (and the transform front):
//   • the black-bordered and borderless printings land on the transform
//     bodies — the front on `m15dfcfront`, the back on `sagacreaturedfcback`
//     in its own colour, the ▼ family — under the transform rule, nearest
//     for the Universes Beyond dress alone (every FIN printing's, 4.25: no
//     double-faced body draws it), the borderless ones nearest on the
//     bordered bodies (5.7); never the `dfc` gap or the Nyx starfield; the
//     two-colour summons (#229 R W, #245 G R and their prerelease twins) on
//     the gold master (no pair masters on the body: a follow-up);
//   • the extended-art ones keep today's landing (no extended-art
//     double-faced body: 5.7b);
//   • a tick in another colour, or of the front alone, moves nothing.
// ---------------------------------------------------------------------------

const printings = Object.fromEntries(
  Object.entries(printingsData as Record<string, unknown>)
    .filter(([key]) => /^p?fin-/.test(key))
    .map(([key, card]) => [key, scryfallCardSchema.parse(card) as ScryfallCard]),
);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const BODY = "sagacreaturedfcback";

/** Production's verified combos (supabase/seed.sql's frame_reviews block),
 *  less any tick of the new body. */
function productionKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) for (const k of KEYS) out.add(frameComboKey(template as never, k));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) out.add(frameComboKey(template as never, colour));
  for (const key of [...out]) if (key.startsWith(`${BODY}/`) || key.startsWith(`${BODY}:`)) out.delete(key);
  return out;
}
const PROD = productionKeys();
/** …and the transform front ticked in every colour (the front alone). */
const FRONT = new Set([...PROD, ...KEYS.map((k) => frameComboKey("m15dfcfront" as never, k))]);
/** …and the saga creature back ticked in every colour too. */
const TICKED = new Set([...FRONT, ...KEYS.map((k) => frameComboKey(BODY as never, k))]);

function landingOf(card: ScryfallCard, verified: ReadonlySet<string>) {
  const finalized = finalizeImportMatch(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified) as Record<string, unknown>;
  const { frame_match: frameMatch, ...patch } = finalized;
  const remix = remixFrameFor(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified);
  return {
    patch: JSON.parse(JSON.stringify(patch)) as Record<string, unknown>,
    match: frameMatch as { status: string; template: string; landOn?: string; signature: string; gaps?: string[] },
    remix: remix.ok ? remix.template : remix.error,
  };
}

const PLAIN = ["fin-13", "fin-16", "fin-58", "fin-104", "fin-133", "fin-185", "pfin-16s", "pfin-58s", "pfin-104s", "pfin-133s", "pfin-185s"];
const TWO_COLOUR = ["fin-229", "fin-245", "pfin-229s", "pfin-245s"];
const BORDERLESS = ["fin-318", "fin-323", "fin-357", "fin-363", "fin-370", "fin-376", "fin-378", "fin-385", "fin-397", "fin-521", "fin-523", "fin-530", "fin-542"];
const EXTENDED = ["fin-428", "fin-438", "fin-448", "fin-458", "fin-494", "fin-511"];

describe("FIN's saga creature backs (TODO 4.5d, part B)", () => {
  it("holds the 34 printings: every back a Legendary-or-not Enchantment Creature — Saga with a P/T", () => {
    expect(Object.keys(printings).sort()).toEqual([...PLAIN, ...TWO_COLOUR, ...BORDERLESS, ...EXTENDED].sort());
    for (const [key, card] of Object.entries(printings)) {
      const back = card.card_faces?.[1];
      expect(back?.type_line, key).toMatch(/Enchantment Creature — Saga/);
      expect(back?.power, key).toBeTruthy();
    }
  });

  it("the mapper puts every one but the extended-art printings on the transform bodies, the back on the saga creature back", () => {
    for (const [key, card] of Object.entries(printings)) {
      const facts = dfcImportOf(card)!;
      if (EXTENDED.includes(key)) {
        expect(facts.blocked, key).toBe("face-type");
        continue;
      }
      expect([facts.kind, facts.frontBody, facts.backBody, facts.family, facts.blocked], key).toEqual(["transform", "m15dfcfront", BODY, "arrows", null]);
    }
  });

  it("before the back body is ticked (the front ticked or not), nothing moves: the front's standard frame, a legacy back", () => {
    for (const verified of [PROD, FRONT]) {
      for (const [key, card] of Object.entries(printings)) {
        const { patch } = landingOf(card, verified);
        expect(patch.kind, key).not.toBe("transform");
        expect((patch.back_face as { frame_style?: unknown } | undefined)?.frame_style, key).toBeUndefined();
        expect(patch.printed_dfc_icon, key).toBeUndefined();
      }
    }
  });

  it("a tick in another colour moves nothing", () => {
    const other = new Set([...FRONT, frameComboKey(BODY as never, "c")]);
    for (const [key, card] of Object.entries(printings)) {
      expect(landingOf(card, other).patch, key).toEqual(landingOf(card, FRONT).patch);
    }
  });

  it("once ticked: the black-bordered and borderless printings land on both bodies, the back in its own colour", () => {
    const colourOf: Record<string, string[]> = { "13": ["white"], "16": ["white"], "58": ["blue"], "104": ["black"], "133": ["red"], "185": ["green"] };
    for (const key of [...PLAIN, ...TWO_COLOUR, ...BORDERLESS]) {
      const { patch, match, remix } = landingOf(printings[key], TICKED);
      const back = patch.back_face as { frame_style?: { template?: string }; color_identity?: string[]; card_type?: string; supertype?: string; power?: string };
      expect([patch.kind, patch.frame_template, back.frame_style?.template, patch.printed_dfc_icon, remix], key).toEqual([
        "transform",
        "m15dfcfront",
        BODY,
        "arrows",
        "m15dfcfront",
      ]);
      // The back as the import reads it: the creature card type, its
      // Enchantment word in front, its P/T kept.
      expect(back.card_type, key).toBe("creature");
      expect(back.supertype, key).toMatch(/Enchantment$/);
      expect(back.power, key).toBeTruthy();
      // The registry: the transform rule, NEAREST for one piece alone — the
      // Universes Beyond dress every FIN printing wears (4.25: no
      // double-faced body draws it) — the borderless ones nearest on the
      // bordered bodies (5.7); never the `dfc` gap or the Nyx starfield (the
      // back's textured saga is the body's own masters).
      if (BORDERLESS.includes(key)) {
        expect(match.signature, key).toMatch(/^borderless\/dfc\b/);
      } else {
        expect([match.signature, match.status, match.gaps], key).toEqual(["transform/2015+universes-beyond", "nearest", ["universes-beyond"]]);
      }
      expect(match.status, key).toBe("nearest");
      expect(match.gaps ?? [], key).not.toContain("dfc");
      expect(match.gaps ?? [], key).not.toContain("nyx");
      if (PLAIN.includes(key)) {
        expect(back.color_identity, key).toEqual(colourOf[key.replace(/^p?fin-/, "").replace(/s$/, "")]);
      }
      // The two-colour summons wear gold (the body has no pair masters; the
      // pair dress is a follow-up), stored as every imported multicolour
      // back is (["multicolor"]: no dot — TODO 5.19).
      if (TWO_COLOUR.includes(key)) expect(back.color_identity, key).toEqual(["multicolor"]);
    }
  });

  it("once ticked: the extended-art printings land exactly as before", () => {
    for (const key of EXTENDED) {
      expect(landingOf(printings[key], TICKED).patch, key).toEqual(landingOf(printings[key], FRONT).patch);
      expect(landingOf(printings[key], TICKED).patch.frame_template, key).toBe("extendedart");
    }
  });
});
