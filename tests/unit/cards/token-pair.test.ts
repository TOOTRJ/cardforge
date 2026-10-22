import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { cardPageFacesOf, cardPageName } from "@/lib/cards/emblem";
import {
  DFC_BACK_COLOR_SET,
  DFC_FRONT_HAS_NO_BACK,
  DFC_NOT_A_BACK_BODY,
  TOKEN_BACK_TYPE_REFUSED,
  dfcBackArtMissing,
  resolveDfcBackFace,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
import { backBodyError, hasBackOfItsOwn, templateHasBackFace, templateTakesBackBody } from "@/lib/cards/dfc";
import { backBodyOf, backPreviewData, bakedBackOf, exportFacesOf, flippableBackOf, frontPreviewData, rowHasBakedBack } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { isTokenPairBack, isTokenPairFront, tokenDesignOf } from "@/lib/cards/token-faces";
import { templateRefusesKind } from "@/lib/creator/card-kinds";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
import { ownCardRemixFrame, remixCreditsOf } from "@/lib/ai/remix-mechanics";
import { remixSecondHalfLayout } from "@/lib/ai/remix-names";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.5 (c) — double-sided tokens (owner Round 76): two tokens back to
// back. The back is another TOKEN template in the front's design, derived
// from its own words and text exactly as a token's frame is, in its own
// colour; no DFC body, no icon. The ONE gate (resolveDfcBackFace) stores it,
// the faces (lib/cards/faces.ts) draw and bake it, the remix prices it.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const TOKENS = FRAME_TEMPLATE_VALUES.filter((t) => /^m(15|20)token/.test(t));
const EVERY_TOKEN = verified(...TOKENS);

const SOLDIER: DfcBackFacePayload = { title: "Soldier", card_type: "token", supertype: "Creature", subtypes: ["Soldier"], rules_text: "Lifelink", power: "1", toughness: "1", color_identity: ["white"] };
const ZOMBIE: DfcBackFacePayload = { title: "Zombie", card_type: "token", supertype: "Creature", subtypes: ["Zombie"], power: "2", toughness: "2", color_identity: ["black"] };

describe("the vocabulary", () => {
  it("every token template is a pair front of its design; nothing else is", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      const design = /^m15token/.test(t) ? "arch" : /^m20token/.test(t) ? "fullart" : null;
      expect(tokenDesignOf(t), t).toBe(design);
      expect(isTokenPairFront(t), t).toBe(design !== null);
      // …and never a DFC front body: no icon, no cross-face block.
      if (design) expect(templateHasBackFace(t), t).toBe(false);
      expect(templateTakesBackBody(t), t).toBe(templateHasBackFace(t) || design !== null);
    }
    expect(isTokenPairBack("m15token", "m15tokentext")).toBe(true);
    expect(isTokenPairBack("m20tokentext", "m20tokenartifact")).toBe(true);
    // Another design is no pair, nor a DFC back body.
    expect(isTokenPairBack("m15token", "m20token")).toBe(false);
    expect(isTokenPairBack("m15token", "m15dfcback")).toBe(false);
    expect(isTokenPairBack("m15", "m15token")).toBe(false);
  });

  it("the token templates stay the token kind's own: no kind gate change", () => {
    for (const t of TOKENS) expect(templateRefusesKind(t, "token"), t).toBe(false);
  });

  it("the back's body follows its words and text in the front's design", () => {
    expect(tokenBackBodyFor("m15token", { supertype: "Creature", rulesText: "Lifelink", power: "1", toughness: "1" })).toBe("m15tokentext");
    expect(tokenBackBodyFor("m15tokentext", { supertype: "Creature", power: "1", toughness: "1" })).toBe("m15token");
    expect(tokenBackBodyFor("m15token", { supertype: "Artifact", rulesText: "{T}, Sacrifice this artifact: Add one mana of any color." })).toBe("m15tokenartifacttext");
    expect(tokenBackBodyFor("m15tokenartifact", { supertype: "Artifact Creature", power: "1", toughness: "1" })).toBe("m15tokenartifact");
    expect(tokenBackBodyFor("m20token", { supertype: "Creature", power: "1", toughness: "1" })).toBe("m20token");
    expect(tokenBackBodyFor("m20token", { supertype: "Artifact", rulesText: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card." })).toBe("m20tokenartifacttext");
    // A single-colour Enchantment back on the full-art design follows onto
    // the Nyx dress, as a new token does (owner Round 74); gold doesn't.
    expect(tokenBackBodyFor("m20tokentext", { supertype: "Enchantment Creature", power: "2", toughness: "2", colorIdentity: ["white"] })).toBe("m20tokennyx");
    expect(tokenBackBodyFor("m20tokentext", { supertype: "Enchantment Creature", power: "2", toughness: "2", colorIdentity: ["multicolor"] })).toBe("m20token");
    // The arch has no Nyx dress.
    expect(tokenBackBodyFor("m15token", { supertype: "Enchantment Creature", power: "2", toughness: "2", colorIdentity: ["white"] })).toBe("m15token");
    // No token front, no token back.
    expect(tokenBackBodyFor("m15", { supertype: "Creature" })).toBeNull();
  });

  it("a dress or height its words ask for that isn't verified in the back's colour gives way, as a token's front does", () => {
    const ENCHANTED = { supertype: "Enchantment Creature", power: "2", toughness: "2", colorIdentity: ["green"] as ColorIdentity[] };
    // The Nyx dress unverified (production today): the plain full-art design.
    const noNyx = new Set([...EVERY_TOKEN].filter((key) => !key.startsWith("m20tokennyx") && !key.startsWith("m20tokenartifactnyx")));
    expect(tokenBackBodyFor("m20token", ENCHANTED, noNyx)).toBe("m20token");
    expect(tokenBackBodyFor("m20token", ENCHANTED, EVERY_TOKEN)).toBe("m20tokennyx");
    // …and the gate stores what the creator draws: a save, not a refusal.
    const gate = resolveDfcBackFace({
      frontTemplate: "m20token",
      back: { title: "Spirit", card_type: "token", supertype: "Enchantment Creature", power: "2", toughness: "2", color_identity: ["green"], frame_style: { template: "m20token" } },
      family: null,
      frontColorIdentity: ["red"],
      verifiedKeys: noNyx,
    });
    expect(gate.ok && gate.back?.frame_style).toEqual({ template: "m20token" });
    // The arch's tall box (TODO 4.55) unverified: its regular text box.
    const long = "When this creature dies, create a 6/6 blue Whale creature token with \u201cWhen this creature dies, create a 9/9 blue Kraken creature token.\u201d Flying, vigilance, deathtouch, lifelink, haste, trample, menace, reach.";
    const KRAKEN = { supertype: "Creature", rulesText: long, power: "1", toughness: "1", colorIdentity: ["blue"] as ColorIdentity[] };
    const noTall = new Set([...EVERY_TOKEN].filter((key) => !/^m15token(artifact)?tall/.test(key)));
    expect(tokenBackBodyFor("m15token", KRAKEN)).toBe("m15tokentall");
    expect(tokenBackBodyFor("m15token", KRAKEN, noTall)).toBe("m15tokentext");
    expect(tokenBackBodyFor("m15token", KRAKEN, EVERY_TOKEN)).toBe("m15tokentall");
  });
});

describe("the ONE gate (resolveDfcBackFace)", () => {
  const create = (front: string, back: DfcBackFacePayload | null, keys: ReadonlySet<string> = EVERY_TOKEN) =>
    resolveDfcBackFace({ frontTemplate: front, back, family: null, frontColorIdentity: ["red"], verifiedKeys: keys });

  it("a token with no back, or a body-less back, is kept as it came (as on main)", () => {
    expect(create("m15token", null)).toEqual({ ok: true, back: null, layout: null });
    const legacy = { ...ZOMBIE };
    expect(create("m15token", legacy)).toEqual({ ok: true, back: legacy, layout: null });
  });

  it("a back that names a body is stored on the body its words and text derive — whatever was sent — in its colour, with no cost", () => {
    const gate = create("m15token", { ...SOLDIER, cost: "{W}", frame_style: { template: "m15token" } });
    expect(gate).toEqual({
      ok: true,
      layout: null,
      tokenPair: true,
      back: { ...SOLDIER, frame_style: { template: "m15tokentext" }, color_identity: ["white"] },
    });
    // A body of the other design (a remix's front moved onto the arch) is
    // derived again for the front.
    const moved = create("m15token", { ...ZOMBIE, frame_style: { template: "m20token" } });
    expect(moved.ok && moved.back?.frame_style).toEqual({ template: "m15token" });
    // A back with no colour of its own takes the front's.
    const own = create("m15token", { ...ZOMBIE, color_identity: undefined, frame_style: { template: "m15token" } });
    expect(own.ok && own.back?.color_identity).toEqual(["red"]);
  });

  it("refuses a body that is no token template, a back that is no token, and an unverified colour", () => {
    expect(create("m15token", { ...SOLDIER, frame_style: { template: "m15dfcback" } })).toMatchObject({ ok: false, field: "back_face.frame_style", message: DFC_NOT_A_BACK_BODY });
    expect(create("m15token", { ...SOLDIER, card_type: "creature", frame_style: { template: "m15token" } })).toMatchObject({ ok: false, field: "back_face.card_type", message: TOKEN_BACK_TYPE_REFUSED });
    const noWhiteText = new Set([...EVERY_TOKEN].filter((key) => key !== frameComboKey("m15tokentext", "w")));
    expect(create("m15token", { ...SOLDIER, frame_style: { template: "m15token" } }, noWhiteText)).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
    // …which an admin's frame preview skips.
    expect(resolveDfcBackFace({ frontTemplate: "m15token", back: { ...SOLDIER, frame_style: { template: "m15token" } }, family: null, frontColorIdentity: ["red"], verifiedKeys: noWhiteText, skipVerification: true }).ok).toBe(true);
    // A token body under any other front is refused, as every back body.
    expect(create("m15", { ...SOLDIER, frame_style: { template: "m15token" } })).toMatchObject({ ok: false, message: DFC_FRONT_HAS_NO_BACK });
    expect(backBodyError("m15", { frame_style: { template: "m15token" } })).not.toBeNull();
    expect(backBodyError("m15token", { frame_style: { template: "m15tokentext" } })).toBeNull();
    expect(backBodyError("m15token", { frame_style: { template: "m15dfcback" } })).not.toBeNull();
  });

  it("on an edit the STORED body and colour win (structure, like the front's template)", () => {
    const stored = { ...SOLDIER, frame_style: { template: "m15tokentext" }, color_identity: ["white"] as ColorIdentity[] };
    const edit = (back: DfcBackFacePayload, keys: ReadonlySet<string> = EVERY_TOKEN) =>
      resolveDfcBackFace({ frontTemplate: "m15token", back, family: null, frontColorIdentity: ["red"], verifiedKeys: keys, stored: { back: stored, familyChanged: false } });
    // The text cleared: the stored text-box arch stays (the front's frame is locked on an edit too).
    const cleared = edit({ ...stored, rules_text: null });
    expect(cleared.ok && cleared.back?.frame_style).toEqual({ template: "m15tokentext" });
    expect(edit({ ...stored, color_identity: ["green"] })).toMatchObject({ ok: false, field: "back_face.color_identity", message: DFC_BACK_COLOR_SET });
    // A withdrawn tick doesn't lock an unchanged back.
    const withdrawn = new Set([...EVERY_TOKEN].filter((key) => key !== frameComboKey("m15tokentext", "w")));
    expect(edit({ ...stored, title: "Soldier Ally" }, withdrawn).ok).toBe(true);
  });

  it("a public save needs the back's picture too", () => {
    expect(dfcBackArtMissing("m15token", { ...SOLDIER, frame_style: { template: "m15tokentext" } })).toBe(true);
    expect(dfcBackArtMissing("m15token", { ...SOLDIER, art_url: "https://x/a.png", frame_style: { template: "m15tokentext" } })).toBe(false);
    // A body-less back keeps today's rule.
    expect(dfcBackArtMissing("m15token", SOLDIER)).toBe(false);
  });
});

describe("the faces", () => {
  const card = (back: Record<string, unknown> | null): CardPreviewData =>
    ({
      title: "Goblin",
      cardType: "token",
      supertype: "Creature",
      subtypes: ["Goblin"],
      power: "1",
      toughness: "1",
      colorIdentity: ["red"],
      frameStyle: { template: "m15token", crown: true },
      backFace: back,
      artUrl: "https://x/front.png",
    }) as unknown as CardPreviewData;

  it("a back with a token body is a face of its own: its template and colour, no DFC block, baked and offered", () => {
    const pair = card({ ...SOLDIER, frame_style: { template: "m15tokentext" } });
    expect(backBodyOf(pair)).toEqual({ template: "m15tokentext", colorIdentity: ["white"] });
    const back = backPreviewData(pair)!;
    expect(back.frameStyle?.template).toBe("m15tokentext");
    expect(back.colorIdentity).toEqual(["white"]);
    expect([back.title, back.cardType, back.supertype, back.rulesText]).toEqual(["Soldier", "token", "Creature", "Lifelink"]);
    expect(back.dfc ?? null).toBeNull();
    expect(frontPreviewData(pair)).toBe(pair);
    expect(bakedBackOf(pair)).not.toBeNull();
    expect(flippableBackOf(pair)).not.toBeNull();
    const row = { frame_style: { template: "m15token" }, back_face: { ...SOLDIER, frame_style: { template: "m15tokentext" } } };
    expect(rowHasBakedBack(row)).toBe(true);
    expect(exportFacesOf(row)).toEqual(["front", "back"]);
    expect(hasBackOfItsOwn("m15token", row.back_face)).toBe(true);
    expect(cardPageName("Goblin", "token", cardPageFacesOf(row))).toBe("Goblin // Soldier");
  });

  it("every token stored before 5.5 (c) is what it was: no back, or a body-less back, bakes one face", () => {
    for (const back of [null, { ...SOLDIER }]) {
      const c = card(back);
      expect(backBodyOf(c)).toBeNull();
      expect(bakedBackOf(c)).toBeNull();
      expect(rowHasBakedBack({ frame_style: { template: "m15token" }, back_face: back })).toBe(false);
      expect(hasBackOfItsOwn("m15token", back)).toBe(false);
    }
    // A body of the other design draws as a legacy back (never stored: the gate derives the front's).
    expect(backBodyOf(card({ ...SOLDIER, frame_style: { template: "m20tokentext" } }))).toBeNull();
  });
});

describe("the remix", () => {
  it("names a token back as a token, two pictures; an own pair keeps both faces at 2 credits, one face on a one-credit plan", () => {
    expect(remixSecondHalfLayout("m15token")).toBe("token");
    const source = {
      title: "Goblin",
      card_type: "token" as const,
      supertype: "Creature",
      subtypes: ["Goblin"],
      rules_text: null,
      color_identity: ["red"] as ColorIdentity[],
      frame_style: { template: "m15token" },
      back_face: { ...SOLDIER, art_url: "https://x/back.png", frame_style: { template: "m15tokentext" } },
    };
    const kept = ownCardRemixFrame(source as never, EVERY_TOKEN);
    expect(kept.frame_template).toBe("m15token");
    expect(kept.back_face?.frame_style).toEqual({ template: "m15tokentext" });
    expect(kept.back_face?.art_url).toBeUndefined();
    expect(remixCreditsOf(kept)).toBe(2);
    const one = ownCardRemixFrame(source as never, EVERY_TOKEN, { singleFace: true });
    expect([one.frame_template, one.back_face, remixCreditsOf(one)]).toEqual(["m15token", undefined, 1]);
    // A back whose token was withdrawn in its colour: the token alone.
    const withdrawn = new Set([...EVERY_TOKEN].filter((key) => key !== frameComboKey("m15tokentext", "w")));
    expect(remixCreditsOf(ownCardRemixFrame(source as never, withdrawn))).toBe(1);
  });
});
