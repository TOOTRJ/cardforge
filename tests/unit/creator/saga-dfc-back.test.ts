import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { DFC_BACK_BODY_SET, resolveDfcBackFace, type DfcBackFacePayload } from "@/lib/cards/dfc-gate";
import {
  SAGA_BACK_BODY,
  backBodyFor,
  bodyFor,
  dfcBodyOf,
  frontBodyFor,
  isDeclaredDfcBody,
  isDfcBackBody,
  isOwnKindFront,
  isSagaFront,
  namesSagaSubtype,
  sagaBackBodyFor,
  templateHasBackFace,
} from "@/lib/cards/dfc";
import { backPreviewData, bakedBackOf } from "@/lib/cards/faces";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { colorIndicatorBox } from "@/lib/cards/color-indicator";
import { SAGA_TYPE_ROW_DY_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { KIND_DEFS, templateRefusesKind, type CardKind } from "@/lib/creator/card-kinds";
import { creatorBackBodyFor } from "@/lib/creator/saga-back";
import { SAGA_TYPE_DY } from "@/scripts/lib/saga-back.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.5 (b), PR 2 — the double-faced saga BACK (`sagadfcback`): the back
// of a transform card whose BACK face is a Saga (MOM's praetors, LCI #189).
// An ADDITION behind verification: a Saga back wears it only where it is
// published in the colour the back wears — else the ▼ back, exactly as
// before — and the server's gate, the creator and the import agree
// (`backBodyFor`). The renderers' half is
// tests/unit/render/saga-dfc-back.test.tsx; the import's
// tests/unit/scryfall/saga-dfc-imports.test.ts.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verified = (...templates: string[]) => new Set(templates.flatMap((t) => KEYS.map((k) => frameComboKey(t, k))));
const PLAIN = verified("m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandback");
const WITH_SAGA = verified("m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandback", SAGA_BACK_BODY);

const ETCHINGS: DfcBackFacePayload = {
  title: "The Argent Etchings",
  card_type: "enchantment",
  subtypes: ["Saga"],
  rules_text: "(As this Saga enters and after your draw step, add a lore counter.)\nI — Incubate 2 five times.\nII — Creatures you control get +1/+1.\nIII — Destroy all other permanents.",
};

describe("the profile", () => {
  it("is a transform BACK body with the ▼ at the right — never a card's own template, never a front", () => {
    expect(dfcBodyOf(SAGA_BACK_BODY)).toEqual({ layout: "transform", role: "back", well: "right" });
    expect(isDfcBackBody(SAGA_BACK_BODY)).toBe(true);
    expect(isDeclaredDfcBody(SAGA_BACK_BODY)).toBe(true);
    expect(templateHasBackFace(SAGA_BACK_BODY)).toBe(false);
    expect(isSagaFront(SAGA_BACK_BODY)).toBe(false);
    expect(isOwnKindFront(SAGA_BACK_BODY)).toBe(false);
    for (const kind of Object.keys(KIND_DEFS) as CardKind[]) expect(templateRefusesKind(SAGA_BACK_BODY, kind), kind).toBe(true);
    // The compare tools build its card on the plain transform front.
    expect(frontBodyFor(SAGA_BACK_BODY, "creature")).toBe("m15dfcfront");
  });

  it("is the saga's profile with the ▼ back's deltas: no cost, white ink, the name before the well, the dot moved down with its bar, no P/T, no crown", () => {
    const back = getFrameProfile(SAGA_BACK_BODY);
    const saga = getFrameProfile("saga");
    const dfcBack = getFrameProfile("m15dfcback");
    expect(back.chapters).toEqual(saga.chapters);
    expect(back.artSlot).toEqual(saga.artSlot);
    expect(back.symbolRect).toEqual(saga.symbolRect);
    expect(back.hideCost).toBe(true);
    expect(back.title.colorHex).toBe(dfcBack.title.colorHex);
    expect(back.type.colorHex).toBe(dfcBack.type.colorHex);
    expect(back.title.rect.leftPct + back.title.rect.widthPct).toBeCloseTo(dfcBack.title.rect.leftPct + dfcBack.title.rect.widthPct, 6);
    expect(back.indicator).toBe("coloured");
    expect(back.pt).toBeUndefined();
    expect(back.reversePt).toBeUndefined();
    expect((back.overlays ?? []).map((o) => o.anatomy)).toEqual([]);
    expect(frameAnatomyOf(SAGA_BACK_BODY).crown).toBe(false);
    // The dot rides the type bar 593 px down — the builder's move.
    expect(SAGA_TYPE_ROW_DY_PX).toBe(SAGA_TYPE_DY);
    expect(back.indicatorDyPct).toBeCloseTo(593 / 21, 9);
    const box = colorIndicatorBox(back.indicatorDyPct);
    const centreY = ((box.topPct + box.heightPct / 2) / 100) * 2100;
    expect(centreY).toBeCloseTo(1239 + 593, 0);
    // …and no other body moves its dot.
    for (const t of FRAME_TEMPLATE_VALUES) if (t !== SAGA_BACK_BODY) expect(getFrameProfile(t).indicatorDyPct, t).toBeUndefined();
  });
});

describe("which back wears it (backBodyFor)", () => {
  it("an enchantment Saga back on the ▼ family and the bordered look — nothing else", () => {
    expect(namesSagaSubtype(["Saga"])).toBe(true);
    expect(namesSagaSubtype("Saga, Construct")).toBe(true);
    expect(namesSagaSubtype("saga")).toBe(true);
    expect(namesSagaSubtype(["Sagas"])).toBe(false);
    expect(namesSagaSubtype("Aura")).toBe(false);
    expect(namesSagaSubtype(null)).toBe(false);
    expect(sagaBackBodyFor("transform", "enchantment", ["Saga"])).toBe(SAGA_BACK_BODY);
    // A saga CREATURE back (FIN's summons) is 4.5d's body.
    expect(sagaBackBodyFor("transform", "creature", ["Saga", "Dragon"])).toBeNull();
    expect(sagaBackBodyFor("transform", "enchantment", ["Aura"])).toBeNull();
    expect(sagaBackBodyFor("modal", "enchantment", ["Saga"])).toBeNull();
    for (const family of ["sunmoon", "moon", "compass", "fan"] as const) expect(sagaBackBodyFor("transform", "enchantment", ["Saga"], family)).toBeNull();
    expect(sagaBackBodyFor("transform", "enchantment", ["Saga"], "arrows", "borderless")).toBeNull();
  });

  it("wears it only where it is offered (published); otherwise exactly bodyFor's body, as before", () => {
    const face = { cardType: "enchantment", subtypes: ["Saga"] };
    expect(backBodyFor("transform", face)).toBe(SAGA_BACK_BODY);
    expect(backBodyFor("transform", face, "arrows", "bordered", () => false)).toBe("m15dfcback");
    expect(backBodyFor("transform", face, "fan")).toBe("m15dfcbackleft");
    expect(backBodyFor("transform", face, "arrows", "borderless")).toBe(bodyFor("transform", "back", "enchantment", "arrows", "borderless"));
    // Every other back: bodyFor's, whatever is offered.
    for (const cardType of ["creature", "artifact", "enchantment", "land", "instant", "sorcery"]) {
      for (const family of ["arrows", "sunmoon", "moon", "compass", "fan"] as const) {
        for (const layout of ["transform", "modal"] as const) {
          expect(backBodyFor(layout, { cardType, subtypes: ["Aura"] }, family)).toBe(bodyFor(layout, "back", cardType, family));
        }
      }
    }
  });
});

describe("the server's gate (resolveDfcBackFace)", () => {
  const gate = (back: DfcBackFacePayload, keys: ReadonlySet<string>, extra: Partial<Parameters<typeof resolveDfcBackFace>[0]> = {}) =>
    resolveDfcBackFace({ frontTemplate: "m15dfcfront", back, family: null, frontColorIdentity: ["white"], verifiedKeys: keys, ...extra });

  it("a NEW card's Saga back: the saga back once published in its colour, the ▼ back before", () => {
    const before = gate(ETCHINGS, PLAIN);
    expect(before.ok && before.back?.frame_style?.template).toBe("m15dfcback");
    const after = gate(ETCHINGS, WITH_SAGA);
    expect(after.ok && after.back?.frame_style?.template).toBe(SAGA_BACK_BODY);
    // Published in white only: a red back stays on the ▼ back.
    const whiteOnly = new Set([...PLAIN, frameComboKey(SAGA_BACK_BODY, "w")]);
    expect((gate({ ...ETCHINGS, color_identity: ["red"] }, whiteOnly) as { back?: DfcBackFacePayload }).back?.frame_style?.template).toBe("m15dfcback");
    expect((gate(ETCHINGS, whiteOnly) as { back?: DfcBackFacePayload }).back?.frame_style?.template).toBe(SAGA_BACK_BODY);
    // An admin's frame preview: wherever it exists.
    expect((gate(ETCHINGS, PLAIN, { skipVerification: true }) as { back?: DfcBackFacePayload }).back?.frame_style?.template).toBe(SAGA_BACK_BODY);
    // The colour stays the back's: a three-colour back on the gold master.
    const gold = gate({ ...ETCHINGS, color_identity: ["green", "red", "white"] }, WITH_SAGA);
    expect(gold.ok && gold.back?.color_identity).toEqual(["green", "red", "white"]);
    expect(gold.ok && gold.back?.cost).toBeUndefined();
  });

  it("refuses a crafted other body on a create, as for every back", () => {
    const crafted = gate({ ...ETCHINGS, frame_style: { template: "m15dfcback" } }, WITH_SAGA);
    expect(crafted.ok).toBe(false);
    const sent = gate({ ...ETCHINGS, frame_style: { template: SAGA_BACK_BODY } }, WITH_SAGA);
    expect(sent.ok).toBe(true);
  });

  it("an EDIT keeps the stored body: a Saga back saved on the ▼ back stays there; a saga back stays a saga back", () => {
    const storedPlain = { ...ETCHINGS, frame_style: { template: "m15dfcback" }, color_identity: ["white" as const] };
    const kept = gate({ ...ETCHINGS, title: "Renamed" }, WITH_SAGA, { stored: { back: storedPlain, familyChanged: false } });
    expect(kept.ok && kept.back?.frame_style?.template).toBe("m15dfcback");
    const storedSaga = { ...ETCHINGS, frame_style: { template: SAGA_BACK_BODY }, color_identity: ["white" as const] };
    const keptSaga = gate({ ...ETCHINGS, title: "Renamed" }, PLAIN, { stored: { back: storedSaga, familyChanged: false } });
    expect(keptSaga.ok && keptSaga.back?.frame_style?.template).toBe(SAGA_BACK_BODY);
    // A type change that would derive another body is refused, as before.
    const retyped = gate({ ...ETCHINGS, card_type: "creature" }, WITH_SAGA, { stored: { back: storedSaga, familyChanged: false } });
    expect(retyped).toMatchObject({ ok: false, message: DFC_BACK_BODY_SET });
  });
});

describe("the creator derives what the gate stores (creatorBackBodyFor)", () => {
  const families = ["arrows", "fan"] as const;
  const subtypesOf = ["Saga", "Saga, Wizard", "Aura", ""];
  const types = ["enchantment", "creature", "land"];
  const colours = [["white"], ["green", "red", "white"], []] as const;

  it("on a create, for every type × subtypes × family × colour × verified set: the saga back exactly where it is published, else bodyFor's — and the server stores the same", () => {
    for (const keys of [PLAIN, WITH_SAGA, new Set([...PLAIN, frameComboKey(SAGA_BACK_BODY, "w")])]) {
      for (const family of families) {
        for (const backType of types) {
          for (const subtypes of subtypesOf) {
            for (const colour of colours) {
              const worn = colour.length > 0 ? [...colour] : ["white" as const];
              const client = creatorBackBodyFor({
                mode: "create",
                layout: "transform",
                backType,
                backSubtypes: subtypes,
                family,
                look: "bordered",
                backColorIdentity: [...colour],
                frontColorIdentity: ["white"],
                verifiedKeys: keys,
              });
              const sagaWorn =
                sagaBackBodyFor("transform", backType, subtypes, family) !== null &&
                keys.has(frameComboKey(SAGA_BACK_BODY, pickFrameColorKey(worn)));
              expect(client, `${backType} "${subtypes}" ${family} ${colour}`).toBe(sagaWorn ? SAGA_BACK_BODY : bodyFor("transform", "back", backType, family));
              const server = resolveDfcBackFace({
                frontTemplate: "m15dfcfront",
                back: { title: "B", card_type: backType, subtypes: subtypes ? subtypes.split(", ") : [], color_identity: [...colour] },
                family,
                frontColorIdentity: ["white"],
                verifiedKeys: keys,
              });
              if (server.ok) expect(server.back?.frame_style?.template, `${backType} "${subtypes}" ${family} ${colour}`).toBe(client);
            }
          }
        }
      }
    }
  });

  it("matches the server exactly on a create with the real verification", () => {
    for (const keys of [PLAIN, WITH_SAGA, new Set([...PLAIN, frameComboKey(SAGA_BACK_BODY, "w")])]) {
      for (const colour of [["white"], ["red"], ["green", "red", "white"]] as const) {
        const client = creatorBackBodyFor({
          mode: "create",
          layout: "transform",
          backType: "enchantment",
          backSubtypes: "Saga",
          family: "arrows",
          look: "bordered",
          backColorIdentity: [...colour],
          frontColorIdentity: ["white"],
          verifiedKeys: keys,
        });
        const server = resolveDfcBackFace({
          frontTemplate: "m15dfcfront",
          back: { ...ETCHINGS, color_identity: [...colour] },
          family: null,
          frontColorIdentity: ["white"],
          verifiedKeys: keys,
        });
        if (server.ok) expect(server.back?.frame_style?.template, `${[...colour]}`).toBe(client);
        else expect(client).toBe("m15dfcback");
      }
    }
  });

  it("an edit draws the stored body while the family is unchanged", () => {
    const base = {
      mode: "edit" as const,
      layout: "transform" as const,
      backType: "enchantment",
      backSubtypes: "Saga",
      look: "bordered" as const,
      backColorIdentity: ["white" as const],
      frontColorIdentity: ["white" as const],
      verifiedKeys: WITH_SAGA,
    };
    expect(creatorBackBodyFor({ ...base, family: "arrows", storedBackTemplate: "m15dfcback", storedFamily: "arrows" })).toBe("m15dfcback");
    expect(creatorBackBodyFor({ ...base, family: "arrows", verifiedKeys: PLAIN, storedBackTemplate: SAGA_BACK_BODY, storedFamily: "arrows" })).toBe(SAGA_BACK_BODY);
    // A family change re-derives it (the server's familyChanged).
    expect(creatorBackBodyFor({ ...base, family: "fan", storedBackTemplate: SAGA_BACK_BODY, storedFamily: "arrows" })).toBe("m15dfcbackleft");
    // A remix is a new card: derived.
    expect(creatorBackBodyFor({ ...base, mode: "remix", family: "arrows", storedBackTemplate: "m15dfcback", storedFamily: "arrows" })).toBe(SAGA_BACK_BODY);
  });
});

describe("the faces", () => {
  it("a stored saga back draws (and bakes) on its body in its colour, its chapters from its plain text", () => {
    const card = {
      title: "Elesh Norn",
      cardType: "creature",
      colorIdentity: ["white"],
      frameStyle: { template: "m15dfcfront" },
      backFace: { ...ETCHINGS, frame_style: { template: SAGA_BACK_BODY }, color_identity: ["green", "red", "white"] },
    } as unknown as CardPreviewData;
    const back = backPreviewData(card)!;
    expect(back.frameStyle?.template).toBe(SAGA_BACK_BODY);
    expect(back.colorIdentity).toEqual(["green", "red", "white"]);
    expect(back.rulesText).toBe(ETCHINGS.rules_text);
    expect(back.faceContent).toBeNull();
    expect(back.dfc).toMatchObject({ layout: "transform", role: "back", icon: "arrows" });
    expect(bakedBackOf(card)).not.toBeNull();
  });
});

describe("an edit that retypes a back as a Saga (skeptic #589)", () => {
  it("keeps a creature back stored on the ▼ back there when it becomes an enchantment Saga — accepted as on main, whether or not the saga back is published", () => {
    const stored = { ...ETCHINGS, card_type: "creature", subtypes: ["Human"], frame_style: { template: "m15dfcback" }, color_identity: ["white"] } as DfcBackFacePayload;
    for (const keys of [PLAIN, WITH_SAGA]) {
      const result = resolveDfcBackFace({
        frontTemplate: "m15dfcfront",
        family: undefined,
        back: { ...ETCHINGS, color_identity: ["white"] } as DfcBackFacePayload,
        frontColorIdentity: ["white"],
        verifiedKeys: keys,
        stored: { back: stored, familyChanged: false },
      });
      expect(result.ok && result.back?.frame_style?.template).toBe("m15dfcback");
      expect(
        creatorBackBodyFor({
          mode: "edit",
          layout: "transform",
          backType: "enchantment",
          backSubtypes: "Saga",
          family: "arrows",
          look: "bordered",
          backColorIdentity: ["white"],
          frontColorIdentity: ["white"],
          verifiedKeys: keys,
          storedBackTemplate: "m15dfcback",
          storedFamily: "arrows",
        }),
      ).toBe("m15dfcback");
    }
  });

  it("still refuses a saga back retyped off the Saga (its type's body is the ▼ back)", () => {
    const stored = { ...ETCHINGS, frame_style: { template: SAGA_BACK_BODY }, color_identity: ["white"] } as DfcBackFacePayload;
    const result = resolveDfcBackFace({
      frontTemplate: "m15dfcfront",
      family: undefined,
      back: { ...ETCHINGS, card_type: "creature", subtypes: ["Human"], color_identity: ["white"] } as DfcBackFacePayload,
      frontColorIdentity: ["white"],
      verifiedKeys: WITH_SAGA,
      stored: { back: stored, familyChanged: false },
    });
    expect(result).toMatchObject({ ok: false, field: "back_face.card_type", message: DFC_BACK_BODY_SET });
  });
});
