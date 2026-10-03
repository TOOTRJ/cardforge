// ---------------------------------------------------------------------------
// Kind anatomy (TODO 4.5.0): what a frame BODY draws for a card kind, read
// from its profile's fields — the P/T plate, the walker's loyalty shield and
// ability rows, the battle's defense shield and landscape card, the saga's
// chapter rail, the adventure page, a second face, a basic land's symbol.
//
// A body is a template: its masters plus its profile. A kind's anatomy is
// DECLARED ON THE BODY (the profile's `pt` / `loyalty` / `loyaltyRows` /
// `defense` / `chapters` … fields), built by shared, parameterised builders
// where bodies share one (walkerAnatomy() below: m15pw and the borderless
// walkers today). It is never an overlay spread onto someone else's
// template at render time.
//
// The capability rule — "the body draws what the kind needs"
// (profileDrawsKind) — is half of the kind gate (lib/creator/card-kinds.ts
// templateRefusesKind): a showcase or Borderless body refuses a kind whose
// anatomy it lacks; the trade-dress table there (TREATMENT_KINDS) says what
// a capability can't (land-only dresses, Nyx, the Borderless skins, the
// emblem's own frame).
//
// THE OWNER RULE (2026-09-29): a template that exists NEVER gains a kind
// capability. It would re-dress every stored card of that kind on it at its
// next bake, and the visual gate can't see it (a matrix case added back
// needs no bump). A new (treatment, kind) pair is a NEW template key, or a
// stored per-card switch through normalizeAnatomy (the crown's pattern,
// lib/cards/anatomy.ts). tests/unit/cards/kind-capability-baseline.test.ts
// pins every template's capabilities; a gain fails it.
//
// Pure and dependency-free at runtime (type imports only): template-layout.ts
// builds its profiles with walkerAnatomy(), so this module must not import
// it back.
// ---------------------------------------------------------------------------

import type { FrameProfile, StatSlot, TextSlot } from "@/lib/cards/template-layout";
import type { CardKind } from "@/lib/creator/card-kinds";

/** A piece of kind anatomy a body can draw (read from its profile). */
export const ANATOMY_CAPABILITIES = [
  "pt",
  "loyalty",
  "loyaltyRows",
  "defense",
  "chapters",
  "landscape",
  "adventure",
  "secondFace",
  "basicSymbol",
  // A double-faced FRONT body (TODO 5.1a: FrameProfile.dfc with role
  // "front") — what the Transform kind needs; a back body is never a card's
  // template and gives no kind anything.
  "dfcFront",
] as const;
export type AnatomyCapability = (typeof ANATOMY_CAPABILITIES)[number];

/**
 * The anatomy a body must draw to dress each kind. A creature needs the P/T
 * (a plate or ink — every showcase and Borderless body that takes creatures
 * has one), a planeswalker the loyalty shield AND the ability rows, a battle
 * the defense shield on the landscape card, a saga the chapter rail, an
 * adventure its storybook page, a split / aftermath / flip card its second
 * face. The other kinds need nothing a body can lack (the land's big basic
 * symbol is optional anatomy: a body without `basicSymbol` draws the
 * watermark in the rules box). No `rulesBox` capability: no profile sets
 * `textless` on a body a kind is refused by (FrameProfile.textless is the
 * full-art token's no-box height), so it would decide nothing.
 */
export const KIND_REQUIRES: Readonly<Record<CardKind, readonly AnatomyCapability[]>> = {
  creature: ["pt"],
  instant: [],
  sorcery: [],
  artifact: [],
  enchantment: [],
  land: [],
  planeswalker: ["loyalty", "loyaltyRows"],
  battle: ["defense", "landscape"],
  token: [],
  emblem: [],
  saga: ["chapters"],
  adventure: ["adventure"],
  split: ["secondFace"],
  aftermath: ["secondFace"],
  flip: ["secondFace"],
  // The Transform kind (TODO 5.1a): a front body of a double-faced card —
  // its icon well, its tab and a back face of its own.
  transform: ["dfcFront"],
};

/** The anatomy a profile draws, from its FIELDS only — so a profile spread
 *  from another and one a builder made count alike. */
export function capabilitiesOf(profile: FrameProfile): ReadonlySet<AnatomyCapability> {
  const caps = new Set<AnatomyCapability>();
  if (profile.pt) caps.add("pt");
  if (profile.loyalty) caps.add("loyalty");
  if (profile.loyaltyRows) caps.add("loyaltyRows");
  if (profile.defense) caps.add("defense");
  if (profile.chapters) caps.add("chapters");
  if (profile.orientation === "landscape") caps.add("landscape");
  if (profile.adventure) caps.add("adventure");
  if (profile.secondFace) caps.add("secondFace");
  if (profile.basicSymbol) caps.add("basicSymbol");
  if (profile.dfc?.role === "front") caps.add("dfcFront");
  return caps;
}

/** True when the body draws everything the kind needs (KIND_REQUIRES). */
export function profileDrawsKind(profile: FrameProfile, kind: CardKind): boolean {
  const caps = capabilitiesOf(profile);
  return KIND_REQUIRES[kind].every((cap) => caps.has(cap));
}

/**
 * The slot paths of the kind-anatomy capabilities that belong to ONE kind
 * (lib/cards/profile-override.ts listSlotPaths): a card of another kind never
 * draws them, so a reference printing of another kind is never scored
 * against them. The P/T is not here (a Vehicle, a token or an Artifact
 * Creature prints it on many kinds' bodies), nor the adventure page or a
 * second face (only their own kind sits on those templates).
 */
export const KIND_ONLY_SLOTS = ["loyalty", "defense", "chapters"] as const satisfies readonly AnatomyCapability[];
export type KindOnlySlot = (typeof KIND_ONLY_SLOTS)[number];

/** True when a card of `kind` draws the kind-only slot. */
export function kindDrawsSlot(kind: CardKind, slot: KindOnlySlot): boolean {
  return KIND_REQUIRES[kind].includes(slot);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Freeze an object and everything it holds (a builder's output is shared
 *  by reference by every profile that spreads it; nothing may edit it). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/** A body's walker anatomy — see walkerAnatomy. */
export type WalkerAnatomy = {
  /** FrameProfile.loyalty — the starting-loyalty shield. */
  readonly loyalty: StatSlot;
  /** FrameProfile.loyaltyRows — the ability rows. */
  readonly loyaltyRows: NonNullable<FrameProfile["loyaltyRows"]>;
  /** Spread LAST into the body's rules slot: the see-through ability
   *  window's backdrop. */
  readonly rulesPatch: Readonly<Pick<TextSlot, "backdropHex" | "backdropWhenEmpty">>;
};

/**
 * The walker anatomy of ONE body: the starting-loyalty shield and the
 * ability rows (the rows' stripes and badges, their text ceiling) and the
 * backdrop of the see-through ability window. Every value is the body's own
 * — the shield is cut from THIS body's masters (scripts/lib/cc-frames.mjs
 * SHIELD_BOX), the stripes are its print's — so there is no shared overlay
 * object to keep in step: bodies that share the anatomy share this call.
 * m15pw and the borderless walkers (4.33, both heights) are built with it;
 * 4.5b's bodies (the extended-art and Ghostfire walkers) will be too.
 *
 * The rows' loyalty-cost badges are MSE's M15 set for every walker today
 * (public/frames/m15pw/loyalty{up,down,naught}.png, loyaltyBadgeAssetFor),
 * so there is no badge parameter yet: 4.5b b3 adds `badges` together with
 * the field that carries it (LoyaltyRowsSlot.badgeSet, read by both
 * renderers and the preload) — a parameter nothing reads would let a body
 * ask for the Ghostfire badges and silently get M15's.
 *
 * The output is deep-frozen (profiles spread it; an override is merged into
 * a copy, never into it).
 */
export function walkerAnatomy(p: {
  /** The shield: the value's box, its ink span and the plate cut from the
   *  body's own masters (plateAssetPathTemplate, plateRect). */
  shield: StatSlot;
  /** The ability rows' alternating stripes (odd / even). */
  stripes: { a: string; b: string };
  /** The badges' ink. */
  badgeTextHex: string;
  /** The walker text's ceiling (FrameProfile.loyaltyRows.maxSizePct). */
  maxSizePct: number;
  /** The ability window's backdrop behind a walker's text (and any other
   *  card's rules) on a see-through window. */
  rulesBackdropHex?: string;
  /** Draw it even when the box has no text (TextSlot.backdropWhenEmpty). */
  rulesBackdropWhenEmpty?: boolean;
}): WalkerAnatomy {
  const rulesPatch: { backdropHex?: string; backdropWhenEmpty?: boolean } = {};
  if (p.rulesBackdropHex !== undefined) rulesPatch.backdropHex = p.rulesBackdropHex;
  if (p.rulesBackdropWhenEmpty) rulesPatch.backdropWhenEmpty = true;
  return deepFreeze({
    loyalty: { ...p.shield },
    loyaltyRows: {
      maxSizePct: p.maxSizePct,
      badgeTextHex: p.badgeTextHex,
      stripeAHex: p.stripes.a,
      stripeBHex: p.stripes.b,
    },
    rulesPatch,
  });
}
