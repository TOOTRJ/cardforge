import type * as LayoutVersion from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// lib/cards/layout-version.ts as it answered when CARD_LAYOUT_VERSION was
// `current` — for tests of the owner opt-in machinery (the "newer look"
// badge, render_update notifications, a sweep leaving an opt-in-only card
// alone, a free download serving an older bake).
//
// v31 (the one corner radius, TODO 3.26) is an UNSCOPED sweep, so from v31
// on (v32, the M15 family's sizes, is another sweep) every bake older than
// v31 owes a correction and no card has only the v22 opt-in pending: those
// paths are unreachable until a later opt-in bump. The machinery still has
// to work, so its tests pin the module at v30, the last version where such a
// card exists:
//
//   vi.mock("@/lib/cards/layout-version", async (importOriginal) => {
//     const { layoutVersionAt } = await import("@/tests/stubs/layout-version-at");
//     return layoutVersionAt(await importOriginal(), 30);
//   });
//
// Every policy function defaults to `current` (an explicit argument still
// wins); the maps (VERSION_ROLLOUT, VERSION_SCOPES…) are the real ones —
// versions above `current` are simply never reached.
// ---------------------------------------------------------------------------

type Module = typeof LayoutVersion;

export function layoutVersionAt(
  real: Module,
  current: number,
): Omit<Module, "CARD_LAYOUT_VERSION"> & { CARD_LAYOUT_VERSION: number } {
  return {
    ...real,
    CARD_LAYOUT_VERSION: current,
    isRenderStale: (layoutVersion, template, scoped, at, card, scopes) =>
      real.isRenderStale(layoutVersion, template, scoped, at ?? current, card, scopes),
    classifyForSweep: (row, targetVersion, opts = {}) => real.classifyForSweep(row, targetVersion, { current, ...opts }),
    latestOptInVersion: (rollout, at) => real.latestOptInVersion(rollout, at ?? current),
    hasPendingCorrection: (card, opts = {}) => real.hasPendingCorrection(card, { current, ...opts }),
    hasNewerLook: (card, opts = {}) => real.hasNewerLook(card, { current, ...opts }),
    storedLookIsOlder: (card, opts = {}) => real.storedLookIsOlder(card, { current, ...opts }),
    downloadDiffersFromGallery: (card, viewerIsPaid, opts = {}) =>
      real.downloadDiffersFromGallery(card, viewerIsPaid, { current, ...opts }),
  };
}
