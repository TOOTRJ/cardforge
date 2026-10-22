import { describe, expect, it } from "vitest";
import printings from "./fixtures/nickname-printings.json";
import plain from "./fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";
import { oracleSelfNamesAsTokens, withSelfNames } from "@/lib/cards/self-name";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 6.2 (owner Round 80): an imported FLAVOUR-NAME printing writes the
// card's own name as `~` in its rules text, so the rules draw the nickname
// as the printing sets them (MSC #283 "Exile The Five Arrive", SLD #1186
// "…counter on Post, Son of Rich"). A plain import keeps Oracle's name.
// The fixtures: Scryfall's own JSON (captured 2026-10-21).
// ---------------------------------------------------------------------------

const patchOf = (key: keyof typeof printings) => mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));

describe("a flavour-name printing's rules on import", () => {
  it("MSC #283: the name becomes ~, drawn as the nickname", () => {
    const patch = patchOf("msc-283");
    expect(patch.nickname).toBe("The Five Arrive");
    expect(patch.rules_text).toContain("Exile ~.");
    expect(patch.rules_text).not.toContain("Genesis Ultimatum");
    const drawn = withSelfNames(previewFromImportPatch(patch, patch.title!, "m15"), getFrameProfile("m15"));
    expect(drawn.rulesText).toContain("Exile The Five Arrive.");
  });

  it("SLD #1186: a legendary name's short form too", () => {
    const patch = patchOf("sld-1186");
    expect(patch.rules_text).toContain("put a +1/+1 counter on ~.");
    const drawn = withSelfNames(previewFromImportPatch(patch, patch.title!, "m15"), getFrameProfile("m15"));
    expect(drawn.rulesText).toContain("put a +1/+1 counter on Post, Son of Rich.");
  });

  it("the other six: no name in the Oracle text — the rules as Oracle writes them", () => {
    for (const key of ["msc-282", "msc-288", "sld-697", "tmc-54", "iko-275", "vow-338"] as const) {
      const card = scryfallCardSchema.parse(printings[key]);
      const oracle = card.card_faces && card.card_faces.length > 1 ? card.card_faces[0]!.oracle_text : card.oracle_text;
      expect(patchOf(key).rules_text, key).toBe(oracle ?? undefined);
    }
  });

  it("a plain import keeps Oracle's name, as today", () => {
    // The same card without its flavour name (Genesis Ultimatum's own
    // printing): its rules name it, as Oracle does.
    const { flavor_name: _dropped, ...rest } = printings["msc-283"] as Record<string, unknown>;
    void _dropped;
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(rest));
    expect(patch).not.toHaveProperty("nickname");
    expect(patch.rules_text).toContain("Exile Genesis Ultimatum.");
    for (const raw of Object.values(plain)) {
      const card = scryfallCardSchema.parse(raw);
      expect(mapScryfallToFormPatch(card).rules_text ?? "", card.name).not.toContain("~");
    }
  });
});

describe("oracleSelfNamesAsTokens", () => {
  it("replaces the name as a whole word only", () => {
    expect(oracleSelfNamesAsTokens("Exile Genesis Ultimatum.", "Genesis Ultimatum")).toBe("Exile ~.");
    expect(oracleSelfNamesAsTokens("Genesis Ultimatums are rare.", "Genesis Ultimatum")).toBe("Genesis Ultimatums are rare.");
    expect(oracleSelfNamesAsTokens("When K'rrik, Son of Yawgmoth enters, K'rrik deals 1.", "K'rrik, Son of Yawgmoth")).toBe("When ~ enters, ~ deals 1.");
    expect(oracleSelfNamesAsTokens(undefined, "X")).toBeUndefined();
    expect(oracleSelfNamesAsTokens("Fly.", "")).toBe("Fly.");
  });
});
