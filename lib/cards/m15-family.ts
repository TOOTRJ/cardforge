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
// layout v43, with its Card Conjurer master) — or, a NEW template no card
// was ever baked on (4.49 (b)'s text-box tokens, 4.34's borderless land,
// 4.48's full-art tokens), none.
// ---------------------------------------------------------------------------

export const M15_FAMILY_TEMPLATES: readonly FrameTemplate[] = [
  // The Card Conjurer M15 masters (4.4) and their skins.
  "m15",
  "m15land",
  "m15snowland",
  "m15artifact",
  // The Vehicle frame (TODO 4.5c): a new template, no stored card —
  // m15artifact's slots and sizes — so it joined without a bump.
  "m15vehicle",
  // The Nyx dress (TODO 4.7): a new template, no stored card — m15's slots
  // and sizes — so it joined without a bump.
  "m15nyx",
  // The station frame (TODO 4.27a): new templates on m15artifact's and
  // m15land's slots and sizes — no stored card, no bump.
  "m15station",
  "m15stationland",
  // …and its extended-art and borderless dresses (TODO 4.27a step 2): new
  // templates on extendedart's and m15borderlessartifact's slots and sizes
  // — no stored card, no bump.
  "extendedartstation",
  "m15borderlessstation",
  // The Universes Beyond frames (TODO 4.25): new templates, no stored card
  // — their M15 twins' slots and sizes — so they joined without a bump.
  "m15ub",
  "m15ubartifact",
  "m15ubland",
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
  // The tall-box tokens (TODO 4.55): new templates with no stored card, so
  // they joined without a bump.
  "m15tokentall",
  "m15tokenartifacttall",
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
  // …and their Nyx dress (TODO 4.51): the same profiles, new templates.
  "m20tokennyx",
  "m20tokennyxtext",
  "m20tokennyxtall",
  "m20tokenartifactnyx",
  "m20tokenartifactnyxtext",
  "m20tokenartifactnyxtall",
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
  // The borderless double-faced bodies (TODO 5.7): new templates, no stored
  // card — m15borderless's slots and the family's sizes — no bump.
  "m15borderlessdfcfront",
  "m15borderlessdfcback",
  "m15borderlessmdfcfront",
  "m15borderlessmdfcback",
  // The double-faced saga front (TODO 5.5 (b)): a new template, no stored
  // card — the saga's slots and the family's sizes — no bump.
  "sagadfcfront",
  // …and its back (TODO 5.5 (b), PR 2): a new template, no stored card —
  // the saga's slots and the family's sizes — no bump.
  "sagadfcback",
  // The battle (TODO 4.21b, CC's 'Battle' pack; layout v43): the family's
  // sizes on a landscape card — it joined WITH its bump (0 stored public or
  // unlisted cards).
  "battle",
  // The Lord of the Rings scroll (TODO 4.11, CC's 'Scroll' pack, whose text
  // layout is the M15 pack's; layout v62): it joined WITH its bump.
  "lotrscroll",
  // …and the ring (TODO 4.11, CC's 'Ring' pack, the M15 pack's text layout
  // under a lower title bar; layout v65): it joined WITH its bump.
  "lotr",
  // …and the MUL Tarkir dragon wings (TODO 4.11, CC's 'Tarkir' pack, the M15
  // pack's text layout on its own bars; layout v67): it joined WITH its bump.
  "tarkirdragon",
  // The Tarkir: Dragonstorm showcases (TODO 4.11, MSE masters with their
  // printed border painted; layout v68): the draconic on M15's slots, the
  // ghostfire on its own bars — both at the family's sizes, with their bump.
  "tarkirdraconic",
  "tarkirghostfire",
  // The Avatar elemental and the Bloomburrow woodland (TODO 4.11, MSE
  // masters with what MSE paints at render time built in; layout v69): M15's
  // slots at the family's sizes, with their bump.
  "avatar",
  "bloomburrow",
  // The Bloomburrow anime (TODO 4.11 / 4.35, one MSE master in print's look;
  // layout v70): its own measured layout on M15's slots at the family's
  // sizes, with its bump.
  "bloomanime",
  // The New Capenna Art Deco showcase (TODO 4.11 wave 2, CC's 'Golden Age
  // (SNC)' pack, M15's text layout on its own bars): a new template, no
  // stored card — the family's sizes — so it joined without a bump.
  "sncartdeco",
  // M15-era frames on MSE masters.
  "saga",
  "adventure",
  // The Prepare frame (TODO 4.27): a new template, no stored card — M15's
  // bars and the adventure panel's sizes — no bump.
  "prepare",
  "flip",
  "aftermath",
  "extendedart",
  "extendedartland",
  "expeditionland",
  // The 2015 Expeditions (TODO 4.11 wave 1, CC 'BFZ Expeditions (2015)'): a
  // new template, no stored card — the family's sizes, as the 2020 look —
  // so it joined without a bump.
  "expeditionlandbfz",
  "nyx",
  "fullart",
  "m15textless",
  "m15textlessland",
  // The full-art basics (Card Conjurer 'Fullart Basics (2022)', 4.39).
  "m15fullartland",
  "fullartland",
  // …and the older designs (TODO 4.40 / 4.41): the same CC title and type
  // sizes (FULL_ART_BASIC).
  "m15fullartlandzen",
  "m15fullartlandsnc",
  "m15fullartlandthb",
];
