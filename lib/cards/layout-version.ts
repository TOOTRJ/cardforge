// ---------------------------------------------------------------------------
// CARD_LAYOUT_VERSION — stamped onto `cards.layout_version` every time a card
// render is baked (lib/cards/bake-render.ts, app/api/admin/rebake).
//
// BUMP THIS whenever a change alters baked output for existing cards:
//   * frame profile geometry/ink edits (lib/cards/template-layout.ts)
//   * renderer changes (lib/render/card-image.tsx) or shared text logic
//     (rules-text tokenizer, fit sizing, fonts)
//   * frame PNG asset replacements
//
// What happens to existing cards after a bump (2026-09 onward):
//   * The OWNER sees a "newer look available" badge on each affected card
//     (dashboard tile + edit page), can compare the stored image with the
//     live preview, and re-bakes it — one card at a time in the dashboard
//     walkthrough or all of them, each behind a "this is permanent"
//     confirmation (lib/cards/render-actions.ts,
//     components/cards/render-update.tsx).
//   * The daily cron /api/cron/notify-render-updates tells each affected
//     owner ONCE per version (a `render_update` notification whose link
//     opens the walkthrough). Trigger it by hand right after the deploy:
//     curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/notify-render-updates
//   * Stale cards render live for OG images and downloads anyway
//     (lib/render/stored-render.ts), so nothing is wrong meanwhile — only
//     the gallery tile shows the older image.
//   * `node scripts/rebake-renders.mjs` (admin sweep) still exists for
//     corrections every card should get without asking (text clipping, the
//     2026-09 land fix) — reserve owner-driven updates for changes a user
//     might reasonably prefer to keep.
//
// If a bump only touches SOME frame templates, list them in
// TEMPLATE_SCOPED_VERSIONS below: cards on other templates are not marked
// stale by it (and the sweep / "update all" fast-forward their stamp
// without a render, because their stored PNG is already what the renderer
// would produce). A bump missing from the map touches every card.
//
// DB-driven geometry (frame_profile_overrides, edited in /admin/frame-
// compare) does NOT bump this constant — the save action marks affected
// cards stale directly via `layout_version = null`, which every stale
// check below treats as "needs a render".
//
// History:
//   (null) — renders baked before versioning existed (pre 2026-06-09)
//   2      — creation-audit pass: Beleren/MPlantin-Italic, fit-based text
//            sizing, pip-size contract, M15-family geometry verification
//   3      — PipGlyph rebrand: footer brand line, compass-star default set
//            mark, watermark → pipglyph.com (2026-06-11)
//   4      — M15 type-line nudged down ~2px to true-center on the type bar
//   5      — M15 P/T value lifted ~2px (valueDyEm) to true-center on the plate
//   6      — M15 P/T value nudged ~2px right (valueDxEm) to true-center on the
//            plate horizontally
//   7      — M15 P/T value: a bit more right (valueDxEm 0.09 → 0.18)
//   8      — M15 title nudged down ~1px to true-center on the name bar
//   9      — M15 type line back up a hair (56.5 → 56.35); 56.5 read too low
// (Modern-2003 type nudge — no version bump: zero existing public cards use
//  that frame, so no stored render changed.)
//   10     — M15 measured against a real DOM scan via the frame-compare tool:
//            title/type left 8.5 → 7.9, row width 83 → 86.1 (pips end ~94%),
//            pip disc 0.04 → 0.0485, type size 0.034 → 0.0435 with new
//            single-line fit (fitSingleLineSizePct), type top 56.35 → 56.5
//   11     — M15 seven-color scan sweep: title/type left back to 8.5 (the
//            7.9 in v10 was a scan-window artifact; 7-card average is 8.55),
//            rules block vertically centered at 77.6% (matches all seven
//            prints), P/T plate reshaped to the real slim lozenge
//            (89.3–95.1%H, digits at 86%W/91.9%H, cap 3.75%W), footer moved
//            down+left onto the real artist line (96.2%H / 6.5%W)
//   12     — M15 title/type right edge 94 → 92.2%W: pips and set symbol were
//            ~1.8% too far right — the ~94% dark cluster is the bar's right
//            bevel shading, not the pip edge (confirmed on 4 scans)
//   13     — Frame PNG rebuilds from the correct Full-Magic-Pack sources:
//            m15land + saga from the dot-free sets ("375 m15 simple" lands /
//            "375 m15 saga") and m15pw from mainframe-planeswalker — the
//            "cut" module twins bake an MSE produced-mana indicator disc
//            into the title bar's top-left that real cards don't have.
//            Geometry unchanged (same frames minus the disc).
//   14     — m15pw starting-loyalty shield plate (the real MSE loyalty.png —
//            the drawn polygon was invisible on the black border); aftermath
//            bottom-half art window cut to alpha + secondFace.artSlot (user
//            art was silently dropped; the window was painted white).
//   15     — stat plates/shields lifted above the text layers (z22 — printed
//            cards draw them OVER the text box edge; the cream box was
//            covering the pw shield); loyalty ROW badges are the real MSE
//            shield assets (loyaltyup/down/naught.png) instead of drawn
//            polygons; saga gains the standard M15 footer (artist line was
//            missing entirely).
//   16     — Astral Rose rebrand reaches the card face: default set mark and
//            the free-tier watermark swap the old compass-star for the rose
//            star silhouette (geometry now imported from lib/brand/geometry
//            so preview and bake can't drift).
//   17     — default set mark bolded into a two-tone emblem: wider star in
//            the rarity ink over a contrast keyline + keyline gem (the thin
//            single-ink star was illegible on colored/dark frame bars).
//   18     — set mark gains the logo's ring (a minted-seal emblem, same
//            visual language as the Medallion treatment) — star r9.5 inside
//            ring r13.4, both keylined; geometry moved to SET_MARK_* in
//            lib/brand/geometry.
//   19     — the hardcoded "PipGlyph" footer text is gone (it doubled up
//            with the free-tier pipglyph.com overlay). The footer-right slot
//            now prints the OWNER's custom watermark text (paid perk,
//            profiles.export_watermark_text) or nothing.
// ---------------------------------------------------------------------------

export const CARD_LAYOUT_VERSION = 19;

/**
 * Bumps that changed the output of only some frame templates, keyed by the
 * version they introduced. Every bump through 19 touched every card (fonts,
 * brand mark, set emblem, footer), so the map starts empty; add an entry
 * with the next template-scoped change, e.g. `20: ["m15", "m15land"]`.
 * Template keys match `frame_style.template` (types/card.ts
 * FRAME_TEMPLATE_VALUES).
 */
export const TEMPLATE_SCOPED_VERSIONS: Readonly<Record<number, readonly string[]>> = {};

/** `frame_style.template` from the jsonb column, or null when absent. */
export function templateOfFrameStyle(frameStyle: unknown): string | null {
  if (!frameStyle || typeof frameStyle !== "object") return null;
  const template = (frameStyle as { template?: unknown }).template;
  return typeof template === "string" && template ? template : null;
}

/**
 * True when a stored render baked at `layoutVersion` no longer matches what
 * the current renderer would produce for a card on `template`.
 *
 *   null version → stale (never versioned, or marked stale by a frame-profile
 *   override save). A version at or above the current one → current. In
 *   between → stale only if some later bump touched every template or this
 *   one (an unknown template is treated as touched — conservative).
 */
export function isRenderStale(
  layoutVersion: number | null | undefined,
  template: string | null | undefined,
  scoped: Readonly<Record<number, readonly string[]>> = TEMPLATE_SCOPED_VERSIONS,
  current: number = CARD_LAYOUT_VERSION,
): boolean {
  if (layoutVersion == null || !Number.isFinite(layoutVersion)) return true;
  if (layoutVersion >= current) return false;
  for (let version = layoutVersion + 1; version <= current; version += 1) {
    const templates = scoped[version];
    if (!templates) return true; // touched every card
    if (!template || templates.includes(template)) return true;
  }
  return false;
}
