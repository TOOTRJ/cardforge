import { describe, expect, it } from "vitest";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, undrawableSymbolsNotice } from "@/lib/scryfall/import-mapper";
import { undrawableSymbols } from "@/lib/validation/card-glyphs";
import printings from "./fixtures/signature-printings.json";

// ---------------------------------------------------------------------------
// An import keeps the printing's cost and text as printed. A printing with a
// symbol the card can't draw lost that pip without a word; the import says
// so (the creator's toast and the import dialog's note), from the creator's
// own check. The first such printing was Ajani, Sleeper Agent — its hybrid
// Phyrexian {G/W/P} draws since layout v49, so it is named no more.
// Fixtures: real Scryfall printings, trimmed (signature-printings.json).
// ---------------------------------------------------------------------------

const patchOf = (key: keyof typeof printings) => mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));

describe("undrawableSymbolsNotice", () => {
  it("Ajani, Sleeper Agent (DMU #375): the cost and the text come in as printed, and its {G/W/P} draws — no notice", () => {
    const patch = patchOf("dmu-375");
    expect(patch.cost).toBe("{1}{G}{G/W/P}{W}");
    expect(patch.rules_text).toContain("{G/W/P}");
    expect(undrawableSymbols(patch.cost)).toEqual([]);
    expect(undrawableSymbols(patch.rules_text)).toEqual([]);
    expect(undrawableSymbolsNotice(patch, "Ajani, Sleeper Agent")).toBeNull();
  });

  it("an ordinary Phyrexian printing (Porcelain Legionnaire, NPH #19) says nothing", () => {
    const patch = patchOf("nph-19");
    expect(patch.cost).toBe("{2}{W/P}");
    expect(undrawableSymbolsNotice(patch, "Porcelain Legionnaire")).toBeNull();
  });

  it("no printing of the fixture set is named", () => {
    const named = (Object.keys(printings) as Array<keyof typeof printings>).filter((key) => {
      const raw = printings[key] as { name?: string };
      return typeof raw === "object" && raw?.name ? undrawableSymbolsNotice(patchOf(key), raw.name) != null : false;
    });
    expect(named).toEqual([]);
  });

  it("reads the second face too, names each symbol once, and counts them", () => {
    expect(
      undrawableSymbolsNotice(
        {
          cost: "{2}{G/U/P}{21}{U}",
          rules_text: "({G/U/P} can be paid with {G}, {U}, or 2 life.) Pay {21}.",
          back_face: { cost: "{1/2}", rules_text: "{T}: Add {G}." },
        },
        "Probe // Back",
      ),
    ).toBe("Probe // Back uses {21} and {1/2}, which PipGlyph can't draw yet — they will be left off the card.");
    expect(undrawableSymbolsNotice({ cost: "{100}{C/P}" }, "Probe")).toBe("Probe uses {C/P}, which PipGlyph can't draw yet — it will be left off the card.");
    expect(undrawableSymbolsNotice({ cost: "{2}{U}", rules_text: "{T}: Draw a card." }, "Probe")).toBeNull();
    expect(undrawableSymbolsNotice({}, "Probe")).toBeNull();
  });
});
