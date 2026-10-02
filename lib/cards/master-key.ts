// ---------------------------------------------------------------------------
// A frame master key's crowned twin (TODO 4.6f, wave 2a) — a LEAF module
// (no imports), like lib/cards/frame-color-key.ts: lib/cards/template-layout.ts
// reads it, and the Card Conjurer importer loads that file through Node's
// type stripping (scripts/lib/ts-alias-hooks.mjs), where a value import of
// lib/cards/frame-reference-registry.ts would drag its JSON import along.
// The registry re-exports these and builds LEGENDARY_MASTER_KEYS from the
// suffix.
//
// A template whose legendary crown is baked into its masters
// (FrameProfile.crownMasters — the borderless FLOATING crown, which erases
// part of the frame under it, so no overlay can draw it) has
// `<template>/<key>-legendary.png` beside each `<key>.png`. A Legendary card
// with FrameStyle.crown === true paints the twin (lib/cards/anatomy.ts
// crownedMasterKey); what is keyed by the master a card paints — its ink
// maps, a see-through master's under-frame art — reads the plain key
// (baseMasterKey): the crown changes nothing below the title bar. (The
// square-corner table, lib/frames/square-corners.ts, is asked with the key
// as painted: it names no key of a crowned template today, and one that
// gets a keyed entry there must read the plain key too.)
// ---------------------------------------------------------------------------

export const LEGENDARY_MASTER_SUFFIX = "-legendary";

/** `w` → `w-legendary`, `wu-h` → `wu-h-legendary`: the crowned twin of a
 *  master key (never of one that already is). */
export function legendaryMasterKey(key: string): string {
  return key.endsWith(LEGENDARY_MASTER_SUFFIX) ? key : `${key}${LEGENDARY_MASTER_SUFFIX}`;
}

/** The master a crowned twin is the twin of (`w-legendary` → `w`); any other
 *  key as it is. */
export function baseMasterKey(key: string): string {
  return key.endsWith(LEGENDARY_MASTER_SUFFIX) ? key.slice(0, -LEGENDARY_MASTER_SUFFIX.length) : key;
}

/** True for a crowned twin's key. */
export function isLegendaryMasterKey(key: string): boolean {
  return key.endsWith(LEGENDARY_MASTER_SUFFIX);
}
