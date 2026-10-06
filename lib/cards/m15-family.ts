import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The M15-era family (TODO 4.20, layout v32): the frame templates whose name,
// type line, pips and set symbol print at the ONE set of display sizes in
// lib/cards/typography.ts (TITLE_SIZE_PCT, TYPE_SIZE_PCT, COST_DISC_PCT,
// SET_SYMBOL_BOX_PCT, the adventure panel's): the M15 profile and every
// profile that spreads it (land, snow, artifact, devoid, borderless, extended
// art, expedition, Nyx, adventure, the full-art and textless frames, the
// full-art basics), plus the M15-era frames with title and type slots of
// their own (planeswalker, token, saga, flip, aftermath) — and the battle,
// the one LANDSCAPE member: its sizes are the same px on the page, so as
// fractions of its 2100 px width they are the constants through
// `displayPct(…, "landscape")` (× 5/7), never the bare constants (which
// would draw them 1.4× the size).
//
// Split is M15-era too but is NOT in it: the prints set every line of a
// split half smaller than a regular card's (a 76 px name, a 53 px type line
// on its thin bar, 68 px pips, a 48 px symbol box — the SPLIT_* constants in
// lib/cards/typography.ts, measured on MH2 #123 / #60 and TSR #161 / #186;
// TODO 4.21b).
//
// The profile tests read this list. Layout v32's template scope is a FROZEN
// copy in lib/cards/layout-version.ts (a test keeps the two equal at v32):
// a template that joins the family later brings its own bump (battle:
// layout v42, with its Card Conjurer master) — or, a NEW template no card
// was ever baked on (4.49 (b)'s text-box tokens, 4.34's borderless land,
// 4.48's full-art tokens), none.
// ---------------------------------------------------------------------------

export const M15_FAMILY_TEMPLATES: readonly FrameTemplate[] = [
  // The Card Conjurer M15 masters (4.4) and their skins.
  "m15",
  "m15land",
  "m15snowland",
  "m15artifact",
  "m15snow",
  "m15devoid",
  "m15borderless",
  "m15borderlessartifact",
  "m15pw",
  // The borderless planeswalkers (TODO 4.33): new templates with no stored
  // card, so they joined without a bump (m15pw's slots and sizes).
  "m15borderlesspw",
  "m15borderlesspwtall",
  "m15token",
  "m15tokenartifact",
  // The text-box tokens (TODO 4.49 (b)): new templates with no stored card,
  // so they joined without a bump.
  "m15tokentext",
  "m15tokenartifacttext",
  // The borderless land (TODO 4.34): a new template, no stored card — it
  // joined without a bump too.
  "m15borderlessland",
  // The emblem (TODO 4.52, CC 'Planeswalker Emblems'): a new template, no
  // stored card, so it joined without a bump.
  "emblem",
  // The full-art tokens (TODO 4.48 / 4.50): new templates with no stored
  // card — CC's name and type sizes are the family's (0.0381 H =
  // TITLE_SIZE_PCT, 0.0324 H = TYPE_SIZE_PCT) — so they joined without a
  // bump too.
  "m20token",
  "m20tokentext",
  "m20tokentall",
  "m20tokenartifact",
  "m20tokenartifacttext",
  "m20tokenartifacttall",
  // The transform bodies (TODO 5.1a, CC's 'Transform' packs): new
  // templates, no stored card — CC's name and type sizes are the family's
  // — so they joined without a bump too.
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
  // The modal bodies (TODO 5.1b, CC's 'Modal Regular' pack): new
  // templates, no stored card — the same family sizes — so they joined
  // without a bump too.
  "m15mdfcfront",
  "m15mdfcback",
  "m15mdfclandfront",
  "m15mdfclandback",
  // The battle (TODO 4.21b, CC's 'Battle' pack; layout v42): the family's
  // sizes on a landscape card — it joined WITH its bump (0 stored public or
  // unlisted cards).
  "battle",
  // M15-era frames on MSE masters.
  "saga",
  "adventure",
  "flip",
  "aftermath",
  "extendedart",
  "expeditionland",
  "nyx",
  "fullart",
  "m15textless",
  "m15textlessland",
  // The full-art basics (Card Conjurer 'Fullart Basics (2022)', 4.39).
  "m15fullartland",
  "fullartland",
];
