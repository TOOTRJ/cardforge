import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/crown-reference-printings.json";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { CROWN_REFERENCES, crownReferenceFor, type CrownReference } from "@/lib/cards/crown";
import { dfcBodyOf, dfcIconFamilyFromEffects, faceUnderTest, transformBackBodyFor } from "@/lib/cards/dfc";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { parseTypeLine } from "@/lib/scryfall/import-mapper";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The crowned prints of the double-faced bodies (lib/cards/crown.ts
// CROWN_REFERENCES, TODO 5.1d) against the printings themselves — the check
// the frame registry's references have always had (frame-reference-
// signatures.test.ts) and this table never did.
//
// TODO 5.0d found why it matters: the 5.1d survey classified a transform
// back by `frame_effects.find(/dfc$/)`, so BOT's `convertdfc` — the plain
// ▲ / ▼ family, the ▼ at the RIGHT — read as a left-well family, and BOT #6
// Slicer and BOT #12 Megatron were listed as the crowned red and gold prints
// of the 2016–22 (left-well) back. The compare page's Legendary toggle on
// those two rows then drew the left-well body beside a ▼-right scan. No red,
// green, three-colour or colourless non-land legendary back was printed
// crowned in a left-well family (Scryfall, 2026-10-06), so those rows have
// none.
//
// Each row is held to what the compare page does with it: the key the page
// asks with (the FRAME colour key — 5.1d filed the two artifact prints under
// `a`, the crown's own key, where the toggle on the `c` rows never found
// them), the face it compares (a back body's is the printing's back), a
// crowned print (the `legendary` frame effect on a Legendary face), the
// colour its key names, and the PIN CHECK of its own row
// (validateReferenceForCombo — for a transform back that is the icon family:
// the body the printing's `frame_effects` and its back's type derive; for a
// `c` row on these bodies an Artifact face, the artifact master standing
// in). The printings are captured (fixtures/crown-reference-printings.json,
// Scryfall 2026-10-06); no network.
// ---------------------------------------------------------------------------

type Face = { name?: string; type_line?: string; colors?: string[] };
type Printing = { set: string; collector_number: string; layout: string; frame_effects?: string[]; card_faces?: Face[] };
const printings = printingsData as unknown as Record<string, Printing>;

type Row = { combo: string; template: FrameTemplate; key: string; ref: CrownReference };
const rows: Row[] = Object.entries(CROWN_REFERENCES)
  .filter(([template]) => dfcBodyOf(template))
  .flatMap(([template, refs]) =>
    Object.entries(refs ?? {}).map(([key, ref]) => ({
      combo: `${template}/${key}`,
      template: template as FrameTemplate,
      key,
      ref: ref!,
    })),
  );

const PAIR_KEY = /^[wubrg]{2}$/;
/** The rows are keyed by the FRAME colour key the compare page's toggle asks
 *  with (w u b r g c m), plus the pairs the print sheets use. */
const ROW_KEY = /^(?:[wubrgcm]|[wubrg]{2})$/;
/** The registry row a key is judged on: a pair is drawn gold on the compare
 *  page (the body's `m` row). */
const pinColour = (key: string) => (PAIR_KEY.test(key) ? "m" : key);

/** The row key a printed face's own colours name — the test's reading of
 *  the print, not the code's. */
function printedKey(face: Face, rowKey: string): string {
  const colours = (face.colors ?? []).map((c) => c.toLowerCase());
  if (colours.length === 0) return "c";
  if (colours.length === 1) return colours[0];
  if (colours.length > 2) return "m";
  // Two colours: the row's key spells the pair in the crown's own order.
  return PAIR_KEY.test(rowKey) && [...rowKey].sort().join("") === [...colours].sort().join("") ? rowKey : colours.join("");
}

describe("the double-faced crown references vs their printings (TODO 5.1d / 5.0d)", () => {
  it("covers every double-faced body that draws a crown, with a captured printing per row", () => {
    expect([...new Set(rows.map((row) => row.template))].sort()).toEqual(
      ["m15dfcback", "m15dfcbackleft", "m15dfcfront", "m15dfclandfront", "m15mdfcback", "m15mdfcfront"],
    );
    for (const row of rows) {
      expect(frameAnatomyOf(row.template).crown, row.combo).toBe(true);
      expect(printings[row.ref.scryfallId], row.combo).toBeDefined();
    }
    expect(rows.length).toBe(49);
  });

  it.each(rows)("$combo $ref.name ($ref.set #$ref.collectorNumber) is a crowned print of its own row", (row) => {
    const printing = printings[row.ref.scryfallId];
    expect(`${printing.set} #${printing.collector_number}`).toBe(`${row.ref.set} #${row.ref.collectorNumber}`);

    // The face the compare page shows for this body, by name.
    const index = faceUnderTest(row.template) === "back" ? 1 : 0;
    const face = printing.card_faces?.[index];
    expect(face?.name, row.combo).toBe(row.ref.name);

    // A crowned print: the frame effect, on a Legendary face.
    expect(printing.frame_effects ?? [], row.combo).toContain("legendary");
    expect(face?.type_line, row.combo).toMatch(/^Legendary\b/);

    // The row is keyed as the page asks for it, and by the face's own colour.
    expect(row.key, row.combo).toMatch(ROW_KEY);
    expect(crownReferenceFor(row.template, row.key), row.combo).toBe(row.ref);
    expect(printedKey(face!, row.key), row.combo).toBe(row.key);

    // …and the printing passes the pin check of the row the toggle sits on.
    const card = scryfallCardSchema.parse(printing);
    expect(validateReferenceForCombo(card, row.template, pinColour(row.key)).errors, row.combo).toEqual([]);

    // A transform back wears the body its icon family and type derive.
    const body = dfcBodyOf(row.template)!;
    if (body.layout === "transform" && body.role === "back") {
      const backType = parseTypeLine(printing.card_faces?.[1]?.type_line).card_type;
      expect(transformBackBodyFor(dfcIconFamilyFromEffects(printing.frame_effects), backType), row.combo).toBe(row.template);
    }
  });

  it("the 2016–22 back has crowned prints in w, u, b and two pairs — every one a sun / moon printing; no r, g, m or a", () => {
    expect(Object.keys(CROWN_REFERENCES.m15dfcbackleft ?? {}).sort()).toEqual(["b", "rg", "u", "ub", "w"]);
    for (const ref of Object.values(CROWN_REFERENCES.m15dfcbackleft ?? {})) {
      expect(dfcIconFamilyFromEffects(printings[ref!.scryfallId].frame_effects), ref!.name).toBe("sunmoon");
    }
    for (const key of ["r", "g", "m", "c"] as const) expect(crownReferenceFor("m15dfcbackleft", key), key).toBeNull();
    // The colourless rows of the transform front and the ▼ back are their
    // crowned ARTIFACT prints, under the key the page asks with.
    expect(crownReferenceFor("m15dfcfront", "c")).toMatchObject({ set: "lci", collectorNumber: "256" });
    expect(crownReferenceFor("m15dfcback", "c")).toMatchObject({ set: "fin", collectorNumber: "272" });
    for (const template of ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15mdfcfront", "m15mdfcback"] as const) {
      expect(crownReferenceFor(template, "a"), template).toBeNull();
    }
    // The ▼ back keeps its own red and gold prints (never BOT's vehicle backs).
    expect(crownReferenceFor("m15dfcback", "r")).toMatchObject({ set: "ecl", collectorNumber: "105" });
    expect(crownReferenceFor("m15dfcback", "m")).toMatchObject({ set: "fin", collectorNumber: "231" });
    for (const ref of Object.values(CROWN_REFERENCES.m15dfcback ?? {})) {
      expect(dfcIconFamilyFromEffects(printings[ref!.scryfallId].frame_effects), ref!.name).toBe("arrows");
    }
    // No printing stands for both back bodies.
    const left = new Set(Object.values(CROWN_REFERENCES.m15dfcbackleft ?? {}).map((ref) => ref!.scryfallId));
    const right = Object.values(CROWN_REFERENCES.m15dfcback ?? {}).map((ref) => ref!.scryfallId);
    expect(right.filter((id) => left.has(id))).toEqual([]);
  });

  it("BOT's convert backs are the ▼-right body: the pin check refuses BOT #6 and BOT #12 on the 2016–22 back", () => {
    const CASES = [
      { id: "9d9a9350-4734-4cc1-986d-467e6715199f", print: "bot #6", back: "Slicer, High-Speed Antagonist", row: "r" },
      { id: "ac6ded62-7bf2-476f-ad8e-020da6327c6b", print: "bot #12", back: "Megatron, Destructive Force", row: "m" },
    ];
    for (const { id, print, back, row } of CASES) {
      const printing = printings[id];
      expect(`${printing.set} #${printing.collector_number}`).toBe(print);
      expect(printing.card_faces?.[1]?.name).toBe(back);
      // `convertdfc` names no left-well family: the plain ▲ / ▼.
      expect(printing.frame_effects).toEqual(expect.arrayContaining(["convertdfc", "legendary"]));
      expect(dfcIconFamilyFromEffects(printing.frame_effects)).toBe("arrows");
      const backType = parseTypeLine(printing.card_faces?.[1]?.type_line).card_type;
      expect(transformBackBodyFor("arrows", backType)).toBe("m15dfcback");
      const card = scryfallCardSchema.parse(printing);
      const refused = validateReferenceForCombo(card, "m15dfcbackleft", row).errors;
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatch(/back wears the .* body \(its icon family and the back's type\), not /);
      // The table names it nowhere on that body.
      const listed = Object.values(CROWN_REFERENCES.m15dfcbackleft ?? {}).map((ref) => ref!.scryfallId);
      expect(listed).not.toContain(id);
    }
  });
});
