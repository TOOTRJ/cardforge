import {
  CARD_KIND_VALUES,
  FRAME_COLOR_KEYS,
  KIND_DEFS,
  framesForKind,
  isRowDress,
  isTypeWordDress,
  kindHasAvailableFrame,
  type CardKind,
  type FrameChoice,
  type FrameColorKey,
} from "@/lib/creator/card-kinds";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { COLOR_KEY_WORDS } from "@/components/cards/frame-layer";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import {
  FRAME_ERA_HINTS,
  FRAME_ERA_LABELS,
  FRAME_SET_LABELS,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  type FrameEra,
  type FrameTemplate,
} from "@/types/card";

// ---------------------------------------------------------------------------
// The public frame gallery (/frames, TODO NV8): every frame the creator
// offers, grouped the way its Card step groups them, with the colours each
// is verified in and an example card.
//
// No taxonomy of its own. The frames are the creator's own answer —
// `framesForKind` for every kind whose chip is lit (`kindHasAvailableFrame`),
// a frame counted once it is verified in a colour (frame_reviews, the
// creator's only gate) — and the groups are the picker's: a FrameChoice's
// `group` and `era`. A frame several kinds wear is listed once, under the
// most central role it plays (the artifact frame is the Artifact kind's
// standard AND a creature's variation: it sits with the standards).
//
// Listed: what the Card step offers as a tile. Left out, as the picker
// leaves them out: a dress the card follows onto by itself — the artifact
// token frames (the Token's Artifact word picks them, isTypeWordDress), the
// tall borderless walker box (the ability rows pick it, isRowDress) — and a
// double-faced BACK body (derived from the front, never a pick). Each comes
// with the frame it dresses.
//
// Pure and client-safe; the reads are lib/frames/frame-gallery-queries.ts.
// ---------------------------------------------------------------------------

/** The page's groups, in the order it shows them: the current frame and its
 *  variations first, the layouts and showcases, then the older borders from
 *  newest to oldest. Every one is a picker group — an era section of the
 *  Frame step, the layout kinds, the Variations section, the showcases. */
export const FRAME_GALLERY_SECTION_IDS = [
  "m15",
  "variations",
  "layouts",
  "showcase",
  "modern",
  "retro",
  "classic",
] as const;
export type FrameGallerySectionId = (typeof FRAME_GALLERY_SECTION_IDS)[number];

type SectionCopy = {
  title: string;
  /** One line under the heading: what the group is. */
  hint: string;
  /** Where the creator keeps these frames. */
  whereInCreator: string;
};

const eraSection = (era: Exclude<FrameEra, "showcase">, whereInCreator: string): SectionCopy => ({
  title: FRAME_ERA_LABELS[era],
  hint: FRAME_ERA_HINTS[era],
  whereInCreator,
});

export const FRAME_GALLERY_SECTIONS: Readonly<Record<FrameGallerySectionId, SectionCopy>> = {
  m15: eraSection("m15", "In the creator: pick the card type; these are its standard frames."),
  variations: {
    title: "Variations",
    hint: "The 2015 frame in another dress: borderless, snow, Universes Beyond and more",
    whereInCreator: "In the creator: pick the card type, then a dress under Variations.",
  },
  layouts: {
    title: "Card layouts",
    hint: "Sagas, adventures, two halves and double-faced cards",
    whereInCreator: "In the creator: the card type brings its frame (Saga, Adventure, Transform…).",
  },
  showcase: {
    title: FRAME_ERA_LABELS.showcase,
    hint: FRAME_ERA_HINTS.showcase,
    whereInCreator: "In the creator: under Variations, named for the set that printed it.",
  },
  modern: eraSection("modern", "In the creator: pick the card type, then this border under Frame."),
  retro: eraSection("retro", "In the creator: pick the card type, then this border under Frame."),
  classic: eraSection("classic", "In the creator: pick the card type, then this border under Frame."),
};

/** Below this many frames the page is thin (a database that answered
 *  nothing): noindex, and out of the sitemap. */
export const FRAME_GALLERY_MIN_INDEXED = 3;

/** The anchor of a frame's tile (and its JSON-LD entry). */
export function frameAnchorId(template: FrameTemplate): string {
  return `frame-${template}`;
}

/**
 * Where "Start with this frame" goes. The creator takes no starting frame
 * from its URL today (the admin walkthrough's `template` is admin-only, and
 * the guest creator never reads searchParams), so every frame opens the
 * creator itself; the section's `whereInCreator` line says where the frame
 * is. Once the creator reads one, this is the one place to pass it.
 */
export function startWithFrameHref(template: FrameTemplate): string {
  void template;
  return "/create";
}

export type FrameGalleryEntry = {
  template: FrameTemplate;
  section: FrameGallerySectionId;
  /** The picker's label, set-relative ("Borderless", "Land"). */
  name: string;
  /** The label with its era or set in front ("M15 (2015) Borderless") — for
   *  a reader without the tile's context (alt text, JSON-LD, a link's name). */
  fullName: string;
  /** The era, or a showcase's set ("The Lord of the Rings"). */
  origin: string;
  /** The kinds whose Card step offers the frame, in the kind picker's order. */
  kinds: CardKind[];
  /** The colours it is verified in (FRAME_COLOR_KEYS order). */
  colorKeys: FrameColorKey[];
};

export type FrameGallerySection = {
  id: FrameGallerySectionId;
  entries: FrameGalleryEntry[];
};

/** How central a role is when several kinds list one frame: a kind's own
 *  standard, then its layout, then a variation, then a showcase. */
const ROLE_RANK: Record<FrameChoice["group"], number> = { standard: 0, layout: 1, skin: 2, showcase: 3 };

function sectionOf(choice: Pick<FrameChoice, "group" | "era">): FrameGallerySectionId {
  if (choice.group === "showcase" || choice.era === "showcase") return "showcase";
  if (choice.group === "layout") return "layouts";
  // A variation of the 2015 frame; one of an older border would sit with
  // its border (none exists today).
  if (choice.group === "skin" && choice.era === "m15") return "variations";
  return choice.era;
}

/**
 * Every frame the creator offers for `verifiedKeys`, grouped and in the
 * picker's order (a group's frames in the order the kinds first offer them).
 * Empty groups are dropped.
 */
export function buildFrameGallery(verifiedKeys: ReadonlySet<string>): FrameGallerySection[] {
  const found = new Map<FrameTemplate, { choice: FrameChoice; kinds: CardKind[] }>();
  for (const kind of CARD_KIND_VALUES) {
    // A dark kind chip can't be picked, so neither can its frames (a
    // double-faced front whose default back isn't verified yet).
    if (!kindHasAvailableFrame(kind, verifiedKeys)) continue;
    for (const choice of framesForKind(kind, verifiedKeys)) {
      if (choice.availableColorKeys.length === 0) continue;
      if (isTypeWordDress(kind, choice.template) || isRowDress(kind, choice.template)) continue;
      const seen = found.get(choice.template);
      if (!seen) {
        found.set(choice.template, { choice, kinds: [kind] });
        continue;
      }
      if (!seen.kinds.includes(kind)) seen.kinds.push(kind);
      if (ROLE_RANK[choice.group] < ROLE_RANK[seen.choice.group]) seen.choice = choice;
    }
  }

  const bySection = new Map<FrameGallerySectionId, FrameGalleryEntry[]>();
  for (const [template, { choice, kinds }] of found) {
    const section = sectionOf(choice);
    const showcase = section === "showcase";
    const list = bySection.get(section) ?? [];
    list.push({
      template,
      section,
      name: FRAME_TEMPLATE_LABELS[template],
      fullName: describeFrame(template),
      origin: showcase ? FRAME_SET_LABELS[FRAME_TEMPLATE_SET[template]] : FRAME_ERA_LABELS[choice.era],
      kinds,
      colorKeys: [...choice.availableColorKeys],
    });
    bySection.set(section, list);
  }
  return FRAME_GALLERY_SECTION_IDS.filter((id) => bySection.has(id)).map((id) => ({
    id,
    entries: bySection.get(id)!,
  }));
}

/** Every entry of the gallery, in page order. */
export function galleryEntries(sections: readonly FrameGallerySection[]): FrameGalleryEntry[] {
  return sections.flatMap((section) => section.entries);
}

/** "Creature, Instant, Sorcery" — the kinds' picker labels. */
export function kindsLine(kinds: readonly CardKind[]): string {
  return kinds.map((kind) => KIND_DEFS[kind].label).join(", ");
}

/** "Verified in white, blue and multicolor" / "Verified in all seven
 *  colours" — what the colour dots say to a screen reader. */
export function verifiedColorsPhrase(colorKeys: readonly FrameColorKey[]): string {
  if (colorKeys.length === FRAME_COLOR_KEYS.length) return "Verified in all seven colours";
  const words = colorKeys.map((key) => COLOR_KEY_WORDS[key] ?? key);
  if (words.length <= 1) return `Verified in ${words[0] ?? "no colour yet"}`;
  return `Verified in ${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The colour an empty master is shown in when a frame has no example: the
 *  picker's default (blue, FrameThumb's `colorKey`) where it is verified,
 *  else the first verified colour — colourless last, since several
 *  colourless masters are see-through. */
export function placeholderColorKey(colorKeys: readonly FrameColorKey[]): FrameColorKey {
  const order: readonly FrameColorKey[] = ["u", "w", "b", "r", "g", "m", "c"];
  return order.find((key) => colorKeys.includes(key)) ?? "u";
}

/** The columns an example is read with — what the tile draws and links. */
export const FRAME_EXAMPLE_COLUMNS =
  "id, slug, title, owner_id, visibility, card_type, rarity, color_identity, frame_style, rendered_image_url, rendered_thumb_url, rendered_back_thumb_url";

export type FrameExampleRow = {
  id: string;
  slug: string;
  title: string;
  owner_id: string;
  visibility: string;
  card_type: string | null;
  rarity: string | null;
  color_identity: string[] | null;
  frame_style: unknown;
  rendered_image_url: string | null;
  rendered_thumb_url: string | null;
  rendered_back_thumb_url: string | null;
};

/** The template a row is stored on, exactly as stored (never normalised: a
 *  card with no template, or a retired one, draws on another frame than it
 *  names and is no example of any). */
function storedTemplateOf(row: Pick<FrameExampleRow, "frame_style">): string | null {
  const style = row.frame_style;
  if (!style || typeof style !== "object") return null;
  const template = (style as { template?: unknown }).template;
  return typeof template === "string" ? template : null;
}

/**
 * The example card of each template: the first row (rows arrive in
 * preference order — most liked first) that is PUBLIC, stored on that very
 * template, and has its own stored bake AND 600 px thumbnail (a tile never
 * draws the live preview or the HD PNG here). Unlisted and private rows
 * never qualify, whatever the read returned.
 */
export function pickFrameExamples<Row extends FrameExampleRow>(
  rows: readonly Row[],
  templates: Iterable<FrameTemplate>,
): Map<FrameTemplate, Row> {
  const wanted = new Set<string>(templates);
  const picked = new Map<FrameTemplate, Row>();
  for (const row of rows) {
    if (row.visibility !== "public") continue;
    const template = storedTemplateOf(row);
    if (!template || !wanted.has(template) || picked.has(template as FrameTemplate)) continue;
    const own = { ownerId: row.owner_id, cardId: row.id };
    if (!isStoredRenderUrl(row.rendered_image_url, own) || !isStoredRenderUrl(row.rendered_thumb_url, own)) continue;
    picked.set(template as FrameTemplate, row);
  }
  return picked;
}
