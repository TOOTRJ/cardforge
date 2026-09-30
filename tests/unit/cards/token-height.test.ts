import { describe, expect, it } from "vitest";
import heights from "./fixtures/m20-token-heights.json";
import {
  M20_TOKEN_HEIGHTS,
  M20_TOKEN_REGULAR_MIN_PX,
  M20_TOKEN_TEMPLATES,
  isM20ArtifactTokenTemplate,
  isM20TokenTemplate,
  m20TokenHeightOf,
  m20TokenTemplate,
  tokenHeightForText,
  tokenTextFitPx,
  tokenTextFitsAtStandardSize,
  tokenTextFitsRegularBox,
} from "@/lib/cards/token-height";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48 (owner decisions 2026-09-29): the full-art token's printed height
// follows its text — no text → no box; fits the regular box at 72 px or more
// → the regular box; otherwise the tall box. The fixture is 76 M20+ prints
// whose height was MEASURED on their Scryfall PNGs (the type pill's position
// against CC's three masters, 2026-09-29), with their Oracle text, flavour
// and P/T: 63 references and the height study's regular-box prints set at
// 8.5 pt and below (TTDC #12 Dragon Egg …). Six of those WotC sets below the
// 72 px floor (62–70 px) — the rule sends them tall (`ruleSays`), listed.
// ---------------------------------------------------------------------------

type Printing = {
  set: string;
  collector_number: string;
  name: string;
  type_line: string;
  printed: "textless" | "regular" | "tall";
  /** A print WotC set below the rule's floor: what the rule says instead. */
  ruleSays?: "tall";
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
};
const PRINTS = Object.entries(heights as Record<string, Printing>);

describe("the full-art token templates by height", () => {
  it("names six templates, three heights × plain / artifact, all real frame templates", () => {
    expect(M20_TOKEN_HEIGHTS).toEqual(["textless", "regular", "tall"]);
    const all = M20_TOKEN_HEIGHTS.flatMap((h) => [M20_TOKEN_TEMPLATES[h].plain, M20_TOKEN_TEMPLATES[h].artifact]);
    expect(all).toEqual(["m20token", "m20tokenartifact", "m20tokentext", "m20tokenartifacttext", "m20tokentall", "m20tokenartifacttall"]);
    for (const t of all) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[]).toContain(t);
      expect(isM20TokenTemplate(t), t).toBe(true);
      expect(m20TokenTemplate(m20TokenHeightOf(t)!, isM20ArtifactTokenTemplate(t)), t).toBe(t);
    }
    for (const t of ["m15token", "m15tokentext", "m15", null, undefined, "nope"]) {
      expect(isM20TokenTemplate(t), String(t)).toBe(false);
      expect(m20TokenHeightOf(t), String(t)).toBeNull();
    }
  });

  it("only the textless height is textless (it keeps its type line)", () => {
    for (const h of M20_TOKEN_HEIGHTS) {
      for (const t of [M20_TOKEN_TEMPLATES[h].plain, M20_TOKEN_TEMPLATES[h].artifact]) {
        const p = getFrameProfile(t);
        expect(Boolean(p.textless), t).toBe(h === "textless");
        expect(Boolean(p.textlessTypeLine), t).toBe(h === "textless");
      }
    }
  });
});

describe("tokenHeightForText (TODO 4.48's rule)", () => {
  it("no rules and no flavour → no box, whatever the P/T", () => {
    expect(tokenHeightForText({ rulesText: null, printsPowerToughness: true })).toBe("textless");
    expect(tokenHeightForText({ rulesText: "  ", flavorText: "", printsPowerToughness: false })).toBe("textless");
  });

  it("a short text → the regular box; flavour alone counts as text", () => {
    expect(tokenHeightForText({ rulesText: "Flying", printsPowerToughness: true })).toBe("regular");
    expect(tokenHeightForText({ rulesText: null, flavorText: "It sees you.", printsPowerToughness: true })).toBe("regular");
    expect(
      tokenHeightForText({ rulesText: "{T}, Sacrifice this token: Add one mana of any color.", printsPowerToughness: false, artifact: true }),
    ).toBe("regular");
  });

  it("a text the regular box holds only below 72 px → the tall box", () => {
    const long =
      "Whenever you attack, choose one —\n• Create a 1/1 white Rabbit creature token that's tapped and attacking.\n• Attacking creatures you control get +1/+1 until end of turn.";
    expect(tokenTextFitPx("regular", { rulesText: long, printsPowerToughness: true })).toBeLessThan(M20_TOKEN_REGULAR_MIN_PX);
    expect(tokenTextFitsRegularBox({ rulesText: long, printsPowerToughness: true })).toBe(false);
    expect(tokenTextFitsAtStandardSize("tall", { rulesText: long, printsPowerToughness: true })).toBe(true);
    expect(tokenHeightForText({ rulesText: long, printsPowerToughness: true })).toBe("tall");
  });

  it("the regular box holds a text down to 72 px (8.5 pt), as WotC sets it: TTDC #12 Dragon Egg (owner decision 2026-09-29)", () => {
    expect(M20_TOKEN_REGULAR_MIN_PX).toBe(72);
    const egg = {
      rulesText:
        'Defender\nWhen this creature dies, create a 2/2 red Dragon creature token with flying and "{R}: This creature gets +1/+0 until end of turn."',
      printsPowerToughness: true,
    };
    // The standard 76 px doesn't hold it (the rule's old test sent it tall)…
    expect(tokenTextFitsAtStandardSize("regular", egg)).toBe(false);
    // …72 px does, and the print wears the regular box.
    expect(tokenTextFitPx("regular", egg)).toBe(72);
    expect(tokenHeightForText(egg)).toBe("regular");
  });

  it("keeps the rules out of the P/T plate: a text that fits beside no plate can need the tall box beside one", () => {
    // Its last line runs into the box's bottom-right corner: the plate
    // costs it three sizes, past the floor.
    const text =
      "Whenever this creature attacks, you may pay {1}. If you do, create a 1/1 white Soldier creature token with lifelink that's tapped and attacking.";
    expect(tokenTextFitPx("regular", { rulesText: text, printsPowerToughness: false })).toBe(76);
    expect(tokenTextFitPx("regular", { rulesText: text, printsPowerToughness: true })).toBeLessThan(M20_TOKEN_REGULAR_MIN_PX);
    expect(tokenHeightForText({ rulesText: text, printsPowerToughness: false })).toBe("regular");
    expect(tokenHeightForText({ rulesText: text, printsPowerToughness: true })).toBe("tall");
  });

  it.each(PRINTS)("%s prints the height the rule picks (or is a listed print set below its floor)", (_key, p) => {
    const artifact = p.type_line.includes("Artifact");
    const text = {
      rulesText: p.oracle_text,
      flavorText: p.flavor_text,
      printsPowerToughness: Boolean(p.power || p.toughness),
      artifact,
    };
    expect(tokenHeightForText(text)).toBe(p.ruleSays ?? p.printed);
    if (p.ruleSays) {
      // WotC set it in the regular box below 8.5 pt: it fits there at
      // 62–70 px, never at the floor.
      expect(p.printed).toBe("regular");
      const fit = tokenTextFitPx("regular", text);
      expect(fit).not.toBeNull();
      expect(fit!).toBeGreaterThanOrEqual(62);
      expect(fit!).toBeLessThan(M20_TOKEN_REGULAR_MIN_PX);
    }
  });

  it("covers all three heights in the fixture; the rule agrees on all but six regular-box prints set below 72 px", () => {
    const counts = { textless: 0, regular: 0, tall: 0 };
    for (const [, p] of PRINTS) counts[p.printed] += 1;
    expect(counts).toEqual({ textless: 28, regular: 32, tall: 16 });
    expect(PRINTS.filter(([, p]) => p.ruleSays).map(([k]) => k).sort()).toEqual([
      "tblb-1",
      "tblc-23",
      "tinr-13",
      "tmid-7",
      "tspm-1",
      "ttsr-5",
    ]);
  });

  it("keeps every tall print tall: they fit the regular box at 70 px at most", () => {
    for (const [key, p] of PRINTS.filter(([, q]) => q.printed === "tall")) {
      const fit = tokenTextFitPx("regular", {
        rulesText: p.oracle_text,
        flavorText: p.flavor_text,
        printsPowerToughness: Boolean(p.power || p.toughness),
        artifact: p.type_line.includes("Artifact"),
      });
      expect(fit === null || fit < M20_TOKEN_REGULAR_MIN_PX, `${key} fits the regular box at ${fit}`).toBe(true);
    }
  });
});
