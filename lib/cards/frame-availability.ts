import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameTemplate } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { colorWord, pickFrameColorKey } from "@/components/cards/frame-layer";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { isArtifactFrameType, type FrameTypeInfo } from "@/lib/cards/anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Frame availability — which (template, color) combinations the creator
// offers to users.
//
// Verification is the ONLY gate (owner decision, 2026-07-04): a combination
// is pickable exactly when its frame_reviews checkbox is checked in
// /admin/frame-compare. Checking the box publishes the combination;
// unchecking withdraws it. Existing cards keep rendering whatever they saved
// — gating only affects NEW frame selection.
//
// The gate is enforced twice: in the picker (chips) and on the server
// (frameGateError, called by the create/update actions), so a crafted
// payload or a stale client can't save a combination the admin hasn't
// published.
//
// The gate is per COLOUR (pickFrameColorKey), never per master: a colour a
// profile dresses by type (FrameProfile.artifactMasterKeys — Alpha's
// colourless artifact paints the brown artifact card "a") is published with
// its colour, so verifying agclassic/c publishes both of its masters. The one
// exception is a profile that dresses a COLOURED key by type (Innistrad:
// Double Feature, TODO 5.9: every artifact of the run prints the one
// artifact frame, whatever its colour): its `w`…`m` references are
// non-artifacts, so their ticks never looked at `a` — an ARTIFACT card there
// also needs the `c` tick, the combo whose references show `a`
// (artifactMasterReviewKey). The callers that know the card's type pass it
// (frameGateError's and isFrameComboAvailable's `type`) or read the verified
// set through verifiedKeysForType.
//
// Pure + client-safe: the picker runs it client-side against the verified
// keys the page fetched server-side.
// ---------------------------------------------------------------------------

export function isFrameComboAvailable(
  template: FrameTemplate,
  colorKey: string,
  verifiedKeys: ReadonlySet<string>,
  /** The card's type, where the caller knows it: an ARTIFACT on a colour
   *  its profile dresses as the artifact master needs that master's review
   *  too (artifactMasterReviewKey). Absent = the colour alone. */
  type?: FrameTypeInfo | null,
): boolean {
  if (!verifiedKeys.has(frameComboKey(template, colorKey))) return false;
  const review = artifactMasterReviewKey(template, colorKey, type);
  return review === null || verifiedKeys.has(frameComboKey(template, review));
}

/** The colour key whose references show a profile's type-dressed artifact
 *  master: `c`, the colourless artifact (DBL #252 The Celestus). */
const ARTIFACT_MASTER_REVIEW_KEY = "c";

/**
 * The OTHER combo an ARTIFACT card of frame colour `colorKey` needs on
 * `template`, or null: where the profile dresses a COLOURED key as the
 * artifact master (FrameProfile.artifactMasterKeys — Innistrad: Double
 * Feature, every colour → `a`), that colour's tick was made against its
 * non-artifact references and never saw `a`; the `c` tick did (its
 * references are colourless artifacts). A non-artifact, a colourless card
 * (`c` is its own review) and a profile that dresses `c` alone (Alpha, the
 * showcases' `{ c: "a" }`) need nothing more. The ONE rule the save's gate,
 * the creator's offer, the import's landing, the AI's frame and the remix
 * landings read (verifiedKeysForType for the callers that hold a set).
 */
export function artifactMasterReviewKey(
  template: FrameTemplate | string | null | undefined,
  colorKey: string,
  type: FrameTypeInfo | null | undefined,
): string | null {
  if (colorKey === ARTIFACT_MASTER_REVIEW_KEY || !isArtifactFrameType(type)) return null;
  const dressed: Partial<Record<string, string>> = getFrameProfile(normalizeFrameTemplate(template)).artifactMasterKeys ?? {};
  return dressed[colorKey] ? ARTIFACT_MASTER_REVIEW_KEY : null;
}

/** The templates whose profile dresses a coloured key by type, with those
 *  keys (computed once: today the Double Feature spell frame). */
let coloredArtifactDressCache: readonly { template: FrameTemplate; keys: readonly string[] }[] | null = null;
function coloredArtifactDresses(): readonly { template: FrameTemplate; keys: readonly string[] }[] {
  if (coloredArtifactDressCache) return coloredArtifactDressCache;
  const out: { template: FrameTemplate; keys: string[] }[] = [];
  for (const template of FRAME_TEMPLATE_VALUES) {
    const dressed: Partial<Record<string, string>> = getFrameProfile(template).artifactMasterKeys ?? {};
    const keys = Object.keys(dressed).filter((key) => key !== ARTIFACT_MASTER_REVIEW_KEY && dressed[key]);
    if (keys.length > 0) out.push({ template, keys });
  }
  return (coloredArtifactDressCache = out);
}

/**
 * The verified set as it reads for a card of this type: for an ARTIFACT,
 * every coloured combo of a profile that dresses that colour as the
 * artifact master is left out until its `c` is ticked too
 * (artifactMasterReviewKey). For any other card — and on every other
 * profile — the set itself, untouched. For the callers that hand the set on
 * (the frame picker, the import's finalization and chooser, the AI's frame,
 * the remix landings), so every check below them reads the one rule. Pure.
 */
export function verifiedKeysForType(
  verifiedKeys: ReadonlySet<string>,
  type: FrameTypeInfo | null | undefined,
): ReadonlySet<string> {
  if (!isArtifactFrameType(type)) return verifiedKeys;
  let kept: Set<string> | null = null;
  for (const { template, keys } of coloredArtifactDresses()) {
    if (verifiedKeys.has(frameComboKey(template, ARTIFACT_MASTER_REVIEW_KEY))) continue;
    for (const key of keys) {
      const combo = frameComboKey(template, key);
      if (!verifiedKeys.has(combo)) continue;
      kept ??= new Set(verifiedKeys);
      kept.delete(combo);
    }
  }
  return kept ?? verifiedKeys;
}

/** The gate for a second part in its own colour (TODO 4.26): the part's
 *  colour must be published on the card's frame too — a split half or an
 *  aftermath half paints that colour's master, a Prepare page that
 *  colour's page. Null when it is, or when the part names no colour of its
 *  own (it prints the card's). */
export function partColorGateError(
  template: FrameTemplate | string | null | undefined,
  partColors: readonly ColorIdentity[] | null | undefined,
  verifiedKeys: ReadonlySet<string>,
): string | null {
  if (!partColors || partColors.length === 0) return null;
  const resolved = normalizeFrameTemplate(template);
  const colorKey = pickFrameColorKey([...partColors]);
  if (isFrameComboAvailable(resolved, colorKey, verifiedKeys)) return null;
  return `The second part's colour isn't available on this frame in ${colorWord(colorKey)} yet — pick another colour, or switch "Each part in its own colour" off.`;
}

/** The server-side form of the gate: null when the card's frame/colour pair
 *  is published, else the field error to return for `frame_style`. Unknown
 *  or legacy template values resolve to the default frame, exactly as the
 *  renderers treat them. */
export function frameGateError(
  template: FrameTemplate | string | null | undefined,
  colorIdentity: readonly ColorIdentity[] | null | undefined,
  verifiedKeys: ReadonlySet<string>,
  /** The card's type as it will be saved: an ARTIFACT on a colour its
   *  profile dresses as the artifact master is gated in that master's
   *  review too (artifactMasterReviewKey). Absent = the colour alone. */
  type?: FrameTypeInfo | null,
): string | null {
  const resolved = normalizeFrameTemplate(template);
  const colorKey = pickFrameColorKey(colorIdentity ? [...colorIdentity] : undefined);
  if (isFrameComboAvailable(resolved, colorKey, verifiedKeys, type)) return null;
  if (isFrameComboAvailable(resolved, colorKey, verifiedKeys)) return ARTIFACT_MASTER_UNVERIFIED;
  return `That frame isn't available in ${colorWord(colorKey)} yet — pick another frame or colour.`;
}

/** frameGateError's words when the card's colour is published on the frame
 *  but the artifact version it paints for an artifact isn't yet
 *  (artifactMasterReviewKey). */
export const ARTIFACT_MASTER_UNVERIFIED =
  "That frame's artifact version isn't available yet — pick another frame, or a type that isn't an artifact.";
