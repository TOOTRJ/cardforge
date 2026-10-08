import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { normalizeFrameTemplate, retiredFrameTemplate } from "@/lib/cards/card-display";
import { staleTemplateFilter } from "@/lib/cards/frame-override-stale";
import { classifyForSweep, isRenderStale } from "@/lib/cards/layout-version";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyOf, normalizeAnatomy } from "@/lib/cards/anatomy";
import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import { dfcBodyOf, isDfcBackBody, templateHasBackFace } from "@/lib/cards/dfc";
import { cardPageName } from "@/lib/cards/emblem";
import { frameGateError } from "@/lib/cards/frame-availability";
import { frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { resolveFrameProfile } from "@/lib/cards/profile-override";
import { kindFromCard, templateRefusesKind } from "@/lib/creator/card-kinds";
import { hidesCost } from "@/lib/creator/steps";
import { createCardSchema, frameStyleSchema } from "@/lib/validation/card";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import {
  DEFAULT_FRAME_TEMPLATE,
  ERA_TYPE_FRAME,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
  RETIRED_FRAME_TEMPLATES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.54 — the Alpha token frame is retired (owner decision 2026-09-29; 0
// production cards on it, 2026-10-07). The template left every list, and a
// value that still says "alphatoken" — a row on a dev / preview / local
// database, a draft, a remix payload, a URL parameter — READS as the M15
// token: `m15token`, or `m15tokentext` when the card has rules or flavour
// text. The trap this pins: an UNKNOWN template draws DEFAULT_FRAME_TEMPLATE
// (m15, the creature frame), so the map must answer before that fallback.
// ---------------------------------------------------------------------------

const KNOWN = FRAME_TEMPLATE_VALUES as readonly string[];

describe("the retired-template map", () => {
  it("names only values that are gone, and sends them to templates that exist", () => {
    expect([...RETIRED_FRAME_TEMPLATES.keys()]).toEqual(["alphatoken"]);
    for (const [retired, to] of RETIRED_FRAME_TEMPLATES) {
      expect(KNOWN, retired).not.toContain(retired);
      expect(KNOWN).toContain(to.bare);
      expect(KNOWN).toContain(to.withText);
      expect(retired in FRAME_TEMPLATE_LABELS).toBe(false);
      expect(retired in FRAME_TEMPLATE_SET).toBe(false);
    }
    expect(RETIRED_FRAME_TEMPLATES.get("alphatoken")).toEqual({ bare: "m15token", withText: "m15tokentext" });
  });

  it("left the picker, and its masters left git", () => {
    expect(ERA_TYPE_FRAME.classic?.token).toBeUndefined();
    expect(Object.values(ERA_TYPE_FRAME).flatMap((byType) => Object.values(byType ?? {}))).not.toContain("alphatoken");
    expect(existsSync(join(process.cwd(), "public/frames/alphatoken"))).toBe(false);
  });
});

describe("normalizeFrameTemplate on a retired value", () => {
  it("reads as the M15 token without text — never the default creature frame", () => {
    expect(normalizeFrameTemplate("alphatoken")).toBe("m15token");
    expect(normalizeFrameTemplate("alphatoken", null)).toBe("m15token");
    expect(normalizeFrameTemplate("alphatoken", {})).toBe("m15token");
    expect(normalizeFrameTemplate("alphatoken", { rulesText: null, flavorText: "" })).toBe("m15token");
    expect(normalizeFrameTemplate("alphatoken", { rulesText: "  \n", flavorText: " " })).toBe("m15token");
    expect(normalizeFrameTemplate("alphatoken", { rules_text: "", flavor_text: null })).toBe("m15token");
  });

  it("reads as the M15 token WITH a text box when the card has rules or flavour text", () => {
    expect(normalizeFrameTemplate("alphatoken", { rulesText: "Flying" })).toBe("m15tokentext");
    expect(normalizeFrameTemplate("alphatoken", { rulesText: null, flavorText: "Enemies of the heir, beware." })).toBe("m15tokentext");
    // A stored row's columns.
    expect(normalizeFrameTemplate("alphatoken", { rules_text: "Haste", flavor_text: null })).toBe("m15tokentext");
    expect(normalizeFrameTemplate("alphatoken", { rules_text: null, flavor_text: "x" })).toBe("m15tokentext");
  });

  it("leaves every current template alone, with or without text", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      expect(normalizeFrameTemplate(t), t).toBe(t);
      expect(normalizeFrameTemplate(t, { rulesText: "Flying" }), t).toBe(t);
      expect(retiredFrameTemplate(t), t).toBeNull();
    }
  });

  it("still sends an unknown, empty or legacy value to the default frame", () => {
    for (const value of ["regular", "nope", "ALPHATOKEN", "alphatoken ", "", null, undefined]) {
      expect(normalizeFrameTemplate(value), String(value)).toBe(DEFAULT_FRAME_TEMPLATE);
      expect(normalizeFrameTemplate(value, { rulesText: "Flying" }), String(value)).toBe(DEFAULT_FRAME_TEMPLATE);
      expect(retiredFrameTemplate(value), String(value)).toBeNull();
    }
    expect(DEFAULT_FRAME_TEMPLATE).toBe("m15");
  });
});

describe("a payload that still names the retired template", () => {
  it("parses as the M15 token instead of failing — anything else unknown is still refused", () => {
    expect(frameStyleSchema.parse({ template: "alphatoken", finish: "regular" })).toMatchObject({ template: "m15token" });
    expect(frameStyleSchema.safeParse({ template: "regular" }).success).toBe(false);
    expect(frameStyleSchema.safeParse({ template: "nope" }).success).toBe(false);
    expect(frameStyleSchema.parse({ template: "m15tokentext" })).toMatchObject({ template: "m15tokentext" });
  });

  it("…on a whole card too", () => {
    const parsed = createCardSchema.safeParse({
      title: "Goblin",
      card_type: "token",
      frame_style: { template: "alphatoken" },
    });
    // Other fields may be required; the frame style must not be the reason.
    const issues = parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] === "frame_style");
    expect(issues).toEqual([]);
  });
});

describe("a stored row that still names it", () => {
  const card = (over: Partial<CardPreviewData> = {}) =>
    ({
      title: "Goblin",
      cost: null,
      cardType: "token",
      supertype: "Creature",
      subtypes: ["Goblin"],
      rarity: "common",
      colorIdentity: ["red"],
      rulesText: "",
      flavorText: "",
      power: "1",
      toughness: "1",
      loyalty: null,
      defense: null,
      artistCredit: null,
      artUrl: null,
      frameStyle: { template: "alphatoken" },
      ...over,
    }) as unknown as CardPreviewData;

  it("bakes from the M15 token's assets — the bare frame, or the text box with text", () => {
    const sameAs = (template: string, over: Partial<CardPreviewData> = {}) =>
      frameAssetPathsFor(card({ ...over, frameStyle: { template } as CardPreviewData["frameStyle"] }));
    expect(frameAssetPathsFor(card())).toEqual(sameAs("m15token"));
    expect(frameAssetPathsFor(card({ rulesText: "Haste" }))).toEqual(sameAs("m15tokentext", { rulesText: "Haste" }));
    for (const path of [...frameAssetPathsFor(card()), ...frameAssetPathsFor(card({ rulesText: "Haste" }))]) {
      expect(path).not.toContain("alphatoken");
    }
    // And never the creature frame's text box: both hide the cost.
    expect(getFrameProfile(normalizeFrameTemplate("alphatoken")).hideCost).toBe(true);
    expect(getFrameProfile(normalizeFrameTemplate("alphatoken", { rulesText: "Haste" })).hideCost).toBe(true);
  });

  it("is judged for re-bakes as the frame it draws, text and all", () => {
    const row = (template: string, rules_text: string | null) => ({
      layout_version: 33,
      rendered_image_url: "https://example.test/render.png",
      frame_style: { template },
      card_type: "token",
      supertype: "Creature",
      subtypes: ["Goblin"],
      power: "1",
      toughness: "1",
      rules_text,
      flavor_text: null,
      rarity: "common",
      set_icon_url: null,
      set_icon_code: null,
      title: "Goblin",
      color_identity: ["red"],
      art_url: null,
      loyalty: null,
      defense: null,
      back_face: null,
      face_content: null,
    });
    for (const text of [null, "Haste"]) {
      const as = text ? "m15tokentext" : "m15token";
      expect(classifyForSweep(row("alphatoken", text)), String(text)).toBe(classifyForSweep(row(as, text)));
      expect(isRenderStale(33, "alphatoken", undefined, undefined, row("alphatoken", text))).toBe(
        isRenderStale(33, as, undefined, undefined, row(as, text)),
      );
    }
  });

  it("is marked stale by an override of the frame it draws on, not by the default frame's", () => {
    for (const target of ["m15token", "m15tokentext"]) {
      const filter = staleTemplateFilter(target);
      expect(filter).toEqual({
        kind: "or",
        expression: `frame_style->>template.eq.${target},frame_style->>template.eq.alphatoken`,
      });
    }
    const m15 = staleTemplateFilter("m15");
    expect(m15.kind).toBe("or");
    if (m15.kind !== "or") return;
    // In the "known" exclusion list, so it is not taken for a legacy m15 row.
    expect(m15.expression).toMatch(/not\.in\.\([^)]*\balphatoken\b[^)]*\)/);
    expect(m15.expression).not.toContain("template.eq.alphatoken");
    // Every other template is untouched.
    expect(staleTemplateFilter("saga")).toEqual({ kind: "eq", template: "saga" });
  });
});

// Readers that are handed the STORED value as it is and judge the frame from
// it — none may fall to the creature frame for a retired value. (Before the
// profile lookup read the map, getFrameProfile("alphatoken") was m15's: the
// anatomy rules then kept a crown and a stamp for a token row.)
describe("a reader handed the stored value raw", () => {
  const token = { cardType: "token", supertype: "Creature", subtypes: ["Goblin"], title: "Goblin", rulesText: null };

  it("the profile lookup answers the M15 token's, never m15's", () => {
    expect(getFrameProfile("alphatoken")).toBe(getFrameProfile("m15token"));
    expect(getFrameProfile("alphatoken")).not.toBe(getFrameProfile("m15"));
    // An unknown or legacy value is still the default frame's.
    for (const value of ["regular", "nope", "", undefined]) expect(getFrameProfile(value), String(value)).toBe(getFrameProfile("m15"));
    // An override stored under the retired key is not the replacement's.
    expect(resolveFrameProfile("m15token", { alphatoken: { title: { rect: { topPct: 9 } } } })).toEqual(resolveFrameProfile("m15token", {}));
  });

  it("the anatomy rules judge it as the token frame", () => {
    expect(frameAnatomyOf("alphatoken")).toEqual(frameAnatomyOf("m15token"));
    expect(frameAnatomyOf("alphatoken")).not.toEqual(frameAnatomyOf("m15"));
    const style = { template: "alphatoken", crown: true, stamp: "oval", twoColor: true } as never;
    expect(normalizeAnatomy(style, "alphatoken", "token")).toEqual(
      normalizeAnatomy({ ...(style as object), template: "alphatoken" } as never, "m15token", "token"),
    );
  });

  it("is a token frame to the kind rules and both save gates", () => {
    expect(kindFromCard("token", "alphatoken")).toBe("token");
    expect(kindFromCard(null, "alphatoken")).toBe(kindFromCard(null, "m15token"));
    expect(templateRefusesKind(normalizeFrameTemplate("alphatoken"), "token")).toBe(false);
    expect(frameKindGateError("alphatoken", token)).toBeNull();
    expect(frameKindGateError("alphatoken", { ...token, cardType: "creature" })).toBe(frameKindGateError("m15token", { ...token, cardType: "creature" }));
    expect(frameKindUpdateGateError({ existingTemplate: "alphatoken", nextTemplate: undefined, existing: token, next: { ...token, title: "Goblin Scout" } })).toBeNull();
    // The verification gate asks for the M15 token's tick — not m15's.
    expect(frameGateError("alphatoken", ["red"], new Set(["m15token/r"]))).toBeNull();
    expect(frameGateError("alphatoken", ["red"], new Set(["m15/r"]))).not.toBeNull();
    expect(frameGateError("alphatoken", ["red"], new Set(["alphatoken/r"]))).not.toBeNull();
  });

  it("is portrait, hides its cost, has no second face and is nobody's back body", () => {
    expect(isLandscapeFrame({ template: "alphatoken" })).toBe(false);
    expect(hidesCost("alphatoken")).toBe(true);
    expect(dfcBodyOf("alphatoken")).toBeNull();
    expect(templateHasBackFace("alphatoken")).toBe(false);
    expect(isDfcBackBody("alphatoken")).toBe(false);
    expect(cardPageName("Goblin", "token", { frameTemplate: "alphatoken", backTitle: "Other" })).toBe(
      cardPageName("Goblin", "token", { frameTemplate: "m15token", backTitle: "Other" }),
    );
  });
});
