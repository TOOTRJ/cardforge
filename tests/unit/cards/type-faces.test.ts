import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { DISPLAY_BASELINE_BELOW_CENTRE_EM, getFrameProfile, slotTextDy, type FrameProfile } from "@/lib/cards/template-layout";
import {
  BRAND_FACE,
  FACE_ROLES,
  TYPE_FACES,
  faceOf,
  facesOf,
  footerFace,
  slotFace,
  typeFace,
  type FaceRole,
  type SlotFace,
} from "@/lib/cards/type-faces";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/type-faces.ts — the ONE resolver both renderers read for the
// face of every piece of card text outside the rules box (TODO 4.8.0). It
// must (a) answer exactly what each renderer hard-coded before it, for every
// shipped profile and role — the refactor moves no pixel — and (b) follow a
// profile that names another face, at every role but the brand mark.
// (That both renderers actually READ it is tests/unit/render/
// profile-data-parity.test.tsx.)
// ---------------------------------------------------------------------------

type Font = { unitsPerEm: number; ascender: number; descender: number };
const parse = (file: string): Font => {
  const buf = readFileSync(join(process.cwd(), "public/fonts", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/** What each renderer drew a role in before the resolver — its literals. */
const BEFORE: Record<FaceRole, SlotFace> = {
  name: "display",
  typeLine: "display",
  stat: "display",
  badge: "display",
  secondName: "display",
  secondType: "display",
  secondStat: "display",
  footer: "display", // every shipped footer says so (an unset one was body)
  stripWord: "display",
  mark: "display",
  numeral: "body", // the saga's numerals, MPlantin since TODO 4.21c
};

describe("the faces", () => {
  it("are the two the repo has, spelled as the renderers spelled them", () => {
    expect(Object.keys(TYPE_FACES)).toEqual(["display", "body"]);
    // The exact strings lib/render/card-image.tsx and components/cards/
    // card-preview.tsx held as DISPLAY_FONT / BODY_FONT / CARD_FONT.
    expect(TYPE_FACES.display.bakeFamily).toBe('"CardDisplay", "MPlantin"');
    expect(TYPE_FACES.body.bakeFamily).toBe('"MPlantin"');
    expect(TYPE_FACES.display.previewFamily).toBe('"CardDisplay", "MPlantin", Georgia, "Times New Roman", serif');
    expect(TYPE_FACES.body.previewFamily).toBe('"MPlantin", Georgia, "Times New Roman", serif');
    expect([TYPE_FACES.display.family, TYPE_FACES.body.family]).toEqual(["CardDisplay", "MPlantin"]);
    expect(BRAND_FACE).toBe(TYPE_FACES.display);
  });

  it("carry their own hhea line box, held to the TTFs", () => {
    const beleren = parse("Beleren-Bold.ttf");
    const mplantin = parse("mplantin.ttf");
    for (const [face, font] of [
      [TYPE_FACES.display, beleren],
      [TYPE_FACES.body, mplantin],
    ] as const) {
      expect(face.ascentEm, face.id).toBe(font.ascender / font.unitsPerEm);
      expect(face.descentEm, face.id).toBe(-font.descender / font.unitsPerEm);
      expect(face.baselineBelowCentreEm, face.id).toBe((font.ascender + font.descender) / 2 / font.unitsPerEm);
      expect(face.metrics.unitsPerEm, face.id).toBe(font.unitsPerEm);
    }
    // The display face's is, to the bit, the constant the profiles' dy
    // values were derived with: (1917 − 552) ÷ 2 ÷ 2048.
    expect(TYPE_FACES.display.baselineBelowCentreEm).toBe((1917 - 552) / 2 / 2048);
    expect(DISPLAY_BASELINE_BELOW_CENTRE_EM).toBe((1917 - 552) / 2 / 2048);
    expect(TYPE_FACES.body.baselineBelowCentreEm).toBe((774 - 225) / 2 / 1000);
  });

  it("both draw ONE master at any weight a site asks for: their @font-face covers 400–700, so no browser synthesizes a bold the bake lacks", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const rule = (family: string, style: string) =>
      [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]).find((b) => b.includes(`font-family: "${family}"`) && b.includes(`font-style: ${style}`)) ?? "";
    expect(rule("CardDisplay", "normal")).toMatch(/font-weight:\s*400 700;/);
    expect(rule("MPlantin", "normal")).toMatch(/font-weight:\s*400 700;/);
    expect(rule("MPlantin", "italic")).toMatch(/font-weight:\s*400 700;/);
    expect([TYPE_FACES.display.registeredWeight, TYPE_FACES.body.registeredWeight]).toEqual([400, 400]);
  });
});

describe("faceOf — every shipped profile resolves to what it drew", () => {
  it("each role on each template: the face its renderers' literals named", () => {
    let checked = 0;
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      for (const role of FACE_ROLES) {
        // (A profile with no footer draws none; the role's own default.)
        const want = role === "footer" && !profile.footer ? "body" : BEFORE[role];
        expect(faceOf(profile, role).id, `${template} ${role}`).toBe(want);
        checked += 1;
      }
      // …and every stat slot a role does not name.
      for (const slot of [profile.pt, profile.loyalty, profile.defense, profile.reversePt, profile.secondFace?.pt]) {
        if (slot) expect(slotFace(slot).id, `${template} stat`).toBe("display");
      }
      for (const slot of [profile.adventure?.title, profile.adventure?.type]) {
        if (slot) expect(slotFace(slot).id, `${template} adventure`).toBe("display");
      }
      // The faces a render registers for it: the display face — and the
      // body face where the profile has a chapter rail (its numerals).
      expect(facesOf(profile), template).toEqual(profile.chapters ? ["display", "body"] : ["display"]);
    }
    expect(checked).toBe(FRAME_TEMPLATE_VALUES.length * FACE_ROLES.length);
    expect(FACE_ROLES).toHaveLength(Object.keys(BEFORE).length);
  });

  it("no shipped profile names a face on a stat, a badge or a numeral (the fields are new)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      for (const slot of [profile.pt, profile.loyalty, profile.defense, profile.reversePt, profile.secondFace?.pt]) {
        expect(slot?.font, template).toBeUndefined();
      }
      expect(profile.loyaltyRows?.badgeFont, template).toBeUndefined();
      expect(profile.chapters?.badge.numeralFont, template).toBeUndefined();
      expect(profile.footer?.prefix, template).toBeUndefined();
      expect(profile.footer?.align, template).toBeUndefined();
    }
  });
});

describe("faceOf — a profile that names a face", () => {
  const flip = getFrameProfile("flip");
  const walker = getFrameProfile("m15pw");
  const saga = getFrameProfile("saga");
  const modal = getFrameProfile("m15mdfcfront");
  const body = <T extends object>(slot: T): T => ({ ...slot, font: "body" as const });

  it("is followed at every role that has a slot or a field", () => {
    const profile: FrameProfile = {
      ...flip,
      title: body(flip.title),
      type: body(flip.type),
      footer: body(flip.footer!),
      pt: body(flip.pt!),
      secondFace: { ...flip.secondFace!, title: body(flip.secondFace!.title), type: body(flip.secondFace!.type), pt: body(flip.secondFace!.pt!) },
      flipside: { ...modal.flipside!, word: body(modal.flipside!.word) },
      loyaltyRows: { ...walker.loyaltyRows!, badgeFont: "body" },
      chapters: { ...saga.chapters!, badge: { ...saga.chapters!.badge, numeralFont: "display" } },
    };
    const got = Object.fromEntries(FACE_ROLES.map((role) => [role, faceOf(profile, role).id]));
    expect(got).toEqual({
      name: "body",
      typeLine: "body",
      stat: "body",
      badge: "body",
      secondName: "body",
      secondType: "body",
      secondStat: "body",
      footer: "body",
      stripWord: "body",
      numeral: "display",
      // The mark is the brand's face whatever the profile says.
      mark: "display",
    });
    expect(faceOf(profile, "mark")).toBe(BRAND_FACE);
    expect(facesOf(profile)).toEqual(["display", "body"]);
  });

  it("one slot at a time moves only its own role", () => {
    const base = Object.fromEntries(FACE_ROLES.map((role) => [role, faceOf(flip, role).id]));
    const typed = { ...flip, type: body(flip.type) };
    expect(Object.fromEntries(FACE_ROLES.map((role) => [role, faceOf(typed, role).id]))).toEqual({ ...base, typeLine: "body" });
    // A walker's loyalty is its own slot's.
    expect(slotFace(body(walker.loyalty!)).id).toBe("body");
    expect(faceOf({ loyalty: body(walker.loyalty!) }, "stat").id).toBe("body");
  });

  it("an unset slot: the display face on a band or a stat, the body face on a footer (as both renderers read it)", () => {
    expect(slotFace(undefined).id).toBe("display");
    expect(slotFace({}).id).toBe("display");
    expect(typeFace(undefined).id).toBe("display");
    expect(footerFace({}).id).toBe("body");
    expect(footerFace({ font: "display" }).id).toBe("display");
    expect(faceOf({}, "footer").id).toBe("body");
    expect(faceOf({}, "numeral").id).toBe("body");
    expect(faceOf({}, "badge").id).toBe("display");
  });
});

describe("a shrunk measured line keeps its baseline in its OWN face", () => {
  it("slotTextDy reads the slot's face: unchanged on a display slot, MPlantin's box on a body one", () => {
    const slot = { sizePct: 0.05, fit: "measured" as const, dy: 0.001 };
    // Not shrunk: the slot's own dy, whatever the face.
    expect(slotTextDy(slot, 0.05)).toBe(0.001);
    expect(slotTextDy({ ...slot, font: "body" }, 0.05)).toBe(0.001);
    // Shrunk: the baseline's drop for the face's line box.
    const shrunk = 0.04;
    expect(slotTextDy(slot, shrunk)).toBe(0.001 + -((1917 - 552) / 2 / 2048) * (shrunk - 0.05));
    expect(slotTextDy({ ...slot, font: "display" }, shrunk)).toBe(slotTextDy(slot, shrunk));
    expect(slotTextDy({ ...slot, font: "body" }, shrunk)).toBe(0.001 + -((774 - 225) / 2 / 1000) * (shrunk - 0.05));
  });
});

describe("the new profile fields are code-owned: a stored override cannot set them (skeptic pass)", () => {
  it("frame_profile_overrides' strict schema refuses a face, a prefix, a footer alignment and a symbol style — the row reads as no override", async () => {
    const { parseFrameProfileOverride, resolveFrameProfile } = await import("@/lib/cards/profile-override");
    const refused: unknown[] = [
      { title: { font: "body" } },
      { type: { font: "body" } },
      { footer: { font: "body" } },
      { footer: { prefix: "Illus. " } },
      { footer: { align: "center" } },
      { pt: { font: "body" } },
      { loyalty: { font: "body" } },
      { secondFace: { pt: { font: "body" } } },
      { adventure: { title: { font: "body" } } },
      { loyaltyRows: { badgeFont: "body" } },
      { chapters: { badge: { numeralFont: "display" } } },
      { symbolStyle: "modern" },
      // A face that is not registered could never arrive this way either.
      { title: { font: "matrix" } },
    ];
    for (const row of refused) expect(parseFrameProfileOverride(row), JSON.stringify(row)).toBeNull();
    // What the schema does accept (geometry) leaves every face where it was.
    const override = parseFrameProfileOverride({ title: { sizePct: 0.046 }, footer: { sizePct: 0.024, letterSpacingEm: 0.02 }, pt: { sizePct: 0.05 } });
    expect(override).not.toBeNull();
    const merged = resolveFrameProfile("m15", { m15: override! });
    const base = getFrameProfile("m15");
    for (const role of FACE_ROLES) expect(faceOf(merged, role).id, role).toBe(faceOf(base, role).id);
    expect(merged.footer?.align).toBe(base.footer?.align);
    expect(merged.footer?.prefix).toBeUndefined();
    expect(merged.symbolStyle).toBeUndefined();
  });
});
