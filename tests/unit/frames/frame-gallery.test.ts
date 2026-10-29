import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  FRAME_COLOR_KEYS,
  framesForKind,
  isRowDress,
  isTypeWordDress,
  kindHasAvailableFrame,
} from "@/lib/creator/card-kinds";
import {
  FRAME_GALLERY_SECTION_IDS,
  FRAME_GALLERY_SECTIONS,
  buildFrameGallery,
  galleryEntries,
  kindsLine,
  pickFrameExamples,
  placeholderColorKey,
  creatorHrefForFrame,
  verifiedColorsPhrase,
  type FrameExampleRow,
} from "@/lib/frames/frame-gallery";
import { FRAME_PLACEHOLDER_SAMPLE_ART } from "@/components/frames/frame-master-placeholder";
import { FRAME_THUMB_SAMPLE_ART } from "@/components/creator/frame-pickers";
import { FRAME_ERA_LABELS, FRAME_SET_LABELS, FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The frame gallery's data (/frames, TODO NV8): the creator's own frames and
// groups — never a second taxonomy — and the example cards, public only.
// ---------------------------------------------------------------------------

/** Every combo verified: the whole offering. */
const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((c) => `${t}/${c}`)));
/** { template: "wub" } → verified combo keys. */
const keysOf = (combos: Record<string, string>) =>
  new Set(Object.entries(combos).flatMap(([template, colours]) => [...colours].map((c) => `${template}/${c}`)));

const entryOf = (template: FrameTemplate, keys: ReadonlySet<string> = ALL) =>
  galleryEntries(buildFrameGallery(keys)).find((entry) => entry.template === template);

describe("the frames are the creator's (buildFrameGallery)", () => {
  it("lists every frame a lit kind chip offers as a tile — once each — and nothing else", () => {
    const offered = new Set<FrameTemplate>();
    for (const kind of CARD_KIND_VALUES) {
      if (!kindHasAvailableFrame(kind, ALL)) continue;
      for (const choice of framesForKind(kind, ALL)) {
        if (isTypeWordDress(kind, choice.template) || isRowDress(kind, choice.template)) continue;
        offered.add(choice.template);
      }
    }
    const listed = galleryEntries(buildFrameGallery(ALL)).map((entry) => entry.template);
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(listed)).toEqual(offered);
  });

  it("each frame names kinds whose picker really offers it", () => {
    for (const entry of galleryEntries(buildFrameGallery(ALL))) {
      expect(entry.kinds.length, entry.template).toBeGreaterThan(0);
      for (const kind of entry.kinds) {
        expect(
          framesForKind(kind, ALL).some((choice) => choice.template === entry.template),
          `${entry.template} on ${kind}`,
        ).toBe(true);
      }
    }
  });

  it("leaves out what a card follows onto by itself: the artifact token dress, the tall walker box, a back body", () => {
    const listed = new Set(galleryEntries(buildFrameGallery(ALL)).map((entry) => entry.template));
    for (const template of ["m15tokenartifact", "m20tokenartifact", "m15borderlesspwtall", "m15dfcback", "m15mdfcback"] as const) {
      expect(listed.has(template), template).toBe(false);
    }
  });

  it("groups as the picker does: era standards, layouts, variations, showcases — in the page's order", () => {
    const sections = buildFrameGallery(ALL);
    expect(sections.map((section) => section.id)).toEqual(
      FRAME_GALLERY_SECTION_IDS.filter((id) => sections.some((section) => section.id === id)),
    );
    expect(entryOf("m15")?.section).toBe("m15");
    expect(entryOf("retro")?.section).toBe("retro");
    expect(entryOf("modernland")?.section).toBe("modern");
    expect(entryOf("agclassic")?.section).toBe("classic");
    expect(entryOf("saga")?.section).toBe("layouts");
    expect(entryOf("m15dfcfront")?.section).toBe("layouts");
    expect(entryOf("m15borderless")?.section).toBe("variations");
    expect(entryOf("extendedart")?.section).toBe("variations");
    expect(entryOf("lotr")?.section).toBe("showcase");
  });

  it("a frame several kinds wear sits with its most central role, naming every kind", () => {
    // The artifact frame: the Artifact kind's standard, a creature's variation.
    const artifact = entryOf("m15artifact")!;
    expect(artifact.section).toBe("m15");
    expect(artifact.kinds).toEqual(expect.arrayContaining(["creature", "artifact"]));
    expect(kindsLine(entryOf("m15")!.kinds)).toBe("Creature, Instant, Sorcery, Enchantment");
  });

  it("names a frame as the picker does, with its era — or a showcase's set", () => {
    expect(entryOf("m15borderless")).toMatchObject({ name: "Borderless", origin: FRAME_ERA_LABELS.m15, fullName: "M15 (2015) Borderless" });
    expect(entryOf("retroland")).toMatchObject({ name: "Land", origin: FRAME_ERA_LABELS.retro });
    expect(entryOf("lotr")).toMatchObject({ origin: FRAME_SET_LABELS.lotr });
  });

  it("counts a frame once it is verified in a colour, and lists exactly those colours", () => {
    const keys = keysOf({ m15: "wu", retro: "c" });
    expect(entryOf("m15", keys)?.colorKeys).toEqual(["w", "u"]);
    expect(entryOf("retro", keys)?.colorKeys).toEqual(["c"]);
    expect(entryOf("m15borderless", keys)).toBeUndefined();
    expect(buildFrameGallery(new Set())).toEqual([]);
  });

  it("lists only the colours the kind can save: an emblem is colourless whatever key its master is published under", () => {
    // CR 114: every emblem saves ["colorless"] (lib/cards/emblem.ts), and the
    // creator resolves the emblem kind's frame in `c` (frameColorKeyForKind).
    expect(entryOf("emblem")?.colorKeys).toEqual(["c"]);
    expect(verifiedColorsPhrase(entryOf("emblem")!.colorKeys)).toBe("Verified in colorless");
    expect(entryOf("emblem", keysOf({ m15: "u", emblem: "wubrgmc" }))?.colorKeys).toEqual(["c"]);
    // Published in colours but not in `c`: no emblem can be saved on it.
    expect(entryOf("emblem", keysOf({ m15: "u", emblem: "wubrgm" }))).toBeUndefined();
    // Every other kind keeps the frame's verified colours.
    expect(entryOf("m15")?.colorKeys).toEqual([...FRAME_COLOR_KEYS]);
  });

  it("a double-faced front waits for its kind's chip — its default back verified too", () => {
    expect(entryOf("m15dfcfront", keysOf({ m15: "w", m15dfcfront: "w" }))).toBeUndefined();
    expect(entryOf("m15dfcfront")).toBeDefined();
  });

  it("has copy for every group, the era groups in the picker's own words", () => {
    for (const id of FRAME_GALLERY_SECTION_IDS) {
      expect(FRAME_GALLERY_SECTIONS[id].title, id).toBeTruthy();
      expect(FRAME_GALLERY_SECTIONS[id].whereInCreator, id).toMatch(/^In the creator: /);
    }
    for (const era of ["m15", "modern", "retro", "classic"] as const) {
      expect(FRAME_GALLERY_SECTIONS[era].title).toBe(FRAME_ERA_LABELS[era]);
    }
    expect(FRAME_GALLERY_SECTIONS.showcase.title).toBe(FRAME_ERA_LABELS.showcase);
  });
});

describe("the tile's words", () => {
  it("says the verified colours to a screen reader, spelled as the site spells them (color)", () => {
    expect(verifiedColorsPhrase([...FRAME_COLOR_KEYS])).toBe("Verified in all seven colors");
    expect(verifiedColorsPhrase(["w", "u", "m"])).toBe("Verified in white, blue and multicolor");
    expect(verifiedColorsPhrase(["c"])).toBe("Verified in colorless");
    expect(verifiedColorsPhrase([])).toBe("Verified in no color yet");
  });

  it("shows an empty master in the picker's blue where it can, colourless last", () => {
    expect(placeholderColorKey(["w", "u", "c"])).toBe("u");
    expect(placeholderColorKey(["c", "g"])).toBe("g");
    expect(placeholderColorKey(["c"])).toBe("c");
  });

  it("'Make a card' opens the creator (it takes no starting frame from its URL yet)", () => {
    expect(creatorHrefForFrame("m15borderless")).toBe("/create");
  });

  it("the empty master's sample art is the picker's", () => {
    expect(FRAME_PLACEHOLDER_SAMPLE_ART).toBe(FRAME_THUMB_SAMPLE_ART);
  });
});

describe("the examples (pickFrameExamples)", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders";
  let n = 0;
  const row = (overrides: Partial<FrameExampleRow> & { template?: unknown } = {}): FrameExampleRow => {
    n += 1;
    const id = `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
    // `template: null` = a card that names no template (drawn on the default).
    const { template: named, ...rest } = overrides;
    const template = "template" in overrides ? named : "m15";
    return {
      id,
      slug: `card-${n}`,
      title: `Card ${n}`,
      owner_id: OWNER,
      visibility: "public",
      card_type: "creature",
      rarity: "rare",
      color_identity: ["red"],
      frame_style: template == null ? {} : { template },
      rendered_image_url: `${HOST}/${OWNER}/${id}.png?v=1`,
      rendered_thumb_url: `${HOST}/${OWNER}/${id}.thumb.webp?v=1`,
      rendered_back_thumb_url: null,
      ...rest,
    };
  };

  it("takes the first qualifying row per template, in the order the rows came", () => {
    const first = row();
    const second = row();
    const snow = row({ template: "m15snow" });
    const picked = pickFrameExamples([first, second, snow], ["m15", "m15snow"]);
    expect(picked.get("m15")).toBe(first);
    expect(picked.get("m15snow")).toBe(snow);
  });

  it("never an unlisted or private card, whatever the read returned", () => {
    const unlisted = row({ visibility: "unlisted" });
    const hidden = row({ visibility: "private" });
    const shown = row();
    expect(pickFrameExamples([unlisted, hidden], ["m15"]).size).toBe(0);
    expect(pickFrameExamples([unlisted, hidden, shown], ["m15"]).get("m15")).toBe(shown);
  });

  it("never a card of an excluded (staff) owner — the next qualifying row instead, or none", () => {
    const STAFF = "33333333-3333-4333-8333-333333333333";
    const staff = row({ owner_id: STAFF });
    staff.rendered_image_url = `${HOST}/${STAFF}/${staff.id}.png?v=1`;
    staff.rendered_thumb_url = `${HOST}/${STAFF}/${staff.id}.thumb.webp?v=1`;
    const community = row();
    // Qualifies when nobody is excluded…
    expect(pickFrameExamples([staff, community], ["m15"]).get("m15")).toBe(staff);
    // …never once its owner is.
    expect(pickFrameExamples([staff, community], ["m15"], new Set([STAFF])).get("m15")).toBe(community);
    expect(pickFrameExamples([staff], ["m15"], new Set([STAFF])).size).toBe(0);
  });

  it("only a card stored on that very template — not a default, a retired or an unasked one", () => {
    const rows = [row({ template: null }), row({ template: "alphatoken" }), row({ template: "m15snow" }), row({ frame_style: null })];
    expect(pickFrameExamples(rows, ["m15"]).size).toBe(0);
  });

  it("only with its own stored bake and 600 px thumb — never the live preview or a foreign picture", () => {
    const noThumb = row({ rendered_thumb_url: null });
    const foreign = row({ rendered_thumb_url: "https://example.com/pixel.webp" });
    const borrowed = row();
    borrowed.rendered_image_url = `${HOST}/${OWNER}/${noThumb.id}.png`;
    expect(pickFrameExamples([noThumb, foreign, borrowed], ["m15"]).size).toBe(0);
  });
});
