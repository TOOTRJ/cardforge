import { CARD_LAYOUT_VERSION, isRenderStale } from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// Is a frame verification still meaningful? A tick in /admin/frame-compare
// records the renderer layout version and a hash of the template's layout
// override (migration 0115). The verification goes STALE when either moved
// on: a renderer bump that touches the template, or an edited/reset
// override. Rows ticked before 0115 carry no record — they are reported as
// `legacy` (not stale) so the 71 existing verifications don't all demand a
// re-tick at once; the next tick stamps them.
//
// Pure: the page and the checklist derive their badges from it, tests pin
// the rules.
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level, so equal overrides hash
 *  equal regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Short stable fingerprint of a layout override ("none" when absent or
 *  empty). FNV-1a 32-bit over the canonical JSON — plenty for telling two
 *  overrides apart, and client-safe (no crypto import). */
export function overrideHash(override: unknown): string {
  if (
    override == null ||
    (typeof override === "object" && Object.keys(override as object).length === 0)
  ) {
    return "none";
  }
  const text = canonicalJson(override);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type VerificationSnapshot = {
  verified: boolean;
  verifiedLayoutVersion: number | null;
  verifiedOverrideHash: string | null;
};

export type VerificationState = {
  verified: boolean;
  /** Verified, but the renderer or the override changed since. */
  stale: boolean;
  /** Verified before 0115 recorded what a tick measured. */
  legacy: boolean;
  reasons: string[];
};

export function verificationState(
  snapshot: VerificationSnapshot,
  template: string,
  currentOverrideHash: string,
  currentVersion: number = CARD_LAYOUT_VERSION,
): VerificationState {
  if (!snapshot.verified) {
    return { verified: false, stale: false, legacy: false, reasons: [] };
  }
  const reasons: string[] = [];
  const legacy =
    snapshot.verifiedLayoutVersion == null && snapshot.verifiedOverrideHash == null;
  if (
    snapshot.verifiedLayoutVersion != null &&
    // A tick verifies the REGULAR frame: a finish-scoped bump (v26 etched)
    // must not stale every combo. Rarity stays unknown → rarity-scoped
    // bumps (v23) remain conservative, as before.
    isRenderStale(snapshot.verifiedLayoutVersion, template, undefined, currentVersion, {
      frame_style: { template, finish: "regular" },
    })
  ) {
    reasons.push(
      `the renderer changed since layout v${snapshot.verifiedLayoutVersion} (now v${currentVersion})`,
    );
  }
  if (
    snapshot.verifiedOverrideHash != null &&
    snapshot.verifiedOverrideHash !== currentOverrideHash
  ) {
    reasons.push("the layout override changed since this was verified");
  }
  return { verified: true, stale: reasons.length > 0, legacy, reasons };
}
