import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch, remixFrameFor } from "@/lib/creator/frame-resolve";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import printingsData from "./fixtures/saga-dfc-printings.json";

// ---------------------------------------------------------------------------
// TODO 5.5 (b) — every paper printing of a transforming Saga on Scryfall
// (2026-10-16: 124, fixtures/saga-dfc-printings.json) through the import and
// the AI remix's landing:
//   • until the double-faced saga front AND the back its family derives are
//     verified, every printing imports EXACTLY as it did on origin/main —
//     the whole finalized patch but its frame match, and the remix's
//     landing (fixtures/saga-dfc-main-landings.json, recorded on origin/main
//     4dc03457 by this file with SAGA_DFC_CAPTURE set);
//   • once they are, exactly NEO's plain fronts (and their promos — the
//     closed fan, the 2016–22 back with the open fan) and TLA #117 (the ▼
//     back) move onto the double-faced saga front, both faces; the rest —
//     a Saga BACK (MOM, LCI, FIN, REX), a colourless Avatar back (TLA, 5.11),
//     a showcase / extended / borderless dress — stay.
// ---------------------------------------------------------------------------

const printings = Object.fromEntries(
  Object.entries(printingsData as Record<string, unknown>)
    .filter(([key]) => key !== "_note")
    .map(([key, card]) => [key, scryfallCardSchema.parse(card) as ScryfallCard]),
);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const NEW_BODIES = ["sagadfcfront"];

/** Production's verified combos (supabase/seed.sql's frame_reviews block). */
function productionKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) for (const k of KEYS) out.add(frameComboKey(template as never, k));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) out.add(frameComboKey(template as never, colour));
  for (const key of [...out]) if (NEW_BODIES.some((t) => key.startsWith(`${t}/`) || key.startsWith(`${t}:`))) out.delete(key);
  return out;
}
const PROD = productionKeys();
/** …and every saga and transform body ticked in every colour. */
const BODIES = ["saga", "sagadfcfront", "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback"];
const TICKED = new Set([...PROD, ...BODIES.flatMap((t) => KEYS.map((k) => frameComboKey(t as never, k)))]);
/** …and the same with the new front ticked but its backs not. */
const FRONT_ONLY = new Set([...TICKED].filter((key) => !/^m15dfc(back|backleft|landback)[/:]/.test(key)));

/** The finalized patch as the creator is handed it, without its frame match
 *  (which names the new rule), and where the remix lands. */
function landingOf(card: ScryfallCard, verified: ReadonlySet<string>) {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified) as Record<string, unknown>;
  const { frame_match: _match, ...rest } = patch;
  void _match;
  const remix = remixFrameFor(mapScryfallToFormPatch(card, { artPreviewUrl: null }) as never, verified);
  return { patch: JSON.parse(JSON.stringify(rest)), remix: remix.ok ? remix.template : remix.error };
}

const capture = process.env.SAGA_DFC_CAPTURE;

describe.skipIf(!capture)("recording (on origin/main)", () => {
  it("writes every printing's landing", () => {
    const landings = Object.fromEntries(Object.entries(printings).map(([key, card]) => [key, landingOf(card, PROD)]));
    fs.writeFileSync(capture!, JSON.stringify({ base: "origin/main", landings }, null, 1) + "\n");
  });
});

describe.skipIf(Boolean(capture))("transforming Saga imports (TODO 5.5 (b))", () => {
  // (Read when the tests run, not when the recording collects them.)
  let recorded: Record<string, unknown> | null = null;
  const mainOf = (): Record<string, unknown> =>
    (recorded ??= (JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/unit/scryfall/fixtures/saga-dfc-main-landings.json"), "utf8")) as {
      landings: Record<string, unknown>;
    }).landings);
  const main = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => mainOf()[key],
    ownKeys: () => Reflect.ownKeys(mainOf()),
    getOwnPropertyDescriptor: (_, key) => Object.getOwnPropertyDescriptor(mainOf(), key),
  });

  it("covers every printing the recording does", () => {
    expect(Object.keys(printings).sort()).toEqual(Object.keys(main).sort());
    expect(Object.keys(printings)).toHaveLength(124);
  });

  it("before the ticks: every printing imports (and remixes) exactly as on origin/main", () => {
    const changed = Object.entries(printings)
      .filter(([key, card]) => JSON.stringify(landingOf(card, PROD)) !== JSON.stringify(main[key]))
      .map(([key]) => key);
    expect(changed).toEqual([]);
  });

  it("with only the front ticked (not its back): still as on origin/main — both faces or neither", () => {
    const changed = Object.entries(printings)
      .filter(([key, card]) => JSON.stringify(landingOf(card, FRONT_ONLY).patch) !== JSON.stringify((main[key] as { patch: unknown }).patch))
      .map(([key]) => key);
    expect(changed).toEqual([]);
  });

  it("once ticked: every transforming Saga whose back has a body moves — onto the double-faced saga front, its back on the body its family derives; EXACT on NEO's plain mono-colour fronts", () => {
    const moved: Record<string, [unknown, unknown, unknown, unknown, unknown]> = {};
    for (const [key, card] of Object.entries(printings)) {
      const { patch, remix } = landingOf(card, TICKED);
      if (patch.frame_template !== "sagadfcfront") continue;
      const back = patch.back_face as { frame_style?: { template?: string } } | undefined;
      const status = (finalizeImportMatch(mapScryfallToFormPatch(card) as never, TICKED) as { frame_match?: { status?: string } }).frame_match?.status;
      moved[key] = [patch.kind, back?.frame_style?.template ?? null, patch.printed_dfc_icon ?? null, remix, status];
    }
    // NEO's plain fronts and their promos: the fans, exact — but the two
    // two-colour ones (#221 Hidetsugu Consumes All, BR), nearest on the gold
    // master (the `two-colour` gap).
    const neo = [4, 11, 12, 29, 34, 48, 57, 66, 108, 109, 117, 124, 141, 152, 162, 172, 177, 181, 194, 210, 212, 221, 227].map((n) => `neo-${n}`);
    const pneo = ["34s", "57s", "124s", "141s", "181s", "194s", "212s", "221s", "227s"].map((n) => `pneo-${n}`);
    // NEO's showcase and extended-art dresses: nearest, on the same bodies.
    const neoDressed = [354, 355, 356, 357, 358, 359, 360, 361, 362, 442, 443, 462, 465, 473, 475, 482, 486, 489].map((n) => `neo-${n}`);
    // TLA #117 (a black back) under the Nyx starfield, the borderless ones
    // (REX #7's land back, SCH #44, TLA #356): nearest on the bordered bodies.
    const nearest = ["tla-117", "ptla-117s", "rex-7", "sch-44", "tla-356"];
    expect(Object.keys(moved).sort()).toEqual([...neo, ...pneo, ...neoDressed, ...nearest].sort());
    for (const key of [...neo, ...pneo, ...neoDressed]) {
      const exact = !neoDressed.includes(key) && key !== "neo-221" && key !== "pneo-221s";
      expect(moved[key], key).toEqual(["saga", "m15dfcbackleft", "fan", "sagadfcfront", exact ? "exact" : "nearest"]);
    }
    for (const key of ["tla-117", "ptla-117s", "sch-44", "tla-356"]) expect(moved[key], key).toEqual(["saga", "m15dfcback", "arrows", "sagadfcfront", "nearest"]);
    expect(moved["rex-7"]).toEqual(["saga", "m15dfclandback", "arrows", "sagadfcfront", "nearest"]);
  });

  it("the rest land where they would without the new front, ticked or not", () => {
    const withoutFront = new Set([...TICKED].filter((key) => !key.startsWith("sagadfcfront")));
    const stay = Object.entries(printings).filter(([, card]) => landingOf(card, TICKED).patch.frame_template !== "sagadfcfront");
    const changed = stay
      .filter(([, card]) => JSON.stringify(landingOf(card, TICKED).patch) !== JSON.stringify(landingOf(card, withoutFront).patch))
      .map(([key]) => key);
    expect(changed).toEqual([]);
    expect(stay.length).toBe(124 - 55);
  });
});
