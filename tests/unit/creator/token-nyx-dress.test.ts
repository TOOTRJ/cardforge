import { describe, expect, it } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { isM20NyxTokenTemplate, m20TokenTemplate, m20TokenTwinWithoutNyx } from "@/lib/cards/token-height";
import {
  CARD_KIND_VALUES,
  enchantmentFrameFits,
  enchantmentFrameFor,
  isEnchantmentDress,
  templateRefusesKind,
  tokenFrameFor,
  tokenHeightFrameFor,
  typeWordFrameFor,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { followTokenHeight, newTokenFrame } from "@/lib/creator/token-frame-auto";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.51: the full-art token's Nyx dress — six STORED templates (the
// starfield in the name pill, scripts/build-token-nyx.mjs), an Enchantment
// token's, in the Nyx pattern (ENCHANTMENT_DRESSES): the kind gate, the
// follow, the random and requested picks; the height and the Artifact word
// move between the dresses as they move the plain templates. An ADDITION:
// no stored card is moved, no bump, no sweep.
// ---------------------------------------------------------------------------

const NYX: FrameTemplate[] = ["m20tokennyx", "m20tokennyxtext", "m20tokennyxtall", "m20tokenartifactnyx", "m20tokenartifactnyxtext", "m20tokenartifactnyxtall"];
const verified = (templates: FrameTemplate[], colour: string) => new Set(templates.map((t) => frameComboKey(t, colour)));
const ALL_M20: FrameTemplate[] = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];

const glimmer = { cardType: "token", supertype: "Enchantment Creature" } as const;
const soldier = { cardType: "token", supertype: "Creature" } as const;
const golem = { cardType: "token", supertype: "Enchantment Artifact Creature" } as const;

describe("the Nyx dress of the full-art tokens", () => {
  it("is six templates, the token kind's alone, each an enchantment dress", () => {
    expect(FRAME_TEMPLATE_VALUES.filter(isM20NyxTokenTemplate)).toEqual(NYX);
    for (const t of NYX) {
      expect(isEnchantmentDress(t), t).toBe(true);
      for (const kind of CARD_KIND_VALUES) expect(templateRefusesKind(t, kind), `${t} ${kind}`).toBe(kind !== "token");
      expect(m20TokenTwinWithoutNyx(t)).toBe(t.replace("nyx", ""));
    }
  });

  it("dresses a token whose words say Enchantment — the server's gate refuses any other", () => {
    for (const t of NYX) {
      expect(enchantmentFrameFits(t, glimmer), t).toBe(true);
      expect(enchantmentFrameFits(t, soldier), t).toBe(false);
      expect(frameKindGateError(t, { cardType: "token", supertype: "Enchantment Creature", title: "Glimmer", subtypes: ["Glimmer"] } as never), t).toBeNull();
      expect(frameKindGateError(t, { cardType: "token", supertype: "Creature", title: "Soldier", subtypes: ["Soldier"] } as never), t).toMatch(/is for enchantments/);
    }
  });

  it("the words move a token between each full-art template and its dress, both ways, and never the arch", () => {
    for (const plain of ALL_M20) {
      const dress = `${plain.replace("artifact", "artifactnyx").replace(/^m20token(?!artifact)/, "m20tokennyx")}` as FrameTemplate;
      expect(NYX, plain).toContain(dress);
      expect(enchantmentFrameFor("token", plain, glimmer), plain).toBe(dress);
      expect(enchantmentFrameFor("token", dress, soldier), dress).toBe(plain);
      expect(enchantmentFrameFor("token", plain, soldier), plain).toBe(plain);
      expect(enchantmentFrameFor("token", dress, glimmer), dress).toBe(dress);
    }
    // The 2014–19 arch has no Nyx dress (TC15 #23 alone prints one).
    for (const arch of ["m15token", "m15tokentext", "m15tokenartifact", "m15tokenartifacttext"] as FrameTemplate[]) {
      expect(enchantmentFrameFor("token", arch, glimmer), arch).toBe(arch);
    }
    // …and a creature on m15 is the m15nyx dress, as before.
    expect(enchantmentFrameFor("creature", "m15", { cardType: "creature", supertype: "Enchantment" })).toBe("m15nyx");
  });

  it("keeps the dress when the height or the Artifact word moves the template", () => {
    // The height (tokenHeightFrameFor): the text grows, the dress stays.
    const long = { ...glimmer, rulesText: "Flying\nWhenever this token attacks, draw a card.", printsPowerToughness: true };
    expect(tokenHeightFrameFor("token", "m20tokennyx", long)).toBe("m20tokennyxtext");
    expect(tokenHeightFrameFor("token", "m20tokennyxtext", { ...glimmer, rulesText: "" })).toBe("m20tokennyx");
    expect(tokenHeightFrameFor("token", "m20tokenartifactnyx", { ...golem, rulesText: "Flying" })).toBe("m20tokenartifactnyxtext");
    // The Artifact word (typeWordFrameFor): the slate pill with the stars.
    expect(typeWordFrameFor("token", "m20tokennyx", golem.supertype)).toBe("m20tokenartifactnyx");
    expect(typeWordFrameFor("token", "m20tokenartifactnyxtext", glimmer.supertype)).toBe("m20tokennyxtext");
    expect(tokenFrameFor("token", "m20tokennyx", { ...golem, rulesText: "Flying" })).toBe("m20tokenartifactnyxtext");
    // followTokenHeight keeps the dress, and never lands unverified.
    const previous = { supertype: glimmer.supertype, rulesText: "", flavorText: "", printsPowerToughness: true };
    const grown = { ...previous, rulesText: "Flying" };
    expect(followTokenHeight({ ...grown, template: "m20tokennyx", previous, heightPinned: false })).toBe("m20tokennyxtext");
    expect(followTokenHeight({ ...grown, template: "m20tokennyx", previous, heightPinned: false, colorKey: "w", verifiedKeys: verified(["m20tokentext"], "w") })).toBe("m20tokennyx");
  });

  it("a NEW Enchantment token starts on the dress where it is verified in the colour, else the plain design", () => {
    const text = { supertype: glimmer.supertype, rulesText: "", flavorText: "", printsPowerToughness: true };
    expect(newTokenFrame(text, "w", verified([...ALL_M20, ...NYX], "w"))).toBe("m20tokennyx");
    expect(newTokenFrame(text, "w", verified(ALL_M20, "w"))).toBe("m20token");
    expect(newTokenFrame({ ...text, supertype: "Creature" }, "w", verified([...ALL_M20, ...NYX], "w"))).toBe("m20token");
    expect(newTokenFrame({ ...text, supertype: golem.supertype }, "c", verified([...ALL_M20, ...NYX], "c"))).toBe("m20tokenartifactnyx");
  });

  it("an AI token follows onto the dress where a frame is asked for and it is published; never a token without the word", () => {
    const keys = new Set([...verified([...ALL_M20, ...NYX], "w"), ...verified(ALL_M20, "b")]);
    const face = (supertype: string) => ({ cardType: "token", supertype, subtypes: ["Glimmer"], rulesText: "", flavorText: "", power: "1", toughness: "1", title: "Glimmer" });
    expect(resolveGeneratedFrame({ cardType: "token", requested: "m20token", colorIdentity: ["white"], verifiedKeys: keys, face: face("Enchantment Creature") as never })).toBe("m20tokennyx");
    expect(resolveGeneratedFrame({ cardType: "token", requested: "m20token", colorIdentity: ["white"], verifiedKeys: keys, face: face("Creature") as never })).toBe("m20token");
    // A frame asked for by name keeps the height the TEXT asks for on the
    // dress, as on the plain design: never the textless dress for a token
    // with text (it fell to a random frame), nor the tall box for a line.
    const withText = (supertype: string, rulesText: string) => ({ ...face(supertype), rulesText }) as never;
    for (const requested of ["m20token", "m20tokentext", "m20tokentall", "m20tokennyx", "m20tokennyxtall"] as const) {
      expect(resolveGeneratedFrame({ cardType: "token", requested, colorIdentity: ["white"], verifiedKeys: keys, face: withText("Enchantment Creature", "Flying"), fallback: "none" }), requested).toBe("m20tokennyxtext");
      expect(resolveGeneratedFrame({ cardType: "token", requested, colorIdentity: ["white"], verifiedKeys: keys, face: withText("Enchantment Creature", ""), fallback: "none" }), requested).toBe("m20tokennyx");
      expect(resolveGeneratedFrame({ cardType: "token", requested, colorIdentity: ["white"], verifiedKeys: keys, face: withText("Creature", "Flying"), fallback: "none" }), requested).toBe("m20tokentext");
    }
    // Unpublished in black: the plain design, never a frame it can't wear.
    expect(resolveGeneratedFrame({ cardType: "token", requested: "m20token", colorIdentity: ["black"], verifiedKeys: keys, face: face("Enchantment Creature") as never })).toBe("m20token");
    // A random pick never draws the dress for a token without the word.
    for (let i = 0; i < 40; i++) {
      const picked = resolveGeneratedFrame({ cardType: "token", requested: "random", colorIdentity: ["white"], verifiedKeys: keys, face: face("Creature") as never, random: () => i / 40 });
      expect(isM20NyxTokenTemplate(picked), String(picked)).toBe(false);
    }
    // …and for one with it, never the plain design while the dress is published.
    for (let i = 0; i < 40; i++) {
      const picked = resolveGeneratedFrame({ cardType: "token", requested: "random", colorIdentity: ["white"], verifiedKeys: keys, face: face("Enchantment Creature") as never, random: () => i / 40 });
      expect(ALL_M20, String(picked)).not.toContain(picked);
    }
  });

  it("m20TokenTemplate names the dress at each height", () => {
    expect(m20TokenTemplate("textless", false, true)).toBe("m20tokennyx");
    expect(m20TokenTemplate("regular", true, true)).toBe("m20tokenartifactnyxtext");
    expect(m20TokenTemplate("tall", false)).toBe("m20tokentall");
  });
});
