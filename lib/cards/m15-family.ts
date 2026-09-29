import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The M15-era family (TODO 4.20, layout v32): the frame templates whose name,
// type line, pips and set symbol print at the ONE set of display sizes in
// lib/cards/typography.ts (TITLE_SIZE_PCT, TYPE_SIZE_PCT, COST_DISC_PCT,
// SET_SYMBOL_BOX_PCT, the adventure panel's): the M15 profile and every
// profile that spreads it (land, snow, artifact, devoid, borderless, extended
// art, expedition, Nyx, adventure, the full-art and textless frames, the
// full-art basics), plus the M15-era frames with title and type slots of
// their own (planeswalker, token, saga, flip, aftermath).
//
// Split and battle are M15-era too but are NOT in it yet: their slots sit
// off the painted bars of their MSE masters, so their sizes ship with the
// Card Conjurer re-source (TODO 4.21) instead of carrying the misplacement
// into a sweep.
//
// The profile tests read this list. Layout v32's template scope is a FROZEN
// copy in lib/cards/layout-version.ts (a test keeps the two equal at v32):
// a template that joins the family later brings its own bump — or, a NEW
// template no card was ever baked on (4.49 (b)'s text-box tokens), none.
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
  "m15token",
  "m15tokenartifact",
  // The text-box tokens (TODO 4.49 (b)): new templates with no stored card,
  // so they joined without a bump.
  "m15tokentext",
  "m15tokenartifacttext",
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
