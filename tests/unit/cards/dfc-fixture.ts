import type { DfcProfile, FrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The DFC bodies 5.1a / 5.1b will declare (design 2026-10-02 §2.1), for
// tests that exercise 5.0a's plumbing before any profile is one: a
// getFrameProfile that gives four EXISTING templates a `dfc` declaration —
// never the real PROFILES. Used through vi.mock of
// "@/lib/cards/template-layout"; never by the app. The templates stand in
// for the bodies by name only: m15 as the transform front, m15land as the
// transform land front, m15artifact as the transform back, m15snow as the
// modal front, m15devoid as the modal back. The spell bodies dress `c` as
// the artifact master (`artifactMasterKeys`, design D2 — as the real 5.1a
// profiles do), which is what colorlessFaceAllowed reads; the land front
// has one master under every key and no stand-in.
// ---------------------------------------------------------------------------

export const DFC_DECLARED: Record<string, DfcProfile> = {
  m15: { layout: "transform", role: "front", well: "left" },
  m15land: { layout: "transform", role: "front", well: "left", land: true },
  m15artifact: { layout: "transform", role: "back", well: "right" },
  m15snow: { layout: "modal", role: "front", well: "left" },
  m15devoid: { layout: "modal", role: "back", well: "left" },
};

/** The profile fields a declared body carries beside `dfc`. */
const DECLARED_EXTRAS: Record<string, Partial<FrameProfile>> = {
  m15: { artifactMasterKeys: { c: "a" } },
  m15artifact: { artifactMasterKeys: { c: "a" } },
  m15snow: { artifactMasterKeys: { c: "a" } },
  m15devoid: { artifactMasterKeys: { c: "a" } },
};

/** getFrameProfile with DFC_DECLARED merged in (an unknown template reads
 *  as m15, as the real one does — so here as the transform front). */
export function dfcGetFrameProfile(
  real: (template: string | undefined) => FrameProfile,
): (template: string | undefined) => FrameProfile {
  const cache = new Map<string, FrameProfile>();
  return (template) => {
    const base = real(template);
    const key = template && DFC_DECLARED[template] ? template : base === real("m15") ? "m15" : null;
    if (!key) return base;
    const hit = cache.get(key);
    if (hit) return hit;
    const merged = { ...base, ...DECLARED_EXTRAS[key], dfc: DFC_DECLARED[key] };
    cache.set(key, merged);
    return merged;
  };
}
