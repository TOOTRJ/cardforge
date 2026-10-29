import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import printingsData from "./fixtures/saga-creature-printings.json";

// ---------------------------------------------------------------------------
// TODO 4.5d — every paper printing of a one-faced saga CREATURE on Scryfall
// (2026-10-28: 51, fixtures/saga-creature-printings.json — FIN / FIC / PFIN's
// "Summon:" cards, 29 black-bordered + 22 borderless) through the import and
// the AI remix's landing:
//   • until the saga creature body is verified in the card's colour, every
//     printing imports EXACTLY as it did on origin/main — the whole
//     finalized patch but its frame match, and the remix's landing
//     (fixtures/saga-creature-main-landings.json, recorded on origin/main's
//     import code by this file with SAGA_CREATURE_CAPTURE set);
//   • once it is, exactly the 29 black-bordered printings move onto it,
//     EXACT, their frame alone changing; the 22 borderless ones stay where
//     they land (4.38's borderless saga).
// ---------------------------------------------------------------------------

const printings = Object.fromEntries(
  Object.entries(printingsData as Record<string, unknown>)
    .filter(([key]) => key !== "_note")
    .map(([key, card]) => [key, scryfallCardSchema.parse(card) as ScryfallCard]),
);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];

/** Production's verified combos (supabase/seed.sql's frame_reviews block),
 *  less any saga creature tick. */
function productionKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) for (const k of KEYS) out.add(frameComboKey(template as never, k));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) out.add(frameComboKey(template as never, colour));
  for (const key of [...out]) if (key.startsWith("sagacreature/") || key.startsWith("sagacreature:")) out.delete(key);
  return out;
}
const PROD = productionKeys();
/** …and the saga and the saga creature ticked in every colour. */
const TICKED = new Set([...PROD, ...["saga", "sagacreature"].flatMap((t) => KEYS.map((k) => frameComboKey(t as never, k)))]);
/** …and the saga alone (the creature body unticked). */
const SAGA_ONLY = new Set([...PROD, ...KEYS.map((k) => frameComboKey("saga" as never, k))]);

function landingOf(card: ScryfallCard, verified: ReadonlySet<string>) {
  const finalized = finalizeImportMatch(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified) as Record<string, unknown>;
  const { frame_match: frameMatch, ...rest } = finalized;
  const match = frameMatch as { status: string; template: string; landOn?: string; signature: string };
  const remix = remixFrameFor(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified);
  return {
    patch: JSON.parse(JSON.stringify(rest)) as Record<string, unknown>,
    /** Where the import lands and what it says of it. */
    land: { frame: match.landOn ?? match.template, status: match.status, signature: match.signature },
    remix: remix.ok ? remix.template : remix.error,
  };
}

const capture = process.env.SAGA_CREATURE_CAPTURE;

describe.skipIf(!capture)("recording (on origin/main's import)", () => {
  it("writes every printing's landing", () => {
    const landings = Object.fromEntries(
      Object.entries(printings).map(([key, card]) => {
        const { patch, land, remix } = landingOf(card, PROD);
        return [key, { patch, land, remix }];
      }),
    );
    fs.writeFileSync(capture!, JSON.stringify({ base: "origin/main", landings }, null, 1) + "\n");
  });
});

describe.skipIf(Boolean(capture))("saga creature imports (TODO 4.5d)", () => {
  type Landing = { patch: Record<string, unknown>; land: { frame: string; status: string; signature: string }; remix: string };
  let recorded: Record<string, Landing> | null = null;
  const main = () =>
    (recorded ??= (
      JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/unit/scryfall/fixtures/saga-creature-main-landings.json"), "utf8")) as {
        landings: Record<string, Landing>;
      }
    ).landings);
  const borderless = (key: string) => printings[key].border_color === "borderless";

  it("holds the 51 printings: 29 black-bordered, 22 borderless, every one a Saga Creature with a P/T", () => {
    const keys = Object.keys(printings);
    expect(keys).toHaveLength(51);
    expect(keys.filter(borderless)).toHaveLength(22);
    for (const key of keys) {
      expect(printings[key].type_line, key).toMatch(/Creature — Saga/);
      expect(printings[key].power, key).toBeTruthy();
    }
  });

  it("imports every printing exactly as origin/main while the body is unverified (production's ticks, and with the saga ticked)", () => {
    for (const verified of [PROD, SAGA_ONLY]) {
      for (const [key, card] of Object.entries(printings)) {
        const now = landingOf(card, verified);
        if (verified === PROD) {
          expect(now.patch, key).toEqual(main()[key].patch);
          expect(now.remix, key).toBe(main()[key].remix);
          // The landing and its status are main's; a black-bordered
          // printing's SIGNATURE is the new rule's (saga/creature/2015, which
          // names the body once verified) where main's was layout/2015 with
          // the universes-beyond gap — the same frame, `nearest`.
          const { signature, ...land } = now.land;
          const { signature: mainSignature, ...mainLand } = main()[key].land;
          expect(land, key).toEqual(mainLand);
          expect(signature, key).toBe(borderless(key) ? mainSignature : "saga/creature/2015");
        }
        expect(now.land.frame, key).toBe("saga");
        expect(now.remix, key).toBe("saga");
      }
    }
  });

  it("moves exactly the black-bordered printings onto the saga creature once it is verified — exact, the frame alone changing", () => {
    for (const [key, card] of Object.entries(printings)) {
      const before = landingOf(card, SAGA_ONLY);
      const after = landingOf(card, TICKED);
      expect(after.patch, key).toEqual(before.patch);
      if (borderless(key)) {
        expect(after.land, key).toEqual(before.land);
        expect(after.remix, key).toBe(before.remix);
        continue;
      }
      expect(after.land, key).toEqual({ frame: "sagacreature", status: "exact", signature: "saga/creature/2015" });
      expect(after.remix, key).toBe("sagacreature");
    }
  });
});
