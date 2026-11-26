import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { DFC_BACK_BODY_SET, resolveDfcBackFace, type DfcBackFacePayload } from "@/lib/cards/dfc-gate";
import {
  SAGA_BACK_BODY,
  SAGA_CREATURE_BACK_BODY,
  backBodyFor,
  bodyFor,
  dfcBodyOf,
  frontBodyFor,
  isDeclaredDfcBody,
  isDfcBackBody,
  isOwnKindFront,
  isSagaFront,
  sagaBackBodyFor,
  sagaCreatureBackBodyFor,
  templateHasBackFace,
} from "@/lib/cards/dfc";
import { backPreviewData, bakedBackOf } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { colorIndicatorBox } from "@/lib/cards/color-indicator";
import { M15_NYX_DFC_CROWN_RIGHT, SAGA_CREATURE_RAISE_PX, SAGA_TYPE_ROW_DY_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { KIND_DEFS, templateRefusesKind, type CardKind } from "@/lib/creator/card-kinds";
import { creatorBackBodyFor } from "@/lib/creator/saga-back";
import { TYPE_DY } from "@/scripts/lib/saga-creature-back.mjs";

// ---------------------------------------------------------------------------
// TODO 4.5d, part B — the saga creature's BACK (`sagacreaturedfcback`): the
// back of a transform card whose BACK face is a Saga whose type words say
// Creature (FIN's Dominants' summons: "Legendary Enchantment Creature — Saga
// Dragon", imported as the creature card type with "Enchantment" in front).
// An ADDITION behind verification: such a back wears it only where it is
// published in the colour the back wears — else exactly the body it derived
// before (the ▼ back) — and the server's gate, the creator and the import
// agree (`backBodyFor`). The renderers' half is
// tests/unit/render/saga-creature-back.test.tsx; the import's
// tests/unit/scryfall/saga-creature-back-imports.test.ts.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const PLAIN = verified("m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandback", SAGA_BACK_BODY);
const WITH_BODY = verified("m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandback", SAGA_BACK_BODY, SAGA_CREATURE_BACK_BODY);

/** FIN #16's back, as the import reads it. */
const BAHAMUT: DfcBackFacePayload = {
  title: "Bahamut, Warden of Light",
  card_type: "creature",
  supertype: "Legendary Enchantment",
  subtypes: ["Saga", "Dragon"],
  rules_text:
    "(As this Saga enters and after your draw step, add a lore counter.)\nI, II — Wings of Light — Put a +1/+1 counter on each other creature you control. Those creatures gain flying until end of turn.\nIII — Gigaflare — Destroy target permanent. Exile Bahamut, then return it to the battlefield (front face up).\nFlying",
  power: "5",
  toughness: "5",
};

describe("the profile", () => {
  it("is a transform BACK body with the ▼ at the right — never a card's own template, never a front", () => {
    expect(SAGA_CREATURE_BACK_BODY).toBe("sagacreaturedfcback");
    expect(dfcBodyOf(SAGA_CREATURE_BACK_BODY)).toEqual({ layout: "transform", role: "back", well: "right" });
    expect(isDfcBackBody(SAGA_CREATURE_BACK_BODY)).toBe(true);
    expect(isDeclaredDfcBody(SAGA_CREATURE_BACK_BODY)).toBe(true);
    expect(templateHasBackFace(SAGA_CREATURE_BACK_BODY)).toBe(false);
    expect(isSagaFront(SAGA_CREATURE_BACK_BODY)).toBe(false);
    expect(isOwnKindFront(SAGA_CREATURE_BACK_BODY)).toBe(false);
    for (const kind of Object.keys(KIND_DEFS) as CardKind[]) expect(templateRefusesKind(SAGA_CREATURE_BACK_BODY, kind), kind).toBe(true);
    // The compare tools build its card on the plain transform front — the
    // front every FIN Dominant prints (FIN #16 Dion, a legendary creature).
    expect(frontBodyFor(SAGA_CREATURE_BACK_BODY, "creature")).toBe("m15dfcfront");
    expect(frontBodyFor(SAGA_CREATURE_BACK_BODY, "artifact")).toBe("m15dfcfront");
    expect(frontBodyFor(SAGA_CREATURE_BACK_BODY, "sorcery")).toBe("m15dfcfront");
  });

  it("is the saga creature's profile with the ▼ back's deltas: no cost, white ink, the name before the well, the dot on the raised bar, the dark back's plate toned, the Nyx crown cut round the well", () => {
    const back = getFrameProfile(SAGA_CREATURE_BACK_BODY);
    const body = getFrameProfile("sagacreature");
    const dfcBack = getFrameProfile("m15dfcback");
    // The saga creature's rail, band, window, raised type line and symbol,
    // and its second box — untouched.
    expect(back.chapters).toEqual(body.chapters);
    expect(back.chapters?.creatureBox).toBe(true);
    expect(back.artSlot).toEqual(body.artSlot);
    expect(back.rules).toEqual(body.rules);
    expect(back.symbolRect).toEqual(body.symbolRect);
    expect(back.type.rect).toEqual(body.type.rect);
    // The ▼ back's deltas.
    expect(back.hideCost).toBe(true);
    expect(back.title.colorHex).toBe(dfcBack.title.colorHex);
    expect(back.type.colorHex).toBe(dfcBack.type.colorHex);
    expect(back.title.rect.leftPct + back.title.rect.widthPct).toBeCloseTo(dfcBack.title.rect.leftPct + dfcBack.title.rect.widthPct, 6);
    expect(back.indicator).toBe("coloured");
    // The dot rides the type bar: the saga's 593 px less the 173 the body
    // raises it — the builder's move, centred where FIN #16 / #58 / #185
    // centre it (≈ 1657).
    expect(TYPE_DY).toBe(SAGA_TYPE_ROW_DY_PX - SAGA_CREATURE_RAISE_PX);
    expect(back.indicatorDyPct).toBeCloseTo(420 / 21, 9);
    const box = colorIndicatorBox(back.indicatorDyPct);
    expect(((box.topPct + box.heightPct / 2) / 100) * 2100).toBeCloseTo(1239 + 420, 0);
    // The P/T: the dark back's plate in its box and ink, the plates toned.
    expect({ ...back.pt, plateAssetPathTemplate: undefined }).toEqual({ ...dfcBack.pt, plateAssetPathTemplate: undefined });
    expect(back.pt?.plateAssetPathTemplate).toBe("/frames/sagacreaturedfcback/pt/{color}.png");
    expect(back.reversePt).toBeUndefined();
    // The crown and the collector line, opt-in per card; no stamp, no pairs.
    expect((back.overlays ?? []).map((o) => o.anatomy)).toEqual(["crown"]);
    expect(back.overlays?.[0]).toMatchObject({ ...M15_NYX_DFC_CROWN_RIGHT, keyMap: { c: "a" } });
    expect(frameAnatomyOf(SAGA_CREATURE_BACK_BODY)).toMatchObject({ crown: true, twoColor: [], collector: true, stamp: false });
  });
});

describe("which back wears it (sagaCreatureBackBodyFor, backBodyFor)", () => {
  it("a Saga back whose type words say Creature, on the ▼ family and the bordered look — nothing else", () => {
    // The import's reading (the creature card type, Enchantment in front)…
    expect(sagaCreatureBackBodyFor("transform", { cardType: "creature", supertype: "Legendary Enchantment", subtypes: ["Saga", "Dragon"] })).toBe(SAGA_CREATURE_BACK_BODY);
    // …the creator's other spelling (the enchantment card type, Creature in
    // front), and the form's comma-separated subtypes.
    expect(sagaCreatureBackBodyFor("transform", { cardType: "enchantment", supertype: "Creature", subtypes: "Saga, Construct" })).toBe(SAGA_CREATURE_BACK_BODY);
    expect(sagaCreatureBackBodyFor("transform", { cardType: "creature", supertype: null, subtypes: "Saga" })).toBe(SAGA_CREATURE_BACK_BODY);
    // Not a saga creature: a plain Saga back (5.5 (b)'s), a creature that
    // is no Saga, "Creatures" in the supertype.
    expect(sagaCreatureBackBodyFor("transform", { cardType: "enchantment", supertype: null, subtypes: ["Saga"] })).toBeNull();
    expect(sagaCreatureBackBodyFor("transform", { cardType: "creature", supertype: "Legendary", subtypes: ["Dragon"] })).toBeNull();
    expect(sagaCreatureBackBodyFor("transform", { cardType: "enchantment", supertype: "Creatures", subtypes: ["Saga"] })).toBeNull();
    // Never a LAND back (a "Land Creature — Saga" keeps main's land back,
    // m15dfclandback), nor an emblem.
    expect(sagaCreatureBackBodyFor("transform", { cardType: "land", supertype: "Creature", subtypes: ["Saga"] })).toBeNull();
    expect(backBodyFor("transform", { cardType: "land", supertype: "Creature", subtypes: ["Saga"] }, "arrows")).toBe("m15dfclandback");
    expect(sagaCreatureBackBodyFor("transform", { cardType: "emblem", supertype: "Creature", subtypes: ["Saga"] })).toBeNull();
    // Only on the transform ▼ back and the bordered look.
    expect(sagaCreatureBackBodyFor("modal", { cardType: "creature", subtypes: ["Saga"] })).toBeNull();
    for (const family of ["sunmoon", "moon", "compass", "fan"] as const) {
      expect(sagaCreatureBackBodyFor("transform", { cardType: "creature", subtypes: ["Saga"] }, family)).toBeNull();
    }
    expect(sagaCreatureBackBodyFor("transform", { cardType: "creature", subtypes: ["Saga"] }, "arrows", "borderless")).toBeNull();
    // The saga back (5.5 (b)) is untouched for the import's spelling.
    expect(sagaBackBodyFor("transform", "creature", ["Saga", "Dragon"])).toBeNull();
  });

  it("wears it only where it is offered; short of that, EXACTLY the body the back derived before part B", () => {
    const fin = { cardType: "creature", supertype: "Legendary Enchantment", subtypes: ["Saga", "Dragon"] };
    expect(backBodyFor("transform", fin)).toBe(SAGA_CREATURE_BACK_BODY);
    expect(backBodyFor("transform", fin, "arrows", "bordered", (t) => t !== SAGA_CREATURE_BACK_BODY)).toBe("m15dfcback");
    expect(backBodyFor("transform", fin, "fan")).toBe("m15dfcbackleft");
    // The enchantment spelling fell to the saga back before (sagaBackBodyFor
    // ignores the Creature word): still so where the creature body isn't
    // offered.
    const spelled = { cardType: "enchantment", supertype: "Creature", subtypes: ["Saga"] };
    expect(backBodyFor("transform", spelled)).toBe(SAGA_CREATURE_BACK_BODY);
    expect(backBodyFor("transform", spelled, "arrows", "bordered", (t) => t !== SAGA_CREATURE_BACK_BODY)).toBe(SAGA_BACK_BODY);
    expect(backBodyFor("transform", spelled, "arrows", "bordered", () => false)).toBe("m15dfcback");
    // Every back that is no Saga: bodyFor's, whatever is offered.
    for (const cardType of ["creature", "artifact", "enchantment", "land", "instant", "sorcery"]) {
      for (const supertype of [null, "Legendary", "Enchantment Creature"]) {
        for (const family of ["arrows", "sunmoon", "fan"] as const) {
          expect(backBodyFor("transform", { cardType, supertype, subtypes: ["Aura"] }, family)).toBe(bodyFor("transform", "back", cardType, family));
        }
      }
    }
  });
});

describe("the server's gate (resolveDfcBackFace)", () => {
  const gate = (back: DfcBackFacePayload, keys: ReadonlySet<string>, extra: Partial<Parameters<typeof resolveDfcBackFace>[0]> = {}) =>
    resolveDfcBackFace({ frontTemplate: "m15dfcfront", back, family: null, frontColorIdentity: ["white"], verifiedKeys: keys, ...extra });
  const bodyOf = (result: ReturnType<typeof resolveDfcBackFace>) => (result.ok ? result.back?.frame_style?.template : `refused: ${result.message}`);

  it("a NEW card's saga creature back: the body once published in its colour, the ▼ back before — its P/T kept", () => {
    expect(bodyOf(gate(BAHAMUT, PLAIN))).toBe("m15dfcback");
    const after = gate(BAHAMUT, WITH_BODY);
    expect(bodyOf(after)).toBe(SAGA_CREATURE_BACK_BODY);
    expect(after.ok && [after.back?.power, after.back?.toughness, after.back?.supertype]).toEqual(["5", "5", "Legendary Enchantment"]);
    // A transform back keeps no cost.
    expect(after.ok && after.back && "cost" in after.back).toBe(false);
    // Published in white only: a red back stays on the ▼ back.
    const whiteOnly = new Set([...PLAIN, frameComboKey(SAGA_CREATURE_BACK_BODY, "w")]);
    expect(bodyOf(gate({ ...BAHAMUT, color_identity: ["red"] }, whiteOnly))).toBe("m15dfcback");
    expect(bodyOf(gate(BAHAMUT, whiteOnly))).toBe(SAGA_CREATURE_BACK_BODY);
    // An admin's frame preview: wherever it exists.
    expect(bodyOf(gate(BAHAMUT, PLAIN, { skipVerification: true }))).toBe(SAGA_CREATURE_BACK_BODY);
    // A two-colour back on the gold master (the body has no pairs).
    const pair = gate({ ...BAHAMUT, color_identity: ["red", "white"] }, WITH_BODY);
    expect(pair.ok && [pair.back?.frame_style?.template, pair.back?.color_identity]).toEqual([SAGA_CREATURE_BACK_BODY, ["red", "white"]]);
  });

  it("refuses a crafted other body on a create, as for every back", () => {
    expect(gate({ ...BAHAMUT, frame_style: { template: "m15dfcback" } }, WITH_BODY).ok).toBe(false);
    expect(gate({ ...BAHAMUT, frame_style: { template: SAGA_BACK_BODY } }, WITH_BODY).ok).toBe(false);
    expect(gate({ ...BAHAMUT, frame_style: { template: SAGA_CREATURE_BACK_BODY } }, WITH_BODY).ok).toBe(true);
    // …and the body before it is published.
    expect(gate({ ...BAHAMUT, frame_style: { template: SAGA_CREATURE_BACK_BODY } }, PLAIN).ok).toBe(false);
  });

  it("an EDIT keeps the stored body: a summon saved on the ▼ back stays there once the body is published; one on the body stays", () => {
    const storedPlain = { ...BAHAMUT, frame_style: { template: "m15dfcback" }, color_identity: ["white" as const] };
    expect(bodyOf(gate({ ...BAHAMUT, title: "Renamed" }, WITH_BODY, { stored: { back: storedPlain, familyChanged: false } }))).toBe("m15dfcback");
    const storedBody = { ...BAHAMUT, frame_style: { template: SAGA_CREATURE_BACK_BODY }, color_identity: ["white" as const] };
    expect(bodyOf(gate({ ...BAHAMUT, title: "Renamed" }, PLAIN, { stored: { back: storedBody, familyChanged: false } }))).toBe(SAGA_CREATURE_BACK_BODY);
    // A type change that would derive another body is refused, as before.
    expect(gate({ ...BAHAMUT, card_type: "land" }, WITH_BODY, { stored: { back: storedBody, familyChanged: false } })).toMatchObject({
      ok: false,
      message: DFC_BACK_BODY_SET,
    });
  });
});

describe("the creator derives what the gate stores (creatorBackBodyFor)", () => {
  it("on a create, for every type × supertype × subtypes × family × colour × verified set: the server stores what the form derives", () => {
    const keySets = [PLAIN, WITH_BODY, new Set([...PLAIN, frameComboKey(SAGA_CREATURE_BACK_BODY, "w")])];
    for (const keys of keySets) {
      for (const family of ["arrows", "fan"] as const) {
        for (const backType of ["creature", "enchantment", "land"]) {
          for (const supertype of ["", "Legendary Enchantment", "Creature"]) {
            for (const subtypes of ["Saga", "Saga, Dragon", "Dragon", ""]) {
              for (const colour of [["white"], ["red"], ["red", "white"], []] as const) {
                const client = creatorBackBodyFor({
                  mode: "create",
                  layout: "transform",
                  backType,
                  backSubtypes: subtypes,
                  backSupertype: supertype,
                  family,
                  look: "bordered",
                  backColorIdentity: [...colour],
                  frontColorIdentity: ["white"],
                  verifiedKeys: keys,
                });
                const worn = colour.length > 0 ? [...colour] : ["white" as const];
                const creature =
                  sagaCreatureBackBodyFor("transform", { cardType: backType, supertype, subtypes }, family) !== null &&
                  keys.has(frameComboKey(SAGA_CREATURE_BACK_BODY, pickFrameColorKey(worn)));
                const label = `${backType} "${supertype}" "${subtypes}" ${family} ${colour}`;
                if (creature) expect(client, label).toBe(SAGA_CREATURE_BACK_BODY);
                else expect(client, label).not.toBe(SAGA_CREATURE_BACK_BODY);
                const server = resolveDfcBackFace({
                  frontTemplate: "m15dfcfront",
                  back: { title: "B", card_type: backType, supertype: supertype || null, subtypes: subtypes ? subtypes.split(", ") : [], color_identity: [...colour] },
                  family,
                  frontColorIdentity: ["white"],
                  verifiedKeys: keys,
                });
                if (server.ok) expect(server.back?.frame_style?.template, label).toBe(client);
              }
            }
          }
        }
      }
    }
  });

  it("an edit draws the stored body while the family is unchanged; a remix derives", () => {
    const base = {
      mode: "edit" as const,
      layout: "transform" as const,
      backType: "creature",
      backSubtypes: "Saga, Dragon",
      backSupertype: "Legendary Enchantment",
      look: "bordered" as const,
      backColorIdentity: ["white" as const],
      frontColorIdentity: ["white" as const],
      verifiedKeys: WITH_BODY,
    };
    expect(creatorBackBodyFor({ ...base, family: "arrows", storedBackTemplate: "m15dfcback", storedFamily: "arrows" })).toBe("m15dfcback");
    expect(creatorBackBodyFor({ ...base, family: "arrows", verifiedKeys: PLAIN, storedBackTemplate: SAGA_CREATURE_BACK_BODY, storedFamily: "arrows" })).toBe(SAGA_CREATURE_BACK_BODY);
    expect(creatorBackBodyFor({ ...base, family: "fan", storedBackTemplate: SAGA_CREATURE_BACK_BODY, storedFamily: "arrows" })).toBe("m15dfcbackleft");
    expect(creatorBackBodyFor({ ...base, mode: "remix", family: "arrows", storedBackTemplate: "m15dfcback", storedFamily: "arrows" })).toBe(SAGA_CREATURE_BACK_BODY);
  });
});

describe("the faces", () => {
  it("a card with its back on the body draws the back on it, in its own colour, with its P/T — never the front's frame", () => {
    const card = {
      title: "Dion, Bahamut's Dominant",
      cost: "{3}{W}",
      cardType: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Noble", "Knight"],
      rarity: "rare",
      colorIdentity: ["white"],
      rulesText: "When Dion enters, create a 2/2 white Knight creature token.",
      flavorText: null,
      power: "3",
      toughness: "3",
      loyalty: null,
      defense: null,
      artistCredit: null,
      artUrl: null,
      artPosition: {},
      frameStyle: { template: "m15dfcfront", finish: "regular", crown: true },
      setIconUrl: null,
      setIconCode: null,
      backFace: { ...BAHAMUT, color_identity: ["white"], frame_style: { template: SAGA_CREATURE_BACK_BODY } },
    } as unknown as CardPreviewData;
    expect(bakedBackOf(card)).toBeTruthy();
    const back = backPreviewData(card)!;
    expect(back.frameStyle?.template).toBe(SAGA_CREATURE_BACK_BODY);
    expect(back.frameStyle?.crown).toBe(true);
    expect([back.cardType, back.supertype, back.power, back.toughness]).toEqual(["creature", "Legendary Enchantment", "5", "5"]);
    expect(back.faceContent).toBeNull();
  });
});
