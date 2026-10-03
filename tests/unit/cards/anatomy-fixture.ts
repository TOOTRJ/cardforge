import { TWO_COLOR_PAIRS } from "@/lib/cards/frame-reference-registry";
import { M15_HOLO_STAMP_KEEP_OUT, M15_HOLO_STAMP_OVAL } from "@/lib/cards/holo-stamp";
import type { FrameOverlaySlot, FrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The anatomy 4.6a / 4.6b will declare (design 2026-09-29), for tests that
// exercise the 4.6.0 plumbing before any profile draws a piece: a
// getFrameProfile that adds the crown band on m15, m15artifact and m15land
// and the pair masters (m15 split + hybrid, m15artifact and m15land split),
// on the PROFILES entries only. Used through vi.mock of
// "@/lib/cards/template-layout" — never by the app.
// ---------------------------------------------------------------------------

export const TEST_CROWN: FrameOverlaySlot = {
  anatomy: "crown",
  rect: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 19.52 },
  assetPathTemplate: "/frames/m15crown/{key}.png",
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS],
};

/** …and the holofoil stamp's notch (TODO 4.9c) on the same three — with
 *  the pair keys since the 4.9c follow-up (a card drawn as its pair master
 *  takes the pair's notch, as it takes the pair's crown band). */
export const TEST_STAMP: FrameOverlaySlot = {
  anatomy: "holoStamp",
  rect: { leftPct: 43.6, topPct: 90.34, widthPct: 12.8, heightPct: 4.58 },
  assetPathTemplate: "/frames/m15holostamp/{key}.png",
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS],
  stamp: { shape: "oval", oval: M15_HOLO_STAMP_OVAL, keepOut: M15_HOLO_STAMP_KEEP_OUT },
};

type Declared = Pick<FrameProfile, "overlays" | "twoColorMasters" | "twoColorForLands">;

export const DECLARED: Record<string, Declared> = {
  m15: { overlays: [TEST_CROWN, TEST_STAMP], twoColorMasters: ["split", "hybrid"] },
  m15artifact: { overlays: [{ ...TEST_CROWN, keyMap: { c: "a" } }, { ...TEST_STAMP, keyMap: { c: "a" } }], twoColorMasters: ["split"] },
  m15land: { overlays: [{ ...TEST_CROWN, keyMap: { c: "l" } }, { ...TEST_STAMP, keyMap: { c: "l" } }], twoColorMasters: ["split"], twoColorForLands: true },
};

/** getFrameProfile with DECLARED merged in (an unknown template reads as
 *  m15, as the real one does). */
export function declaredGetFrameProfile(
  real: (template: string | undefined) => FrameProfile,
): (template: string | undefined) => FrameProfile {
  const cache = new Map<string, FrameProfile>();
  return (template) => {
    const base = real(template);
    const key = template && DECLARED[template] ? template : base === real("m15") ? "m15" : null;
    if (!key) return base;
    const hit = cache.get(key);
    if (hit) return hit;
    const merged = { ...base, ...DECLARED[key] };
    cache.set(key, merged);
    return merged;
  };
}
