import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";

// ---------------------------------------------------------------------------
// TODO 1.24 — the guard on the registry's `textless` FAMILY, the day its
// frames stop drawing text.
//
// Today `m15textless` / `m15textlessland` are not `textless` profiles: they
// draw their type line and rules on the art, so a remix that lands on one
// (textless/2015, textless/future, borderless/textless,
// borderless/basic/textless statically; textless/old-frame once the frame
// is verified, owner decision A9) saves a text that IS drawn, and the guard
// leaves it alone (remix-textless-guard.test.ts). The printed cards carry
// no text at all, and the profile flag exists for exactly that (TODO 3.24;
// 4.37 / 4.42 build the real textless frames). This file gives the two
// profiles the flag — the ONLY thing mocked — and pins that the guard then
// covers every one of those rules with no other change: the remix keeps the
// stand-in the import uses while the frame is unverified, and a remix that
// saves with no text keeps the textless frame.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (...args: Parameters<typeof real.getFrameProfile>) => {
      const profile = real.getFrameProfile(...args);
      return args[0] === "m15textless" || args[0] === "m15textlessland" ? { ...profile, textless: true } : profile;
    },
  };
});

import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { autoTokenTextBoxFrame, frameHidesRulesBoxText, remixSavedFrame } from "@/lib/creator/frame-resolve";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameGateError } from "@/lib/cards/frame-availability";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameTemplate } from "@/types/card";

const every = (templates: readonly string[]) =>
  templates.flatMap((t) => FRAME_COLOR_KEYS.map((c) => frameComboKey(t as FrameTemplate, c)));
const ALL = new Set(every(FRAME_TEMPLATE_VALUES));
const FAMILY = ["m15textless", "m15textlessland"];
const UNTICKED = new Set([...ALL].filter((key) => !FAMILY.some((t) => key.startsWith(`${t}/`))));

function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const keys = new Set<string>(every([...everyColour.matchAll(/'([^']+)'/g)].map((m) => m[1])));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  return keys;
}
const PROD = productionVerifiedKeys();

/** One real printing per rule of the family (trimmed fixtures carry no
 *  oracle text: the card's real line is put back, as Scryfall sends it). */
const RULES = [
  { signature: "textless/2015", raw: signaturePrintings["sch-3"], oracle: "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.", landing: "m15textless", standIn: "m15" },
  { signature: "textless/2015", raw: signaturePrintings["pf19-1"], oracle: "Lightning Bolt deals 3 damage to any target.", landing: "m15textless", standIn: "m15" },
  { signature: "textless/2015", raw: importPrintings["sld-2794"], oracle: null, landing: "m15textlessland", standIn: "m15land" },
  { signature: "textless/old-frame", raw: signaturePrintings["p07-1"], oracle: "Destroy all creatures. They can't be regenerated.", landing: "m15textless", standIn: "modern" },
  { signature: "textless/old-frame", raw: signaturePrintings["p10-1"], oracle: "Lightning Bolt deals 3 damage to any target.", landing: "m15textless", standIn: "modern" },
  { signature: "textless/future", raw: signaturePrintings["fut-19"], oracle: "Rampage 1", landing: "m15textless", standIn: "m15" },
  { signature: "borderless/textless", raw: signaturePrintings["msh-385"], oracle: "{T}: Add {C}.", landing: "m15textless", standIn: "m15artifact" },
  { signature: "borderless/basic/textless", raw: signaturePrintings["unf-235"], oracle: null, landing: "m15textlessland", standIn: "m15land" },
] as const;

function remixOf(rule: (typeof RULES)[number], verifiedKeys: ReadonlySet<string>) {
  const raw = structuredClone(rule.raw) as Record<string, unknown>;
  if (rule.oracle) raw.oracle_text = rule.oracle;
  const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(raw));
  expect(patch.frame_match?.signature).toBe(rule.signature);
  const resolved = scryfallRemixMechanics(patch, "Entry", verifiedKeys);
  if (!resolved.ok) throw new Error(resolved.error);
  const m = resolved.mechanics;
  const save = (flavorText: string | null, rulesText: string | null | undefined = m.rules_text) => {
    const card = {
      template: m.frame_template,
      cardType: m.card_type,
      supertype: m.supertype,
      subtypes: m.subtypes,
      rulesText,
      flavorText,
      power: m.power,
      toughness: m.toughness,
      colorIdentity: m.color_identity ?? (["colorless"] as ColorIdentity[]),
      verifiedKeys,
    };
    return { before: autoTokenTextBoxFrame(card), after: remixSavedFrame({ ...card, standIn: m.text_stand_in }), card };
  };
  return { m, save };
}

describe("the `textless` family once its frames are flagged textless", () => {
  for (const rule of RULES) {
    const name = `${rule.signature} — ${(rule.raw as { name: string }).name} ${(rule.raw as { set: string }).set.toUpperCase()}`;

    it(`${name}: the frame verified → a remix with text keeps the stand-in (${rule.standIn}), one with none keeps the textless frame`, () => {
      const { m, save } = remixOf(rule, ALL);
      // The import's verified landing, as since #529 — and its stand-in:
      // where the same printing lands while the frame is unticked.
      expect(m.frame_template).toBe(rule.landing);
      expect(m.text_stand_in).toBe(rule.standIn);
      expect(remixOf(rule, UNTICKED).m.frame_template).toBe(rule.standIn);

      const withFlavour = save("New flavour.");
      expect(frameHidesRulesBoxText(withFlavour.before, withFlavour.card)).toBe(true);
      expect(withFlavour.after).toBe(rule.standIn);
      expect(frameGateError(withFlavour.after, withFlavour.card.colorIdentity, ALL)).toBeNull();

      // Copied rules alone are text too.
      if (m.rules_text?.trim()) expect(save(null).after).toBe(rule.standIn);
      // No rules, no flavour (the identity's flavour is nullable): nothing
      // is hidden, the textless landing stands.
      expect(save(null, null).after).toBe(rule.landing);

      // One face, one credit, either way.
      expect(m.back_face).toBeUndefined();
      expect(remixCreditsOf({ frame_template: withFlavour.after })).toBe(remixCreditsOf(m));
    });

    it(`${name}: the frame unverified → unchanged (no stand-in needed, the landing draws the text)`, () => {
      for (const verified of [UNTICKED, PROD]) {
        const { m, save } = remixOf(rule, verified);
        expect(FAMILY).not.toContain(m.frame_template);
        expect(m.text_stand_in).toBeUndefined();
        for (const flavour of ["New flavour.", null]) {
          const { before, after } = save(flavour);
          expect(after).toBe(before);
          expect(after).toBe(m.frame_template);
        }
      }
    });
  }
});
