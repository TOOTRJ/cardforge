import "server-only";
import sharp from "sharp";
import { FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { mergeProfile, type FrameProfileOverride } from "@/lib/cards/profile-override";
import { getFrameProfile, underFrameArtRect, type FrameProfile } from "@/lib/cards/template-layout";
import { artWindowFindings, artWindowSlotsOf, artWindowVerdict } from "@/lib/frames/art-window";
import { loadFrameMasterBytes } from "@/lib/render/card-frames";

// ---------------------------------------------------------------------------
// The art-window gate on a frame-layout SAVE (the frame-compare editor,
// lib/cards/frame-profile-override-actions.ts). An `artSlot` (or
// `secondFace.artSlot`) override is live for every render the moment it is
// saved, so it is held to the same check CI holds the code profiles to
// (TODO 7.6, lib/frames/art-window.ts): on every master the template paints,
// the slot — or, on a see-through master, its under-frame art — must cover
// the frame's art window with 0.05 % of the card to spare, and every
// translucent part the art shows through must stay inside it. A master in
// the known-failure table may keep failing, no worse than its bound
// (artWindowVerdict: the CI rule). A draft that fails is refused with the
// finding; nothing is written.
//
// The masters are the ones the bake draws: git masters from disk or the
// deployment's CDN, bucket masters from the frames bucket at the manifest's
// sha256 — lib/render/card-frames.ts's cache (loadFrameMasterBytes). A
// master that can't be loaded refuses the save too: an unchecked art slot
// is never published.
// ---------------------------------------------------------------------------

/** One master decoded to straight RGBA. */
export type MasterPixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

/** Loads a template's master for a key: its pixels, or null when the
 *  template has none for that key. Throws when it can't be loaded. */
export type MasterLoader = (template: string, key: string) => Promise<MasterPixels | null>;

/** True when an override moves an art slot — the only override paths the art
 *  window depends on (the under-frame rect is code-owned). */
export function overrideTouchesArtSlot(overrides: FrameProfileOverride | null | undefined): boolean {
  if (!overrides) return false;
  return overrides.artSlot !== undefined || overrides.secondFace?.artSlot !== undefined;
}

/** The masters a template paints: every colour key (all of them exist for
 *  every template — the coverage test holds git templates to ≥ 7) plus the
 *  masters it dresses a colour with by type (Alpha's artifact card "a"). */
export function masterKeysFor(profile: Pick<FrameProfile, "artifactMasterKeys">): string[] {
  const dressed = Object.values(profile.artifactMasterKeys ?? {}).filter((k): k is NonNullable<typeof k> => Boolean(k));
  return [...new Set<string>([...FRAME_COLOR_KEYS, ...dressed])];
}

async function loadMasterPixels(template: string, key: string): Promise<MasterPixels | null> {
  const bytes = await loadFrameMasterBytes(template, key);
  if (!bytes) return null;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Why a frame-layout save must be refused for its art slot, or null when it
 * may be saved: an override that doesn't move an art slot is never checked
 * (and loads nothing). `load` is injectable for tests.
 */
export async function artSlotOverrideRefusal(
  template: string,
  overrides: FrameProfileOverride | null | undefined,
  load: MasterLoader = loadMasterPixels,
): Promise<string | null> {
  if (!overrideTouchesArtSlot(overrides)) return null;
  const profile = mergeProfile(getFrameProfile(template), overrides);
  for (const key of masterKeysFor(profile)) {
    let master: MasterPixels | null;
    try {
      master = await load(template, key);
    } catch {
      return `Couldn't load the ${template}/${key} frame master to check the art window — nothing was saved. Try again.`;
    }
    if (!master) {
      return `The ${template}/${key} frame master is missing, so the art window can't be checked — nothing was saved.`;
    }
    const findings = artWindowFindings(
      master.data,
      master.width,
      master.height,
      artWindowSlotsOf(profile, underFrameArtRect(profile, key)),
    );
    const verdict = artWindowVerdict(template, key, findings);
    if (verdict.fails.length > 0) {
      return (
        `The art slot leaves the ${template}/${key} frame's art window uncovered (the art-window check, TODO 7.6) — ` +
        `nothing was saved. ${verdict.fails[0]}`
      );
    }
  }
  return null;
}
