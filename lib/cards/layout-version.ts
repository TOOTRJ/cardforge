// ---------------------------------------------------------------------------
// CARD_LAYOUT_VERSION — stamped onto `cards.layout_version` every time a card
// render is baked (lib/cards/bake-render.ts, app/api/admin/rebake).
//
// BUMP THIS whenever a change alters baked output for existing cards:
//   * frame profile geometry/ink edits (lib/cards/template-layout.ts)
//   * renderer changes (lib/render/card-image.tsx) or shared text logic
//     (rules-text tokenizer, fit sizing, fonts)
//   * frame PNG asset replacements
// then run `node scripts/rebake-renders.mjs` so stored gallery PNGs catch up
// (detail pages and downloads always render live and need no sweep).
//
// DB-driven geometry (frame_profile_overrides, edited in /admin/frame-
// compare) does NOT bump this constant — the save action marks affected
// cards stale directly via `layout_version = null`, which the same rebake
// sweep picks up.
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
