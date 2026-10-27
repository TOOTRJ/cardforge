import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { dfcImportOf, dfcPrintedLookOf, frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import printingsData from "./fixtures/dfc-borderless-printings.json";
import mainLandings from "./fixtures/dfc-borderless-main-landings.json";

// ---------------------------------------------------------------------------
// TODO 5.7 — every borderless transform / modal printing on Scryfall
// (2026-10-14: 162, fixtures/dfc-borderless-printings.json) through the
// import path:
//   • the DARK plain look (`border_color: borderless` + `inverted`, no
//     showcase / poster / one-off set) puts both faces on the borderless
//     bodies — when both faces HAVE one (spell faces; the transform back in
//     today's ▲ / ▼ family);
//   • until both combos are verified it lands where it landed before 5.7 —
//     on the bordered bodies, or on the standard frame — byte for byte
//     (fixtures/dfc-borderless-main-landings.json, recorded on origin/main);
//   • once they are, exactly the plain dark printings move, and onto the
//     borderless bodies.
// ---------------------------------------------------------------------------

const printings = Object.fromEntries(
  Object.entries(printingsData as Record<string, unknown>).map(([key, card]) => [key, scryfallCardSchema.parse(card) as ScryfallCard]),
);
const BORDERLESS_BODIES = ["m15borderlessdfcfront", "m15borderlessdfcback", "m15borderlessmdfcfront", "m15borderlessmdfcback"];
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];

/** Production's verified combos (supabase/seed.sql's frame_reviews block),
 *  WITHOUT any borderless body — the list as it stood before 5.7. */
function productionKeys(): Set<string> {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "") ?? "";
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) for (const k of KEYS) out.add(frameComboKey(template as never, k));
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) out.add(frameComboKey(template as never, colour));
  for (const key of [...out]) if (BORDERLESS_BODIES.some((t) => key.startsWith(`${t}/`) || key.startsWith(`${t}:`))) out.delete(key);
  return out;
}
const PROD = productionKeys();
const TICKED = new Set([...PROD, ...BORDERLESS_BODIES.flatMap((t) => KEYS.map((k) => frameComboKey(t as never, k)))]);

type Landing = [string | undefined, string | undefined, string | null, string[] | null];
function landingOf(card: ScryfallCard, verified: ReadonlySet<string>): Landing {
  const patch = finalizeImportMatch(mapScryfallToFormPatch(card) as never, verified) as {
    kind?: string;
    frame_template?: string;
    back_face?: { frame_style?: { template?: string }; color_identity?: string[] };
  };
  return [patch.kind, patch.frame_template, patch.back_face?.frame_style?.template ?? null, patch.back_face?.color_identity ?? null];
}

/** The plain dark printings that move onto the borderless bodies once they
 *  are verified — 28 transform, 16 modal (MSH's legends, SPM #200 / #202). */
const MOVES_TRANSFORM = [
  "ecl-285", "ecl-286", "ecl-288", "ecl-289", "ecl-290", "ecl-291",
  "fin-317", "fin-322", "fin-329", "fin-380", "fin-382", "fin-383", "fin-384", "fin-394", "fin-398", "fin-399",
  "fin-525", "fin-527", "fin-528", "fin-529", "fin-539", "fin-543", "fin-544",
  "lmar-3", "pr23-3", "sld-1608", "sld-1612", "slx-29",
];
const MOVES_MODAL = [
  "msh-328", "msh-331", "msh-345", "msh-346", "msh-350", "msh-355", "msh-356", "msh-359", "msh-363", "msh-373", "msh-388", "msh-390", "msh-392", "msh-399",
  "spm-200", "spm-202",
];

describe("borderless double-faced imports (TODO 5.7)", () => {
  it("covers every borderless transform / modal printing the recording does", () => {
    expect(Object.keys(printings).sort()).toEqual(Object.keys(mainLandings.landings).sort());
    expect(Object.keys(printings)).toHaveLength(162);
  });

  it("before the ticks: every printing lands exactly where it landed on origin/main", () => {
    const changed = Object.entries(printings)
      .filter(([key, card]) => JSON.stringify(landingOf(card, PROD)) !== JSON.stringify((mainLandings.landings as unknown as Record<string, Landing>)[key]))
      .map(([key]) => key);
    expect(changed).toEqual([]);
  });

  it("with every borderless body ticked: exactly the plain dark printings move, onto the borderless bodies", () => {
    const moved: string[] = [];
    for (const [key, card] of Object.entries(printings)) {
      const before = (mainLandings.landings as unknown as Record<string, Landing>)[key];
      const after = landingOf(card, TICKED);
      if (JSON.stringify(after) === JSON.stringify(before)) continue;
      moved.push(key);
      const transform = after[0] === "transform";
      expect(after[1], key).toBe(transform ? "m15borderlessdfcfront" : "m15borderlessmdfcfront");
      expect(after[2], key).toBe(transform ? "m15borderlessdfcback" : "m15borderlessmdfcback");
      // Only the bodies move: the kind, the back colour stay.
      expect(after[0], key).toBe(before[0]);
      expect(after[3], key).toEqual(before[3]);
    }
    expect(moved.sort()).toEqual([...MOVES_TRANSFORM, ...MOVES_MODAL].sort());
  });

  it("the look: the dark plain look only — not the light look, a showcase, a poster or BOT's shattered glass", () => {
    const looks = Object.fromEntries(Object.entries(printings).map(([key, card]) => [key, dfcPrintedLookOf(card)]));
    for (const key of [...MOVES_TRANSFORM, ...MOVES_MODAL]) expect(looks[key], key).toBe("borderless");
    for (const key of ["znr-284", "khm-290", "sld-1157", "slu-11", "bot-22", "spm-224", "spm-209", "mom-292", "tla-346"]) {
      expect(looks[key], key).toBe("bordered");
    }
    // A face with no borderless body yet lands on the bordered bodies (the
    // `borderless-dfc-face` gap): a land back, a sun / moon back.
    for (const key of ["sld-1502", "sld-2655", "vow-341", "vow-336"]) {
      expect(looks[key], key).toBe("borderless");
      expect(dfcImportOf(printings[key])?.look, key).toBe("bordered");
      expect(frameMatchFromScryfall(printings[key]).signature, key).toBe("borderless/dfc+borderless-dfc-face");
    }
  });

  it("the Avatar elemental's double-faced printings (TLA #346 / #347) are nearest on it: the frame draws neither the transform triangle nor the back's P/T", () => {
    for (const key of ["tla-346", "tla-347"]) {
      expect(frameMatchFromScryfall(printings[key]), key).toMatchObject({
        signature: "showcase/tla/avatar+dfc",
        status: "nearest",
        template: "avatar",
        blockedBy: "5.5",
      });
      expect(frameMatchFromScryfall(printings[key]).reason, key).toMatch(/double-faced marks/);
    }
  });

  it("the registry: exact on the borderless front; 'not yet verified' until both faces are ticked, landing on the bordered bodies", () => {
    const ecl = printings["ecl-290"];
    expect(frameMatchFromScryfall(ecl)).toMatchObject({ signature: "borderless/dfc", status: "exact", template: "m15borderlessdfcfront" });
    const patch = mapScryfallToFormPatch(ecl);
    expect(patch).toMatchObject({ kind: "transform", frame_template: "m15borderlessdfcfront" });
    expect(patch.back_face?.frame_style?.template).toBe("m15borderlessdfcback");
    const before = finalizeImportMatch(patch as never, PROD) as typeof patch & { frame_match: { status: string; reason?: string; landOn?: string; unverified?: true } };
    expect(before.frame_template).toBe("m15dfcfront");
    expect(before.back_face?.frame_style?.template).toBe("m15dfcback");
    expect(before.frame_match).toMatchObject({ status: "nearest", landOn: "m15dfcfront", unverified: true });
    expect(before.frame_match.reason).toMatch(/borderless double-faced frame isn't verified in red/);
    // The front ticked alone is not enough: the back's colour (blue) too.
    const frontOnly = new Set([...PROD, frameComboKey("m15borderlessdfcfront", "r")]);
    expect((finalizeImportMatch(patch as never, frontOnly) as typeof patch).frame_template).toBe("m15dfcfront");
    const both = new Set([...frontOnly, frameComboKey("m15borderlessdfcback", "u")]);
    const after = finalizeImportMatch(patch as never, both) as typeof patch & { frame_match: { status: string } };
    expect(after.frame_template).toBe("m15borderlessdfcfront");
    expect(after.back_face?.frame_style?.template).toBe("m15borderlessdfcback");
    expect(after.frame_match.status).toBe("exact");
    // MSH's variant faces (the #578 check): #355–363's floating name and
    // #388–399's comic-cover backs are nearest with a gap of their own;
    // #328–350 stay exact.
    for (const key of ["msh-355", "msh-356", "msh-359", "msh-363", "msh-388", "msh-390", "msh-392", "msh-399"]) {
      expect(frameMatchFromScryfall(printings[key]), key).toMatchObject({ signature: "borderless/dfc+marvel-variant-face", status: "nearest", template: "m15borderlessmdfcfront", blockedBy: "5.7d" });
    }
    for (const key of ["msh-328", "msh-331", "msh-345", "msh-346", "msh-350"]) {
      expect(frameMatchFromScryfall(printings[key]), key).toMatchObject({ signature: "borderless/dfc", status: "exact" });
    }
    // The light look stays nearest on the bordered body.
    expect(frameMatchFromScryfall(printings["znr-284"])).toMatchObject({ signature: "borderless/dfc/light", status: "nearest", blockedBy: "5.7" });
  });
});
