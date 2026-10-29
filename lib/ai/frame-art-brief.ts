// ---------------------------------------------------------------------------
// Art direction per frame (the AI dialog redesign, PR 1) — DATA. A frame
// whose look asks for a kind of picture (a stained-glass showcase, a
// borderless frame the art fills edge to edge, the 1993 frame's period
// painting) adds one sentence to the art prompt; every other frame adds
// nothing. The picture's SHAPE still comes from the frame's art window
// (artShapeForFace) — this is what goes in it.
//
// Words only: no franchise, set, world or artist names (the art prompt
// never names one).
// ---------------------------------------------------------------------------

import type { FrameTemplate } from "@/types/card";
import { tokenHeightOf } from "@/lib/cards/token-height";

const FULL_CARD =
  "The picture fills the WHOLE card edge to edge: keep the subject in the middle, with calm open space at the top where the name sits and in the lower third behind the text.";

const BASIC_LANDSCAPE =
  "A sweeping landscape of the land's terrain filling the whole card, no figures, with open sky at the top where the name sits.";

/** One family's brief, and the templates it covers. */
const FAMILIES: readonly { brief: string; templates: readonly FrameTemplate[] }[] = [
  {
    brief: "Paint it as an early-1990s fantasy card painting: traditional gouache or oil, a simple centred composition, a slightly storybook feel.",
    templates: ["agclassic", "alphaland"],
  },
  {
    brief: "Paint it as a late-1990s fantasy card painting: traditional oil or acrylic, rich color, a classic composition.",
    templates: ["retro", "retroland"],
  },
  {
    brief: "Paint it as a 2000s fantasy card painting: dramatic, detailed and painterly.",
    templates: ["modern", "modernland"],
  },
  {
    brief: FULL_CARD,
    templates: [
      "m15borderless",
      "m15borderlessartifact",
      "m15borderlessland",
      "m15borderlesspw",
      "m15borderlesspwtall",
      "fullart",
      "m15textless",
      "m15textlessland",
    ],
  },
  {
    brief: "A wide composition that runs to both side edges of the card, the subject centred.",
    templates: ["extendedart", "extendedartland"],
  },
  {
    brief: BASIC_LANDSCAPE,
    templates: ["m15fullartland", "fullartland", "m15fullartlandzen", "m15fullartlandsnc", "m15fullartlandthb"],
  },
  {
    brief: "A dramatic landscape of ancient, monumental stone filling the whole card, with open sky at the top.",
    templates: ["expeditionland", "expeditionlandbfz"],
  },
  {
    brief: "ONE picture under the whole frame: a ship or a world in deep space, the subject in the upper half — the lower half sits behind tinted text bands.",
    templates: ["m15station", "m15stationland", "extendedartstation", "m15borderlessstation"],
  },
  {
    brief: "Paint it as a leaded stained-glass window: jewel-toned glass panes, dark lead lines, light glowing through.",
    templates: ["stainedglass"],
  },
  {
    brief: "Paint it as a 1920s art deco poster: bold geometric shapes, gold and black, elegant streamlined figures.",
    templates: ["sncartdeco"],
  },
  {
    brief: "Paint it as an ornate illuminated manuscript: gold-leaf details, flat rich color, fine ink outlines.",
    templates: ["mysticalarchive"],
  },
  {
    brief: "Paint it as a storybook plate: warm, whimsical, like an illustration from an old fairy-tale book.",
    templates: ["enchantingtales"],
  },
  {
    brief: "An anime illustration: clean line art, cel shading, vivid color.",
    templates: ["bloomanime"],
  },
  {
    brief: "A pale, ghostly subject on a dark ground, wreathed in wisps of spectral flame, like an ink wash.",
    templates: ["tarkirghostfire"],
  },
  {
    brief: "A figure drawn in starlight against the night sky, like a constellation of stars joined by fine lines of light.",
    templates: ["nyx"],
  },
  {
    brief: "A case-file photograph: noir lighting, muted sepia tones, one subject as if pinned in a detective's dossier.",
    templates: ["dossier"],
  },
  {
    brief: "A front-page news photograph: high contrast, a halftone-printed look, one dramatic captured moment.",
    templates: ["breakingnews"],
  },
  {
    brief: "A classic tabletop-roleplaying sourcebook illustration: detailed pen and ink with watercolor washes.",
    templates: ["dndsourcebook"],
  },
  {
    brief: "An old parchment scroll's illustration: warm sepia, hand-inked detail.",
    templates: ["lotrscroll"],
  },
  // The saga and the two-part cards (the AI dialog, PR 2). Each is ONE
  // painting: split and aftermath show it in BOTH halves' windows (owner
  // 2026-10-28), an adventure's or Prepare's page is text on the card.
  {
    brief: "A tall storybook scene that captures the saga's tale in one moment: one strong subject composed for a tall, narrow panel.",
    templates: ["saga"],
  },
  {
    brief: "ONE picture shown in BOTH halves' windows: a single scene that holds both halves' ideas together, its subject centred so each window reads on its own.",
    templates: ["split", "aftermath"],
  },
  {
    brief: "Show the creature itself, mid-adventure — the spell on its page is told in words, not in the picture.",
    templates: ["adventure", "prepare"],
  },
  {
    brief: "Show the creature as it is now, with a hint of what it becomes when it flips.",
    templates: ["flip"],
  },
  // The double-faced bodies (the AI dialog, PR 3): TWO pictures, one per
  // face — each shows its own face's subject.
  {
    brief: "The FRONT face of a two-faced card: show this face's own subject as it is now — the back face has a picture of its own.",
    templates: ["m15dfcfront", "m15dfclandfront", "m15mdfcfront", "m15mdfclandfront"],
  },
  {
    brief: "The BACK face of a two-faced card: show this face's own subject — what the front became, or the other side of the choice — never the front's picture again.",
    templates: ["m15dfcback", "m15dfcbackleft", "m15dfclandback", "m15mdfcback", "m15mdfclandback"],
  },
  {
    brief: `${FULL_CARD} It is one face of a two-faced card: the other face has a picture of its own.`,
    templates: ["m15borderlessdfcfront", "m15borderlessdfcback", "m15borderlessmdfcfront", "m15borderlessmdfcback"],
  },
  {
    brief: "A tall storybook scene for one face of a two-faced saga: one strong subject composed for a tall, narrow panel — the other face has a picture of its own.",
    templates: ["sagadfcfront", "sagadfcback"],
  },
];

const BY_TEMPLATE: ReadonlyMap<FrameTemplate, string> = new Map(
  FAMILIES.flatMap((family) => family.templates.map((template) => [template, family.brief] as const)),
);

const TOKEN_SUBJECT = "A clear single subject — one creature or object, centred and readable at a glance — on a simple background.";

/** The art brief for a frame, or "" when the frame asks for nothing. */
export function frameArtBrief(template: FrameTemplate | string | null | undefined): string {
  if (!template) return "";
  const own = BY_TEMPLATE.get(template as FrameTemplate);
  if (own) return own;
  const token = tokenHeightOf(template);
  if (token) return token.design === "m20" ? `${TOKEN_SUBJECT} ${FULL_CARD}` : TOKEN_SUBJECT;
  return "";
}

/** Every template the table names (for the tests). */
export const ART_BRIEF_TEMPLATES: readonly FrameTemplate[] = [...BY_TEMPLATE.keys()];
