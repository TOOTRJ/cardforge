import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameProfile } from "@/lib/cards/template-layout";
import { cardGlyphFields, type GlyphCheckValues } from "@/lib/validation/card-glyphs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.8.0 — the creator's "this character won't draw" check judges each
// single-line field in the face its FRAME draws it in (lib/cards/
// type-faces.ts). Every shipped profile: the display face, as before. A
// profile that sets a slot in the body face (a THROWAWAY one here): that
// field is judged by MPlantin's coverage.
// ---------------------------------------------------------------------------

const fixture = vi.hoisted(() => ({ patch: null as null | ((profile: never) => unknown) }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: Parameters<typeof real.getFrameProfile>[0]) => {
      const profile = real.getFrameProfile(template);
      return fixture.patch ? (fixture.patch(profile as never) as FrameProfile) : profile;
    },
  };
});

afterEach(() => {
  fixture.patch = null;
});

const VALUES: GlyphCheckValues = {
  title: "Probe",
  supertype: "Legendary",
  subtypes_text: "Wurm",
  rules_text: "",
  flavor_text: "",
  power: "5",
  toughness: "5",
  loyalty: "",
  defense: "",
  artist_credit: "Ada",
  footer_text: "Press",
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  has_back_face: false,
  back_face: { title: "", supertype: "", subtypes_text: "", rules_text: "", flavor_text: "", power: "", toughness: "", loyalty: "", defense: "" },
};
const faces = (v: GlyphCheckValues) => Object.fromEntries(cardGlyphFields(v).map((f) => [f.label, f.face]));
const SINGLE = { Name: "display", "Type line": "display", Stats: "display", Artist: "display", "Footer mark": "display" };

describe("cardGlyphFields reads each field's face from its frame", () => {
  it("every shipped template: the display face for the name, type line, stats, artist and footer mark — as before", () => {
    for (const template of [undefined, ...FRAME_TEMPLATE_VALUES]) {
      // The 1997 pair sets its type line and artist line in MPlantin (TODO
      // 4.10a); a clean download's footer text is its © slot's, MPlantin too.
      const want =
        template === "retro" || template === "retroland"
          ? { ...SINGLE, "Type line": "body", Artist: "body", "Footer mark": "body" }
          : SINGLE;
      expect(faces({ ...VALUES, frame_style: template ? { template } : null }), String(template)).toMatchObject(want);
    }
  });

  it("a slot a profile sets in the body face is judged by MPlantin's coverage", () => {
    fixture.patch = (profile: FrameProfile) => ({
      ...profile,
      type: { ...profile.type, font: "body" },
      pt: profile.pt && { ...profile.pt, font: "body" },
      footer: profile.footer && { ...profile.footer, font: "body" },
    });
    expect(faces({ ...VALUES, frame_style: { template: "retro" } })).toMatchObject({
      Name: "display",
      "Type line": "body",
      Stats: "body",
      Artist: "body",
      "Footer mark": "body",
    });
    // A collector card's artist is the collector line's own display small
    // caps and its mark the body face, whatever the footer slot says.
    expect(faces({ ...VALUES, frame_style: { template: "m15", collector: "2015" } })).toMatchObject({ Artist: "display", "Footer mark": "body" });
  });
});
