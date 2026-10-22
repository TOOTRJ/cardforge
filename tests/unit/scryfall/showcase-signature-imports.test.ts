import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameRequestFromImport } from "@/lib/frames/frame-requests";
import { dfcImportLanding } from "@/lib/scryfall/dfc-import";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { FrameTemplate } from "@/types/card";
import printings from "./fixtures/showcase-signature-printings.json";

// ---------------------------------------------------------------------------
// Import-registry fixes from the showcase survey (2026-10-21; TODO 4.11).
// Every fixture is a real printing captured from Scryfall on 2026-10-21 and
// trimmed to the fields the registry and the importer read.
//   • Innistrad: Double Feature (DBL) and Signature Spellbook (SS1–SS3)
//     print frames of their own that Scryfall flags only `inverted`: they
//     were EXACT on M15 (`era/2015`, `transform/2015`, `vehicle/2015`) and
//     logged nothing. Now `nearest` on the same landing, with a row.
//   • LTC #411–490 print LTR's scroll frame: they fell to the generic
//     `showcase` rule (M15).
//   • MUL's three Theros demigods (+ halo-foil twins) print the THB
//     constellation frame: they were `showcase/mul` (M15).
// ---------------------------------------------------------------------------

const P = Object.fromEntries(
  Object.entries(printings).map(([key, raw]) => [key, scryfallCardSchema.parse(raw) as ScryfallCard]),
) as Record<keyof typeof printings, ScryfallCard>;
type Key = keyof typeof printings;

/** Production's verified combos (supabase/seed.sql mirrors them). */
function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const out = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of FRAME_COLOR_KEYS) out.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    out.add(frameComboKey(template as FrameTemplate, colour));
  }
  return out;
}
const PROD = productionVerifiedKeys();

const imported = (key: Key, verified: ReadonlySet<string> = PROD) =>
  finalizeImportMatch(mapScryfallToFormPatch(P[key]), verified);
const requestRow = (key: Key, verified: ReadonlySet<string> = PROD) =>
  frameRequestFromImport(imported(key, verified), { artImported: false, source: "import" });
/** The same printing as if it came from another set: what the registry
 *  answered before these rules (the set pin is all that moved it). */
const elsewhere = (key: Key, set: string) => scryfallCardSchema.parse({ ...printings[key], set, set_name: set.toUpperCase() }) as ScryfallCard;

describe("the rule table", () => {
  it("adds the two set signatures before the masterpiece and generic showcase rules", () => {
    const at = (key: string) => FRAME_SIGNATURE_KEYS.indexOf(key);
    expect(at("double-feature")).toBeGreaterThan(at("showcase/mul"));
    expect(at("signature-spellbook")).toBe(at("double-feature") + 1);
    expect(at("signature-spellbook")).toBeLessThan(at("masterpiece"));
    // …and before every rule that called them exact.
    for (const later of ["transform/2015", "vehicle/2015", "era/2015"]) expect(at("double-feature")).toBeLessThan(at(later));
  });
});

describe("Innistrad: Double Feature (DBL) is nearest on the frame it always landed on", () => {
  const REASON = "PipGlyph doesn't have Double Feature's black-and-white frame yet";
  // [printing, its landing with production's ticks, the rule that matched before]
  const rows: [Key, FrameTemplate, string][] = [
    ["dbl-1", "m15", "era/2015"], // Adeline, legendary creature
    ["dbl-300", "m15", "era/2015"], // Sanctify
    ["dbl-23", "m15artifact", "era/2015"], // Hedgewitch's Mask
    ["dbl-260", "m15land", "era/2015"], // Deserted Beach
    ["dbl-2", "m15dfcfront", "transform/2015"], // Ambitious Farmhand // Seasoned Cathar
    ["dbl-427", "m15vehicle", "vehicle/2015"], // Honeymoon Hearse
  ];

  it("was exact before, through the rule its type picks, on the same landing", () => {
    for (const [key, landing, before] of rows) {
      const card = elsewhere(key, "mid");
      expect(frameMatchFromScryfall(card).signature, key).toBe(before);
      const patch = finalizeImportMatch(mapScryfallToFormPatch(card), PROD);
      expect(patch.frame_match?.status, key).toBe("exact");
      expect(patch.frame_template, key).toBe(landing);
    }
  });

  it("is `double-feature`, nearest, item 4.11, and lands where it did", () => {
    for (const [key, landing] of rows) {
      expect(frameMatchFromScryfall(P[key]), key).toMatchObject({
        signature: "double-feature",
        status: "nearest",
        reason: REASON,
        blockedBy: "4.11",
        exactLabel: "Innistrad: Double Feature black-and-white frame",
      });
      const patch = imported(key);
      expect(patch.frame_template, key).toBe(landing);
      expect(patch.frame_match?.status, key).toBe("nearest");
      expect(patch.frame_match?.reason, key).toBe(REASON);
      // A missing frame, not "not yet verified": verifying would not make it exact.
      expect(patch.frame_match?.unverified, key).toBeUndefined();
    }
  });

  it("writes a request-log row for every printing", () => {
    for (const [key, landing] of rows) {
      expect(requestRow(key), key).toMatchObject({
        signature: "double-feature",
        status: "nearest",
        cause: "missing",
        setCode: "dbl",
        template: landing,
      });
    }
  });

  it("the transform card keeps both faces on the double-faced bodies", () => {
    const patch = imported("dbl-2");
    expect(patch.kind).toBe("transform");
    expect(patch.frame_template).toBe("m15dfcfront");
    expect(patch.back_face).toBeDefined();
    expect(dfcImportLanding(patch, PROD)).toMatchObject({ ok: true, frontBody: "m15dfcfront" });
  });

  it("the Vehicle lands on the Vehicle frame once verified — never kept on the verified artifact stand-in", () => {
    expect(frameMatchFromScryfall(P["dbl-427"])).toMatchObject({ template: "m15artifact" });
    expect(PROD.has(frameComboKey("m15vehicle", "r"))).toBe(true);
    expect(imported("dbl-427").frame_match).toMatchObject({ status: "nearest", landOn: "m15vehicle", reason: REASON });
    const withoutVehicle = new Set([...PROD].filter((key) => !key.startsWith("m15vehicle/")));
    expect(imported("dbl-427", withoutVehicle).frame_template).toBe("m15artifact");
  });

  it("a legendary one keeps importing with the crown on — the frame prints it", () => {
    expect(imported("dbl-1").printed_crown).toBe(true);
  });
});

describe("Signature Spellbook (SS1–SS3) is nearest on the frame it always landed on", () => {
  const REASON = "PipGlyph doesn't have the Signature Spellbook frame yet";
  const rows: [Key, FrameTemplate][] = [
    ["ss1-3", "m15"], // Brainstorm
    ["ss2-8", "m15artifact"], // Blackblade Reforged
    ["ss2-1", "m15pw"], // Gideon Jura
  ];

  it("was exact on era/2015 before", () => {
    for (const [key] of rows) expect(frameMatchFromScryfall(elsewhere(key, "m19")), key).toMatchObject({ signature: "era/2015", status: "exact" });
  });

  it("is `signature-spellbook`, nearest, item 4.11, lands where it did, and logs a row", () => {
    for (const [key, landing] of rows) {
      expect(frameMatchFromScryfall(P[key]), key).toMatchObject({ signature: "signature-spellbook", status: "nearest", reason: REASON, blockedBy: "4.11" });
      expect(imported(key).frame_template, key).toBe(landing);
      expect(requestRow(key), key).toMatchObject({ signature: "signature-spellbook", status: "nearest", cause: "missing", template: landing });
    }
  });

  it("the legendary artifact keeps its crown", () => {
    expect(imported("ss2-8").printed_crown).toBe(true);
  });
});

describe("LTC #411–490 are LTR's scroll showcase", () => {
  it("every one carries Scryfall's `scroll` promo type", () => {
    for (const key of ["ltc-411", "ltc-465", "ltc-485", "ltc-490"] as const) expect(P[key].promo_types, key).toContain("scroll");
  });

  it("resolves `showcase/ltr/scroll` on lotrscroll, nearest (its border is 4.35's), as LTR's run does", () => {
    for (const key of ["ltc-411", "ltc-485", "ltc-490"] as const) {
      expect(frameMatchFromScryfall(P[key]), key).toMatchObject({ signature: "showcase/ltr/scroll", status: "nearest", template: "lotrscroll", blockedBy: "4.35" });
      expect(imported(key).frame_template, key).toBe("lotrscroll");
      expect(requestRow(key), key).toMatchObject({ signature: "showcase/ltr/scroll", cause: "missing", template: "lotrscroll" });
    }
    // The saga lands on the saga frame (ltr-602's landing).
    expect(frameMatchFromScryfall(P["ltc-465"])).toMatchObject({ signature: "showcase/ltr/scroll", template: "lotrscroll", landOn: "saga" });
  });

  it("the neighbours outside the run keep their rules", () => {
    expect(frameMatchFromScryfall(P["ltc-410"]).signature).toBe("ub/2015");
    expect(frameMatchFromScryfall(P["ltc-491"]).signature).toBe("borderless/standard");
  });
});

describe("MUL's Theros demigods are the constellation showcase", () => {
  const NYX_VERIFIED = new Set([...PROD, ...FRAME_COLOR_KEYS.map((c) => frameComboKey("nyx", c))]);
  const THEROS = ["mul-2", "mul-18", "mul-28", "mul-158", "mul-132z"] as const;

  it("resolves `showcase/thb/constellation`, exact on nyx, crown on", () => {
    for (const key of THEROS) {
      expect(frameMatchFromScryfall(P[key]), key).toMatchObject({
        signature: "showcase/thb/constellation",
        status: "exact",
        template: "nyx",
        exactLabel: "Multiverse Legends Theros showcase (constellation)",
      });
      expect(imported(key).printed_crown, key).toBe(true);
    }
  });

  it("is `not yet verified` while nyx isn't ticked, exact once it is", () => {
    for (const key of THEROS) {
      expect(PROD.has(frameComboKey("nyx", "w"))).toBe(false);
      expect(requestRow(key), key).toMatchObject({ signature: "showcase/thb/constellation", cause: "unverified" });
      expect(imported(key, NYX_VERIFIED).frame_match, key).toMatchObject({ status: "exact", template: "nyx" });
      expect(requestRow(key, NYX_VERIFIED), key).toBeNull();
    }
  });

  it("the etched twins, the two-colour Theros legends and the Tarkir pins stay where they were", () => {
    expect(frameMatchFromScryfall(P["mul-67"]).signature).toBe("showcase/mul");
    expect(frameMatchFromScryfall(P["mul-32"]).signature).toBe("showcase/mul");
    expect(frameMatchFromScryfall(P["mul-1"]).signature).toBe("showcase/mul/tarkir");
  });
});

describe("MP2 Invocations are unchanged", () => {
  it("still unsupported (TODO 4.11 notes the Invocation build)", () => {
    expect(frameMatchFromScryfall(P["mp2-1"])).toMatchObject({ signature: "borderless/unsupported-set", status: "unsupported" });
  });
});
