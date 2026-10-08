import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { buildTypeLine, displayLine, normalizeFrameTemplate } from "@/lib/cards/card-display";
import { statLayoutChanged } from "@/lib/cards/stat-fit";
import { basicLandManaKey } from "@/lib/cards/watermark";
import { isColorIdentity, type CardType } from "@/types/card";

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
// What happens to existing cards after a bump depends on its rollout policy
// (VERSION_ROLLOUT below — "sweep" for corrections, "opt-in" for taste):
//   * SWEEP bumps (and frame-geometry changes) are platform work. Owners
//     never see a badge or a notification for them (TODO 0.20, owner
//     decision 2026-09-25); the automatic re-bake (/api/cron/auto-rebake,
//     every 5 minutes on production — lib/cards/auto-rebake.ts) re-bakes
//     the affected cards after the deploy, and downloads keep serving the
//     stored bake until then only when no correction is pending
//     (lib/render/stored-render.ts).
//   * OPT-IN bumps: the OWNER sees a "newer look available" badge on each affected card
//     (dashboard tile + edit page), can compare the stored image with the
//     live preview, and re-bakes it — one card at a time in the dashboard
//     walkthrough or all of them, each behind a "this is permanent"
//     confirmation (lib/cards/render-actions.ts,
//     components/cards/render-update.tsx).
//   * The daily cron /api/cron/notify-render-updates tells each affected
//     owner ONCE per opt-in version (a `render_update` notification whose
//     link opens the walkthrough; keyed on latestOptInVersion). Trigger it
//     by hand right after a deploy that adds an opt-in bump:
//     curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/notify-render-updates
//   * Meanwhile the owner's older look is the card's look everywhere: the
//     gallery tile, the share image and a free (watermarked) download all
//     serve the stored bake (lib/render/stored-render.ts, TODO 0.21). Only a
//     paid clean download renders live, and the download modal says so.
//   * Sweep bumps are for corrections every card should get without asking
//     (text clipping, the 2026-09 land fix) — the automatic re-bake picks
//     them up on its own; `node scripts/rebake-renders.mjs` still drives the
//     same batch by hand (and the version / legacy-art scopes). Reserve
//     owner-driven updates for changes a user might reasonably prefer to
//     keep.
//
// If a bump only touches SOME frame templates, list them in
// TEMPLATE_SCOPED_VERSIONS below: cards on other templates are not marked
// stale by it (and the sweep / "update all" fast-forward their stamp
// without a render, because their stored PNG is already what the renderer
// would produce). A bump missing from the map touches every card. A card
// with no (or a retired) template is judged as the default template it is
// drawn on (normalizeFrameTemplate) — so changing DEFAULT_FRAME_TEMPLATE is
// itself an unscoped bump. If a bump only touches cards with some property
// (a rarity, a finish), add a VERSION_SCOPES predicate instead of — or as
// well as — a template list: the two compose (AND).
//
// DB-driven geometry (frame_profile_overrides, edited in /admin/frame-
// compare) does NOT bump this constant — the save action marks affected
// cards with `layout_version = null` ("a platform re-bake is owed"), and
// the compare page re-bakes them straight away through the "marked" scope
// of lib/cards/rebake-batch.ts. A null stamp is never an owner badge.
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
//   20     — display is ALWAYS watermarked (owner decision 2026-09-15): the
//            stored bake, the OG share image and every live preview carry
//            the pipglyph.com mark whatever the owner's plan, and print no
//            custom footer text. The only clean output is a paid viewer's
//            download, which is also where the owner's custom footer text
//            now prints. Every previously-clean bake (paid owners) is stale
//            and must be swept, not offered as an optional update — run
//            scripts/rebake-renders.mjs right after the deploy.
//   21     — no renderer change. The v20 sweep was run from a local dev
//            server whose env had NEXT_PUBLIC_BILLING_ENABLED unset, so
//            isBillingEnabled() was false and every card baked CLEAN and was
//            stamped 20. Bumping invalidates those bakes so the sweep can be
//            re-run with the flag set. Lesson: the sweep server's env must
//            match production's billing flag (see scripts/rebake-renders.mjs).
//   22     — rules-text typography standard (lib/cards/typography.ts): every
//            frame's rules box starts at the printed size (9 pt MPlantin on a
//            full box, 8 / 7.5 pt on tokens, planeswalker rows, sagas, split /
//            flip / adventure halves, battles) and shrinks in half-point
//            steps; tighter print leading (≈1.15 em), half-line ability
//            gaps, inline pips at 0.86 em with a hairline between adjacent
//            pips, flavor text spaced in em with the M15 hairline only on
//            M15-family frames (retro / modern / classic use a gap); retro
//            and modern text blocks vertically centred like print.
//   23     — default set mark: every rarity draws the PipGlyph seal with the
//            same dark keyline outline (lib/brand/constants.ts
//            RARITY_SET_MARK); commons used a light keyline over black ink
//            and read as a different, thinner symbol beside an uncommon's.
//            Only COMMON cards on the default mark changed (VERSION_SCOPES);
//            every other bake is stamped current without a re-render.
//   24     — the M15 family re-sourced from Card Conjurer (frames plan 4.4,
//            owner-approved side-by-side before release): 2010×2814 masters
//            for m15 / m15artifact / m15land / m15snow / m15snowland /
//            m15devoid, CC's planeswalker and bordered-token masters; coloured
//            artifacts with CC's recipe (artifact frame, colour interior —
//            4.16); colourless M15, devoid and the colourless token see-through
//            with the art under the frame (4.17); the P/T plate at CC's own
//            box (4.18) — which also moves P/T on every template that uses the
//            M15 plate; CC's painted planeswalker shield (no plate). Template-
//            scoped, "sweep": a platform correction, never an owner badge.
//   25     — frame-review follow-ups (owner review of every production card,
//            2026-09-25): Alpha P/T moved off the text box's bevel into the
//            printed strip, artist line on the same line (agclassic, and
//            alphaland which clones it); the pipglyph.com brand mark moved
//            into the black border on every frame whose coloured edge it
//            straddled or touched (agclassic, alphaland, alphatoken, retro,
//            retroland, modern, modernland, extendedart, battle, split —
//            landscape marks now sized off the short side); Dragon Wing
//            (tarkirdragon) re-measured: black title ink, sizes, pips, art
//            window, MSE P/T plate. List derived from HD render diffs of a
//            probe card on all 37 templates. Template-scoped, "sweep".
//   26     — the etched finish: the bake wrapped its overlay in a Fragment,
//            which Satori lays out as a zero-width item, so the 3 % inset
//            border collapsed into an 18 px gold strip down the card's left
//            edge and the cross-hatch never painted. Both renderers now draw
//            one shared frame-masked texture (lib/cards/etched-finish.tsx).
//            Card-scoped to finish "etched" on any template (VERSION_SCOPES),
//            "sweep".
//   27     — owner decisions from the follow-up review (2026-09-25): the
//            Alpha frame re-cut to the printed proportions from its MSE
//            source, its lines redrawn the print's way (round 2: one thin
//            dark line on the non-land frame, the land print's coloured
//            lines on alphaland), with light embossed P/T + artist
//            lettering on non-white frames and (round 4) a smaller name +
//            pips, name and type line on one left margin (agclassic,
//            alphaland); two-colour Dragon Wing cards split their wings
//            (tarkirdragon); Ghostfire rebuilt with MSE's translucent boxes
//            + P/T ribbon, white ink (tarkirghostfire); round 4: planeswalker
//            mana cost 6 px and name 8 px lower at HD, placed in Card
//            Conjurer's taller title bar the way printed planeswalkers are
//            (m15pw, every finish).
//            List derived from HD render diffs on all 37 templates.
//            Template-scoped, "sweep".
//   28     — the foil finish: its bake overlay used `inset: 0` + blend modes,
//            which Satori ignores, so foil never reached a saved image. Both
//            renderers now draw one shared luminance-masked holographic sheen
//            (lib/cards/foil-finish.tsx), planeswalker ability stripes
//            included (owner decision, round-2 review). Card-scoped to finish
//            "foil" on any template (VERSION_SCOPES), "sweep".
//   29     — the round-5 leftovers of the owner's frame review (2026-09-25),
//            ONE platform correction. Card-scoped (VERSION_SCOPES[29] is the
//            OR of every track's scope below — no template list, since the
//            two compose with AND), "sweep". Each track was proven on real
//            HD bakes against v28 (0 changed renders outside its scope):
//            * display-font word spacing (4.31): Satori placed each word
//              after a space at the unkerned advances but drew it kerned, so
//              every gap grew by the kerning before it ("Jester's Mask").
//              Names, type lines and the "ART:" footer are one no-break run
//              in both renderers (displayLine), without Beleren's
//              space-pair kerns; token names and type lines centre on their
//              kerned width. EVERY card on the 25 templates whose footer is
//              set in the display face (V29_DISPLAY_FOOTER_TEMPLATES);
//              elsewhere a name or type line with a space in it, and a flip
//              / split back face's. 724 of 726 public production cards.
//            * planeswalker rows (3.13, 3.3): ability rows sized by their
//              text in one shared layout, one badge height, the last ability
//              wrapping short of the loyalty shield when its text would reach
//              it at the full width (4.19, that part); a long
//              name beside a detached cost shrinks to fit before the pips
//              (3.10 for these frames). m15pw (every card) and modern (long
//              names) — both inside the display-footer templates.
//            * Alpha print fidelity (4.31): embossed silver name + type line
//              on the black frame; a colourless ARTIFACT paints MSE's brown
//              artifact card (a.png) in the print's artifact grey. agclassic
//              key b, or key c and an artifact — inside the display-footer
//              templates.
//            * stat values (3.18): P/T, loyalty and defense shrink to keep
//              their ink on the plate and print on one centred line;
//              Draconic's P/T on MSE's plate. statLayoutChanged()
//              (lib/cards/stat-fit.ts), any template; 0 public cards.
//            * foil through translucent rules backdrops (4.31): foil cards
//              on m15pw, m15token, m15tokenartifact, alphatoken, bloomanime
//              and expeditionland (only bloomanime is outside the
//              display-footer templates); 0 public cards change.
//            * aftermath (0.22): the second half turns clockwise, its
//              sideways art fills its window in the bake, both halves print
//              at M15's sizes and the bottom name bar shrinks as one so a
//              long cost stays on it. Template aftermath, every card; 0 in
//              production.
//   30     — the full-art basic land frame re-sourced (frames plan 4.39):
//            `fullartland`'s masters are Card Conjurer's 'Fullart Basics
//            (2022)' frames without their Border mask (borderless, light
//            bars — owner decisions 4.35(a) and 2026-09-26), in the frames
//            bucket, replacing the 744 px MSE composite upscaled 2× that
//            lived in public/frames/fullartland. The bars move by < 1 % H
//            and the mana-symbol disc is painted. Its profile opts into
//            3.23 / 3.24's pieces in the same bump: a basic's symbol in
//            that disc (Card Conjurer's s?.png, no big watermark across the
//            art), the set symbol right-anchored on the type bar (92.13 %W,
//            centred 87.39 %H) at the print's size, Card Conjurer's title
//            and type-line boxes and sizes (measured on 17 prints), the
//            brand mark on its dark pill and the artist line in
//            ON_ART_OUTLINE (both on the art; the bake draws that outline
//            as offset copies — librsvg keeps only the last layer of a
//            multi-layer text-shadow). The masters erase the Card
//            Conjurer ring by subtracting its coverage, so no hairline of
//            its inner edge lies over the art (owner evidence 2026-09-26,
//            same bump). The new
//            templates of 4.32 / 4.39 (m15borderless,
//            m15borderlessartifact, m15fullartland) have no card baked
//            before v30, so they need no scope (the borderless pair's
//            white set-symbol keyline, setSymbolKeyline, is part of
//            them). Template-scoped to
//            fullartland, "sweep": 0 public production cards (anonymous
//            read, 2026-09-26); private rows need the owner's admin count
//            before the sweep.
//   31     — ONE corner radius (TODO 3.26, owner-approved 2026-09-27): 4.3 %
//            of the card's SHORT side (lib/cards/card-corner.ts — 64.5 px at
//            HD in portrait AND landscape, Scryfall's cut), the one constant
//            the CSS clip, the OG composite and the importer read too.
//            * the corner mask: every bake is cut to a transparent rounded
//              corner after rasterising (applyCardCornerMask, the importer's
//              1 px anti-aliased formula, alpha only), so the stored PNG, its
//              WebP thumb and every unclipped use of the URL show the card's
//              true shape. Print (card PDF, Letter/A4 sheets, the Pro deck
//              PDF + ZIP) and the download modal's "Square" PNG are square:
//              the round render squared again, the area outside the arc in
//              the card's border colour (lib/frames/square-corners.ts) — the
//              border black #000 (owner decision), the root's #101015 on a
//              ring whose see-through band IS that colour, or the art /
//              design where it runs into the corner — instead of the old
//              #101015 notch everywhere. A free Square PNG is the stored
//              round bake squared with the same fills.
//            * the Card Conjurer masters re-cut 39 → 64.5 px (frames bucket).
//            * Phase B: the MSE git masters' light paper outside the painted
//              corner, its grey fringe and the fringe's dark tail repainted
//              in the border as it runs beside them (the edge band's depth
//              profile), then cut at the constant — an allow-list (retro,
//              retroland, modern, modernland, saga, aftermath, extendedart,
//              fullart, m15textless, m15textlessland, flip, alphatoken;
//              expeditionland w/u/r/c/m), never a showcase family
//              (Bloomburrow, LOTR, Tarkir, Avatar, battle). Its changes stay
//              inside 96 × 96 px corner boxes: on retro/retroland/modern the
//              paper's anti-aliased edge runs along the card edge to ~77 px
//              from the corner (≤ 9 px from the edge), past the bake's
//              ceil(r)+3 = 68 px box.
//            Every template's bake changes (no template or card scope),
//            "sweep". VERIFICATION-NEUTRAL (VERIFICATION_NEUTRAL_VERSIONS,
//            owner decision): corner pixels move no slot, so a frame_reviews
//            tick from v29 / v30 stays fresh.
//   32     — ONE M15-era title / type size (TODO 4.20, owner-approved
//            2026-09-28): the M15 family (lib/cards/m15-family.ts) prints its
//            names and type lines at Card Conjurer's sizes, which match the
//            prints — lib/cards/typography.ts TITLE_SIZE_PCT 0.0533 W (75 →
//            80 px at HD on M15) and TYPE_SIZE_PCT 0.0453 W (65 → 68 px);
//            the adventure panel at ADVENTURE_PANEL_PCT with its pips at
//            ADVENTURE_PANEL_COST_PCT.
//            * each grown front-face slot keeps its baseline through
//              TextSlot.dy (the TEXT only — the rect, the pips and the set
//              symbol stay where v24–v31 verified them; second faces and
//              the adventure panel stay centred in their bars); the type
//              line's print correction (4.2 px up at HD) only on the Card
//              Conjurer profiles on M15's type bar, never on the M15 base
//              the MSE-framed spreads inherit nor on the tokens' pill; the
//              planeswalker's type line takes M15's slot and its name
//              stays centred on its plate (the v27 relation); the token's
//              type band is centred on Card Conjurer's pill (82.6 → 82.14
//              %H) with its text's dy keeping its baseline, so the bigger
//              set symbol sits in the pill, not on its bevel.
//            * planeswalker, saga and flip cost discs at COST_DISC_PCT
//              (M15's 0.0485), the detached-cost name room re-tuned against
//              print: the walker's cost box ends where the printed pips do
//              (92.2 %W, where M15's inline pips end; it stopped 15 px
//              short), and the name is measured by the box the bake lays it
//              out in, up to one band gap before the first disc
//              (DETACHED_COST_GAP_PCT = BAND_GAP_PCT, the inline cost's gap;
//              lib/cards/title-band.ts) — "Chandra, Torch of Defiance" at
//              78 px like KLD #110, the shorter printed walkers at 80.
//            * names and type lines fitted to the room their band really
//              leaves (TextSlot.fit "measured": fitTitleBand,
//              fitTypeLineBand) instead of the character estimate and an
//              ellipsis — a type line up to TYPE_SYMBOL_GAP_PCT (the
//              prints' 20 px) before the set symbol's INK as drawn, a
//              planeswalker's symbolRect included, the inline symbol pulled
//              over the band gap to give it that room — down to 5 pt of the
//              card's own orientation, and past it ONE "…" both renderers
//              draw; the bake sets a shrunk line at measuredLinePx (the whole
//              px below its fit, never below the floor's) and a shrunk
//              front-face line keeps its band's baseline (slotTextDy). The
//              adventure panel's name and type line too, and flip's
//              upside-down face (fitLines, as aftermath's). The full-art
//              basics keep the old fit path.
//            * the bake paints the rules backdrop under the title and type
//              bands (the preview's z-order): on Expedition, whose rules box
//              overlaps the type bar, it dimmed the bake's type line and
//              set symbol only.
//            * the set symbol in SET_SYMBOL_BOX_PCT (0.0574 W): the default
//              mark and an uploaded icon 72 → 86 px on M15 (the planeswalker
//              and saga in CC's 0.0533 W box, 80 px); a Keyrune glyph fitted
//              to the box by its own ink (font = the smallest of box ×
//              KEYRUNE_EM_PER_BOX, box ÷ the glyph's ink height in em and
//              0.12 W ÷ its ink width; lib/cards/set-symbol-size.ts, the
//              ink boxes in lib/cards/keyrune-metrics.ts) — on a profile with
//              the code-owned setSymbolFit "ink" (the family) only, so an
//              override's symbolSizePct never switches another frame.
//            Rules text is unchanged (its recalibration is its own item).
//            Split and battle are NOT in it (their slots sit off the MSE
//            masters' bars — TODO 4.21) and bake byte-identical, as does
//            every template outside the family. Template-scoped to the
//            FROZEN V32_M15_FAMILY_TEMPLATES, every card on them (every name
//            grows: no card predicate narrows it), "sweep".
//            VERIFICATION-NEUTRAL (owner decision 2026-09-28): the round-8
//            print sign-off stands in for re-ticking the family's combos.
//   33     — rules text laid out by its real lines at the prints' spacing
//            (TODO 3.29, owner-approved 2026-09-28). ONE pure layout,
//            lib/cards/rules-layout.ts, decides the size, every line break
//            (rules AND flavor) and every vertical position, and both
//            renderers draw its lines:
//            * the fit measures MPlantin's real advances (≈ 0.43 em a
//              letter, not the old 0.5 em average; each face's own glyph
//              through Latin Extended-A — «», ß, Œ, the italic ě… — a
//              character a face lacks budgeted a full em) with no safety
//              factor, breaking each line where it fits BOTH bakes — the
//              750 px and the HD, each with its own whole-px gaps and pips
//              (the HD geometry is the preview's, every preview word in the
//              ceiled box Satori gives it) — so the editor, the OG image and
//              the stored PNG draw the same lines, the words in the same
//              places (each bake rounds its own px: the 750 bake's pitch is
//              0.962–0.974 em, 1.0 from 42 to 50 px, against HD's 0.974–
//              0.986, its lines up to 6 HD px and a later word up to 20 HD
//              px from HD's halved);
//            * the prints' spacing: 0.98 em line pitch for rules, flavor and
//              attribution alike (was 1.06 + 0.09 = 1.15 em), a FIXED 24 HD px
//              between abilities (was 0.45 em + the bake's 0.09 em), 30 px
//              either side of the flavor hairline (42 px with none; was
//              0.55 em each side);
//            * an even HD-px ladder (lib/cards/typography.ts RULES_SIZE_PX):
//              ceilings 76 (the prints' 9 pt at 63 mm — was 75), 68 (8 pt —
//              was 66.67), 64 (7.5 pt — was 62.5; and every planeswalker's
//              text, whose prints set at most that — was 8 pt, 66.67 — while
//              any other card on the planeswalker frame keeps 68), steps of
//              2 px to the 42 px floor; tokens take the 76 px standard (the
//              prints set 9 pt);
//            * keep-outs: a size where a line's ink would run into a drawn
//              stat badge (the P/T plate's measured ink, lib/cards/
//              plate-ink.ts; a plain-box walker's loyalty shield — its old
//              0.78 / 0.88 fit rect is gone; the battle's defense disc)
//              steps down — judged glyph by glyph (a word with no
//              descender just above the plate is clear of it); a first
//              line's accented capital, and a line's first or last glyph
//              drawn past its advance (an italic f, j or p, a roman f, a
//              pip's shadow), get the headroom their ink needs, so the box's
//              clip never cuts a letter; a text that doesn't fit even at the
//              floor is set from the box's top, so the clip takes its tail,
//              never its first line (a centred box cut both ends);
//            * M15 and its skins print to the prints' margins (4 / 0 HD px,
//              was 9 / 18); every other box keeps 9 / 18 HD px on both
//              orientations (a landscape box's was 40 % more), the adventure
//              page 9 / 15, a second face 18 / 12; split's halves, whose
//              boxes hold the frame's textbox border, 24 / 16 HD px inside
//              that border (the MSE split style's margins — the first cut
//              set an italic "f" on the gold);
//            * the bake's flavor hairline is a 1 px box, not a border: Satori
//              clips a border with a clip path of its own, so on text
//              clipped at the floor the bar escaped the box and drew a line
//              across the frame below it (same pixels everywhere else);
//            * the tokenizer glues only what touches: "{B} equal" and
//              "(remix) deals" were drawn "ⓑequal", "(remix)deals" (54 of the
//              731 public cards measured), and "{T}:" inside a reminder now
//              stays whole (16 more); a lone em dash after a word ("choose
//              one —", "Landfall —") never starts a line — it breaks with
//              its word, as the vow-63 print sets "choose up to" / "one —"
//              (no current card had one);
//            * ability words refreshed from Scryfall's catalog (TODO 1.13,
//              the committed fixture of 2026-09-28: 48 → 69 words — Eerie,
//              Void, Survival… — "Descend 4" and a curly apostrophe read);
//            * planeswalker ability rows sized by each ability's real lines
//              (0.98 em, the 24 px gap, 10 HD px of row padding — whole px at
//              both bakes, no safety) on the ladder from 64 px: no row ever
//              overlaps the next (the old estimate's rows did, and clipped
//              long walkers at 5 pt); the row anatomy — badge, rail, padding
//              — keeps ONE size (46 px's ems: the text starts at x 275, the
//              walker prints' 274–276) whatever the text's; the last row
//              still wraps short of the loyalty shield only when its lines,
//              where their row puts them, would reach it (the 7 public
//              walkers: 5 → 5.5–6.7 pt, Jace 7.5 → 7.6 pt at 63 mm);
//            * saga chapter and intro text through the same line drawing at
//              TODAY'S size, rows and badges (real pips, reminder italics,
//              U+2212) — its geometry is TODO 4.21's; an intro too tall for
//              the rail (a saga typed with no chapter markers) is clipped
//              at the rail's foot instead of running over the type line.
//            Public cards (731 cached, real bakes): the main box's median
//            58 → 72 HD px; 569 of 706 grow ≥ 0.5 pt, 463 ≥ 1 pt; 336 print
//            at 76; none shrinks at either bake; 21 still clip at the floor
//            (15 token lands in the 12 %-high token box, 6 long M15 cards).
//            Every template draws rules text (no template scope). Card-scoped
//            (VERSION_SCOPES[33], v33PrintsText): a card whose bake prints
//            rules, flavor, loyalty or chapter text — rules_text /
//            flavor_text, face_content's loyalty abilities, saga chapters or
//            intro, a back face's text — never a card on a frame that prints
//            no text box (FrameProfile.textless; none at v33 — the "M15
//            Textless" frames print their text on the art) nor a basic
//            land's (it prints none). "sweep" (owner decision
//            2026-09-28). VERIFICATION-NEUTRAL (owner decision 2026-09-28): no
//            slot, bar or rect moves, but text inside the rules boxes does
//            (M15's box padding, walker row edges and badges, split's
//            halves padded past their border and the right one honouring
//            vAlign), so the alignment scores stored with frame_reviews
//            ticks would change on a re-score; the round-9
//            print sign-off stands in for re-ticking.
//   34     — the token release (owner decisions 2026-09-29), ONE bump for
//            two tracks:
//            * today's token frame against the 2014–19 arch prints (TODO 4.49
//              (a) + (d); lib/cards/template-layout.ts M15TOKEN): the P/T on
//              M15's plate — CC's plate box 75.73 / 88.48 / 18.8 × 7.33 moved
//              0.13 %H down onto the prints (88.61; TOKEN_PLATE_PRINT_DY_PCT),
//              the 4.18 value box, 0.05 W dark ink (was white ink on the
//              frame's edge at 0.0427 W) — m15/pt/{color} on m15token,
//              m15artifact/pt/{color} on m15tokenartifact (CC's silver plate
//              for `c`, the colour's own otherwise, as TC18 #7 prints); the
//              type line left-aligned from 8.54 %W to the symbol, its
//              baseline 1796 → 1800 HD px (TOKEN_TYPE_PRINT_DY; 15 prints
//              1797–1803, mean 1800.4); the set symbol in its own
//              symbolRect, right edge 92.13 %W. The 14 masters RE-CUT
//              (owner decision 2026-09-29, scripts/lib/cc-frames.mjs
//              TOKEN_TEXTLESS_RECUT; TOKEN_RECUT_PX): CC's window edge, type
//              pill and the pill's shadow 8 px lower, as the prints draw
//              them (CC's sat 8.2 px above the 15 pins; −0.9 … +1.6 after,
//              by edge), over the top of the texture below — the title bar,
//              texture, border and corners unmoved; the art slot 8 px
//              taller (69.0 → 69.38 %H, the art's cover fit +0.55 %), the
//              type band on the moved pill (the baseline stays at 1800),
//              the symbol box centred on the moved pill again, 84.77 %H
//              (CC's 84.39 + 8 px; tall glyphs sat on CC's bottom bevel).
//              Against the 15 textless pins (HD px, ours − print mean): P/T
//              digits' centre +0.6 x / −1.3 y, plate +0.7 (median −0.5; was
//              −2.7), symbol centre −0.1 (was −8.3), type baseline 1800 on
//              all 15 (prints 1800.4), type line +4 px from the left, symbol
//              right edge ±1 px (DOM, KLD); the symbol's ink 5–9 px clear of
//              the pill's bottom bevel (it reached 1–3 px into it); the
//              alignment score (lib/frames/align.ts) 94.47 → 94.99 %. Nothing above y 1640
//              moves (the name, rules scrim — 4.49 (b) and 4.53 are open)
//              but the art's scale. Every card on m15token /
//              m15tokenartifact changes (every one has a type line and a
//              symbol).
//            * "Token" first on the type line (TODO 3b.15; buildTypeLine):
//              "Basic Token — Wastes" → "Token Basic — Wastes", "Token —
//              Soldier" → "Token Creature — Soldier" once migration 0128 gives
//              a word-less P/T token its "Creature"; a token prints its P/T
//              only with Creature or a Vehicle / Spacecraft subtype
//              (printsPowerToughness — a stored word-less token keeps its
//              P/T), so a Treasure's stray 1/1 goes. That is buildTypeLine on
//              EVERY template a token can sit on (alphatoken, the showcases,
//              flip's Roles), so it is judged by the card, not a template
//              list (tokenTypeLineChanged).
//            Card-scoped (VERSION_SCOPES[34] = v34Changed: every card on the
//            two token frames, OR a token whose printed line changes on any
//            other template; no TEMPLATE_SCOPED_VERSIONS row — a list there
//            would AND away the tokens on alphatoken and the showcases).
//            Public production (anonymous read, 2026-09-29): 32 cards on
//            m15token, 0 on m15tokenartifact / alphatoken, 0 tokens on any
//            other template — all 32 re-bake; real HD bakes of all 731
//            cached public cards (v33 vs v34) change exactly those, and of a
//            40-template matrix with token rows on every template 244 of
//            1,080 change, exactly the 244 v34Changed selects. "sweep".
//            NOT verification-neutral (owner decision 7, 2026-09-29): the
//            frame's slots move, so a tick on m15token / m15tokenartifact
//            goes stale — the 14 legacy ticks included
//            (LEGACY_TICK_LAYOUT_VERSION) — and every other template's
//            stays fresh (VERIFICATION_TEMPLATE_SCOPES[34]: the wording alone
//            is verification-neutral). A stale tick is still verified: the
//            creator keeps offering the frames.
//   35     — the art-area corrections (owner decisions 2026-09-29), ONE bump
//            for every place the bake showed its #101015 ground where the
//            print shows art — found by 7.6's art-window check, each struck
//            from ART_WINDOW_KNOWN_FAILURES (lib/frames/art-window.ts).
//            Measured on the sha-checked masters (#101015 px a frame lets
//            ≥ 2 % through with no art beneath, per master):
//            * the CC M15 art slot (TODO 4.4 (2); CC_M15_ART_SLOT
//              7.67/11.25/84.76 × 44.33 on m15, m15land, m15snowland,
//              m15artifact, m15snow, m15devoid — was M15's MSE 7.8/11.4/
//              84.4 × 44.0): the masters' window 116–1384 × 238–1165 now has
//              0.95 / 2.45 / 1.75 / 2.18 px to spare; the 1–1.6 px hairline
//              on every side goes, 10,046 → 0 px per master. The MSE-framed
//              adventure keeps M15's slot.
//            * under-frame art from the border's inner edge (4.17a;
//              UNDER_FRAME_RECT 3.7/2.7/92.6 × 93.3, was 4/4/92 × 92): the
//              see-through body starts 58–59 px in, the art started at 84 —
//              a 25 px band above the title bar on m15/c, every m15devoid,
//              m15token/c and m15tokentext/c (every pixel α < 250 not fully
//              under art: 42,743 → 0 px on m15/c — 34,274 in the band above
//              the title bar, 8,469 down the sides —, 37,514–37,530 → 0 on
//              the token c's, 3,024 → 0 (sides) on the coloured devoids; the
//              prints' border ends 2.69–2.88 %H / 3.76–4.16 %W in, nine
//              prints).
//            * nyx: the art runs under the whole translucent text box, as on
//              the THB constellation prints (4.17b, owner decision; artSlot
//              height 70 → 81.8, to 93 %): 308,720 → 0 px — the box's last
//              241 px were #101015. fullart: artSlot 4/2.9/92 × 88.3 →
//              3.8/2.7/92.4 × 90.3 — to 93 % (the 31 px strip) and out to
//              whole pixels past the hedron ring's anti-aliased rim (α 128–
//              249 on rows 59–60, columns 59 / 1440–1441): 46,500 → 9 px, a
//              3 × 3 speck at α 246–249 just below the box (x 1401–1403,
//              y 1953–1955). m15pw/c: underFrameArt for "c" as ONE picture — its
//              window drawn in the under-frame rect too (UnderFrameArt
//              .artSlot): CC's colourless walker is translucent from the
//              border to the window with no outline down the ability box, so
//              M15PW's slot over a separately cropped under-frame layer (the
//              first build) seamed all round; 334,216 → 0 px, the window's
//              picture ~14 % larger than on the coloured walkers.
//            The art-window check (7.6) and the frame-compare save gate
//            gained two see-through rules in the same round: the window's
//            slot covers the window too, and meets the under-frame art on
//            the frame's opaque outline (or is one picture) — the colourless
//            tokens' seam, there since v34, is its known failure (4.17c).
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[35]) AND card-scoped
//            (VERSION_SCOPES[35] = v35Changed): every card on the eight
//            art-slot templates (V35_ART_SLOT_TEMPLATES — the empty-art box
//            moves too), and on m15token / m15tokentext / m15pw only a
//            colourless card with art (V35_SEE_THROUGH_C_TEMPLATES: the
//            under-frame layer is drawn only under art). Public production
//            (anonymous read, 2026-09-29): 740 of 827 public / unlisted cards
//            — m15 611, m15land 49, m15artifact 37, m15devoid 20, m15snow 13,
//            m15tokentext 9 of 33, m15pw 1 of 7, none on m15snowland,
//            m15token, nyx, fullart; re-baked, all 740 change, only inside
//            their art rects, and none outside the scope. The visual matrix
//            (tests/visual), 841 cases (after #429's 16 removals) against
//            v34: 162 stored cases change + 1 print-only one
//            (m15/w/creature-short@square, which the gate exempts), every
//            one inside the scope, and the scope selects no unchanged case;
//            8 no-art cases are new (the empty-art box on v35's slots, and
//            no under-frame change without art). "sweep". VERIFICATION-NEUTRAL (the
//            default for small art-edge fixes, as v31–v33): no text, bar,
//            pip, symbol or plate moves — see VERIFICATION_NEUTRAL_VERSIONS.
//   36     — the second correction round (owner rule 2026-09-29: looks
//            wrong against their own prints), ONE bump for three fixes,
//            each measured on the prints (Scryfall PNGs, 745 px, scaled to
//            the 1500 px card):
//            * inline rules pips on the capitals (TODO 3.31; lib/cards/
//              typography.ts RULES_TEXT, rules-layout.ts metricsFor
//              .pipTopPx): 37 inline discs on 14 prints (DOM #168, AER
//              #106, FIN #188, BFZ #223, MH1 #230, ELD #196, SOI #258, M20
//              #178, TDM #126, EOE #170, TFDN #22 / #23, TLCI #17, TMKM
//              #14; each disc circle-fitted, the em from its line's cap
//              height) centre 0.323–0.348 em above the baseline (mean
//              0.334, half the 0.682 em cap height — not the x-height) and
//              measure 0.754–0.812 em across (mean 0.785). Ours were
//              centred in the line box at 0.86 em: 21 px up and 65 px wide
//              at 76 px type where the prints put 25 px and 60 px. Now
//              pipDiscEm 0.785 (60 px) and pipCentreEm 0.334 (25 px up;
//              13 at the 750 bake's 38 px); both renderers draw the disc at
//              the layout's pipTopPx. The narrower disc can move a line
//              break or a size step on text with pips (the list is in the
//              PR); 3.17's flat pips are not part of it.
//            * Keyrune set symbols at their set's printed size (TODO 4.46;
//              lib/cards/set-symbol-prints.ts): a per-set table of the
//              prints' keyline-inclusive symbol boxes, 30 sets (33
//              measured — the creator's 12 presets, the 4.20 check's sets
//              and seven more — each on a rare and an uncommon; BFZ, WAR
//              and ZNR already drew at their print's size to the whole px,
//              so they stay on v32's fit — on the walker and saga bars
//              too, at 80 px where their prints set ~86: owner round 18,
//              later); the glyph fitted inside its set's box by its ink,
//              never past CC's 0.12 W but for the three core-set pills,
//              which print wider (M19 / M20 / M21, 187.5–189 px:
//              SET_SYMBOL_PRINTED_PAST_CAP, owner round 18). Ink height ÷
//              the print's, v35 → v36: NEO 0.64 → 0.97, DSK 0.64 → 1.00,
//              M20 / M21 / M19 0.47 → 0.91–0.92 (at the print's width;
//              Keyrune's pill is 9 % longer in proportion), OTJ 0.58 →
//              0.90, FDN 0.88 → 1.00 (keyline-inclusive, as measured —
//              owner round 18: kept), DOM 0.97 → 1.00; every set 0.47–1.03
//              → 0.88–1.00, never past the print's height or width; the
//              walker, saga and token prints print it at the regular size
//              (0.98–1.01), so the thin-bar box no longer shrinks a listed
//              glyph there. The full-art basics keep 4.39's size
//              (setSymbolFit "ink-box"), an unlisted set v32's ink fit. The
//              boxes are keyline-inclusive, so the borderless bars, which
//              draw a white keyline round the glyph (4.32), fit its ink AND
//              the ring (review of this round: the ink alone stood 8–15 px
//              past the box there, the core-set pill 198 px wide; now 85.5–
//              86 × 182–183, the print's height binding).
//            * the planeswalker's set symbol ends where M15's does (TODO
//              4.47; M15PW.symbolRect left 79 → 80.2 %W, right edge 1365 →
//              1383 px): seven walker prints put it where their set's
//              regular cards do (+0.1 px on average), 1380–1392 px. The
//              borderless walkers (4.33) spread m15pw's rect and move with
//              it (their prints: 1383–1393 but ELD #271's 1369; owner round
//              18: move them). A symbol wider than a 12 %W symbolRect (the
//              core-set pills) is never shrunk to it: it ends at the rect's
//              right edge in both renderers.
//            Card-scoped (VERSION_SCOPES[36] = v36Changed; no template list —
//            the pips reach every template): every card on m15pw,
//            m15borderlesspw, m15borderlesspwtall (every walker draws a
//            symbol, the mark when it has none); a card that may draw a
//            listed set's Keyrune glyph on a printed-size template
//            (its code is listed — an uploaded icon doesn't rule it out: the
//            renderers drop one they may not draw and draw the glyph); a card
//            whose printed text has an inline pip. "sweep".
//            VERIFICATION-NEUTRAL (owner round 18, 2026-09-30, on the
//            walker sheet; VERIFICATION_NEUTRAL_VERSIONS): the pips (text
//            inside the rules boxes, as v33) and the symbol sizes (as v32)
//            move no slot, and 4.47's walker symbolRect move — a scored
//            box, lib/frames/align.ts — follows v32, which moved
//            m15pw's costRect onto the prints and stayed neutral.
//   37     — nyx's type bar and text box darkened to the THB constellation
//            prints (TODO 4.17e; owner rounds 13 and 18, 2026-09-29/30 —
//            split out of v36 so v36 ships on its own): MSE's masters paint
//            both flat black at 50 %, and since v35 the art runs under both.
//            On #258 Daxos, #259 Heliod and #268 Klothys (Scryfall PNGs
//            scaled to 1500 px; median luminance without the text, over the
//            art window's bottom strip) the box lets 0.28–0.39 of the art
//            through (mean 0.33) and the type bar 0.36–0.46; ours let 0.50
//            through both. The seven masters are rebuilt from MSE's sources
//            (scripts/build-variation-frames.mjs --only nyx, scripts/lib/
//            nyx-tone.mjs): the box's black α 127.5 → 171 / 255 (0.33
//            through), the bar's → 150 (0.41, the range's middle), the
//            frame's anti-aliased edge within 3 px of each keeping its
//            colour and coverage over the darker black; 907,896 px per
//            master, rows 1197–1938, nothing else. Template-scoped
//            (TEMPLATE_SCOPED_VERSIONS[37] = nyx): every nyx card, art or
//            none (the bar and box draw over the ground too). Public
//            production (anonymous read, 2026-09-30): 0 cards on nyx. The
//            visual matrix: only the nyx cases change. "sweep".
//            VERIFICATION-NEUTRAL: no slot moves (a master's black only),
//            and nyx has no tick.
//   38     — the portrait layouts re-sourced from Card Conjurer (TODO
//            4.21a; design 2026-09-29, owner decisions 2026-09-29): flip,
//            adventure and aftermath leave their 241–375 px MSE composites
//            (git) for CC's native 1500×2100 masters (the frames bucket,
//            scripts/lib/cc-frames.mjs). Measured against the M15 prints
//            (Scryfall PNGs at 1500 × 2100):
//            * flip sat 30–80 px low from the title bar down against C18
//              #134 Budoka Gardener and CM2 #71 Nezumi Graverobber (the
//              only M15-frame flips): the title bar 105–215 px against the
//              prints' 71–177, the window 648–1393 against 626–1308, the
//              upside-down type bar 1417–1518 against 1338–1444. Every rect
//              is packFlip.js's; the art slot the masters' window + 0.1 %
//              (7.57/29.57/84.87 × 33.25 — CC's window, 623–1317: it drew
//              the bottom half as the top half turned, so its window ends
//              9 px below the prints' and its upside-down type bar sits
//              5 px below theirs, the master's own geometry); the top
//              name's and type line's dy and the pips onto the prints
//              (−9.2 / −4.9 / −9.6 px; the cost ending at 92.5 %W, the
//              prints' last disc at 1387 / 1388.5 px — the pack's mana box,
//              not its title box's 91.46), the
//              upside-down bars where the prints' text centres; the set
//              symbol in CC's box (right 78.4 %W, centred 26.0 %H). The P/T
//              plates (a CORRECTION — every printed M15 flip creature has one
//              per half; the vehicle plate's opt-in is the nearest rule, so
//              it was flagged and the owner called it): CC's two-plate image
//              cut per half (pt/<k>-top.png, pt/<k>-bottom.png), drawn only
//              when the half has a P/T; the bottom one upside-down as the
//              source draws it, unturned. Colourless = CC's see-through
//              frame with the art under it from the border (4.17a's
//              UNDER_FRAME_RECT). No crown. The artist credit (3.8's slice)
//              on M15's footer line.
//            * adventure: the CC master (M15's bars with the storybook) for
//              the MSE composite whose window ran 10 / 6 px narrow; the art
//              slot PINNED at the masters' window + 0.1 % (7.57/11.19/84.87
//              × 44.44, design D4: never M15's or CC_M15_ART_SLOT's again);
//              the panel's name and type line 8.14–48.14 %W centred on ELD
//              #115's (1367.3 / 1460.3 px), its cost to 48.14; the pages
//              8.54–48.01 × 73.58–88.58 and 52.67–91.34 × 65.0–88.58; the
//              type line and pips take the CC-framed M15 profiles' print
//              offsets (CC_M15_TYPE_DY, CC_M15_COST_DY).
//            * aftermath: the CC master (textured cream boxes) for the MSE
//              stack with flat white boxes; the art slots the windows +
//              0.1 % (7.57/11.19/84.87 × 22.44; the sideways one 44.63/
//              63.62/49.41 × 20.33); the set symbol in CC's box (right
//              92.13 %W, centred 37.1 %H); the artist credit on M15's
//              footer line. The text slots stay (print-matched in 0.22 /
//              v32).
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[38] = adventure, flip,
//            aftermath): every card on the three, art or none. Public
//            production (anonymous read, 2026-09-30): 0 cards on any of
//            them (private cards and previews: owner SQL). The visual
//            matrix: only their cases change. "sweep" (a correction, FRAMES.md
//            "Additions vs corrections"). NOT verification-neutral: their
//            slots move — but no tick exists to stale (adventure's 7 rows
//            and aftermath/w are unverified, flip has none), so the first
//            ticks are the owner's after the deploy (C18 #134 flip/g, CM2
//            #71 flip/b, the adventure and aftermath prints).
//   39     — flip's lower half and aftermath's cost onto the prints (TODO
//            4.21a follow-up; the independent check of #451, owner decision
//            round 22, 2026-10-02 — fixed before flip is verified):
//            * flip: CC drew the bottom half as the top half turned, and the
//              two printed M15 flips are not that symmetric. On C18 #134 and
//              CM2 #71 (Scryfall PNGs at 1500 × 2100, the master's profile
//              blurred to the scan, per-band correlation + half-level
//              crossings, both prints within 0.5 px) the window's inner line
//              and the upside-down type bar's dark top band sit 7 px higher
//              than the master's (the line centred 1311 against 1318.5),
//              the bar's bottom outline and the text box's top edge 5 px
//              higher (1444.7 / 1466.5 against 1449.7 / 1470.8), the
//              upside-down name bar where CC has it. The importer re-cuts
//              the masters' lower half in two pieces (scripts/lib/
//              cc-frames.mjs FLIP_LOWER_RECUT: rows 1290–1339 up 7, rows
//              1340–1499 up 5, split inside the bar's flat bevel plateau;
//              every row above 1283 and from 1500 on CC's byte for byte) —
//              seven new masters, the plates unchanged — and the profile
//              follows: the art slot's bottom (33.25 → 32.91 %H: the window
//              ends at 1310 px, was 1317) and the upside-down rules rect
//              (its box's paper from 1467 px, was 1472). The upside-down
//              type line keeps its print-matched baseline (the bar moves
//              under it), the name bar, the top half, the cost and the
//              plates do not move.
//            * aftermath: the top half's cost was never print-matched (the
//              same on the MSE master). AKH #210–214 and HOU #157 end the
//              last disc at 1383–1385 px (mean 1384.0) with the discs
//              centred 158–161 (mean 159.4); ours ended at 1357 and centred
//              168. The title rect runs to 92.3 %W (was 90.5) and costDy
//              lifts the discs 8.6 px; the name's baseline and left edge,
//              the type line and the set symbol do not move.
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[39] = aftermath,
//            flip): every card on the two, art or none. Public production
//            (anonymous read, 2026-10-02): 0 public or unlisted cards on
//            either. The visual matrix: only the 20 flip + 18 aftermath
//            cases change. "sweep" (a correction). NOT verification-neutral
//            (a master and slots move) — no tick exists on either to stale:
//            the owner walks flip/g (C18 #134) and flip/b (CM2 #71) and the
//            five AKH aftermath colours after the deploy.
//   40     — the modal backs' flipside strip toned onto the prints (TODO
//            5.1d; the 5.1b skeptic's finding, 2026-10-05): Card Conjurer's
//            light strip on the modal BACK masters read 14–44 luma darker
//            than every mono-colour print's (u 208 vs STX #147's 220 / MH3
//            #241's 231, b 175 vs STX #148 / KHM #112's 221 / ZNR #90's 212,
//            r 212 vs STX #159's 230 / ZNR #134's 228, g 201 vs STX #151's
//            229 / ZNR #189's 218) and 38 on the gold back (195 vs KHM
//            #168 The Prismatic Bridge's 233), so the importer multiplies
//            the whole tab through the pack's Flipside mask (scripts/lib/
//            cc-frames.mjs MDFC_BACK_TONES / MDFC_LAND_BACK_TONES `strip`:
//            one table per template, the spell backs on STX / KHM, the
//            land backs on ZNR / MH3; w within the prints' spread,
//            untouched; the ◀ and the outline stay dark) — ten re-cut
//            masters (m15mdfcback u b r g m, m15mdfclandback u b r g m;
//            the land back's gold key is the spell table's stand-in).
//            With it (the 5.1d skeptic, 2026-10-05) the transform FRONT's
//            reverse P/T became a rules FLOAT (DrawnStats.reversePt →
//            RulesLayoutInput.floats; lib/cards/stat-fit.ts
//            endAlignedStatKeepOut): 5.1a drew the back's P/T in the grey
//            tab but never set the rules lines round it, so a dense text
//            ran under the digits — a correction on the two front bodies
//            with the tab (m15dfcfront, m15dfclandfront), whose long bakes
//            change.
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[40] = the modal
//            faces: the two front templates a modal card is stored on,
//            whose BACK bake changes, and the two back bodies the visual
//            matrix bakes as faces — and the two transform front bodies,
//            whose rules layout changes): every card on them. Production
//            (2026-10-05): 0 cards on any DFC body — the bodies are not
//            ticked yet, nothing is offered — so the sweep re-bakes
//            nothing; the bump is the visual gate's record of a master
//            correction (v38 / v39's pattern), never a badge ("sweep").
//            NOT verification-neutral on the two modal back bodies (their
//            masters change) or the two transform front bodies (their rules
//            layout does) — no tick exists on any of them to stale
//            (VERIFICATION_TEMPLATE_SCOPES[40]); the modal front bodies'
//            masters and layout are untouched (the crown and the pairs of
//            5.1d are opt-in additions: new masters and overlays, no bump).
//   41     — the modal flipside strip RIDER (TODO 5.1c, 2026-10-06): on a
//            two-colour modal card the prints paint the strip in the colour
//            of the face it DESCRIBES (STX #147's green front a blue strip,
//            the pathways' fronts their back's, KHM #114's front the B/R
//            back's gold); the masters paint their own. Both renderers now
//            draw the OTHER face's tab — the masters' own tabs cut through
//            CC's Flipside mask, <template>/strip/<key> — over the strip,
//            under its texts, only when its key differs from the master's
//            own (lib/cards/anatomy.ts resolveFrameOverlays, faces.ts
//            stripKeyOf): a mono-colour card's bake is the master's bytes.
//            An ADDITION under the rollout rule, bumped only because the
//            visual gate refuses a changed existing case without one: the
//            matrix's two-colour-other-face modal cases (a B/R back under
//            the Tibalt word case, the gold and colourless land backs of
//            the wu / wub / c rows, the hybrid pair, the gold land pair)
//            change — 14 cases — while every mono case is unchanged.
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[41] = the four modal
//            faces). Production (2026-10-06): 0 cards on any modal body —
//            the sweep re-bakes nothing, badges nothing ("sweep", as v40:
//            never a badge; every other v40 card is stamped 41 unbaked).
//            NOT verification-neutral (the 5.1c skeptic): no master, slot or
//            text moves, but the registry's references for the spell BACKS
//            (STX's modal cards, one colour per face) and the land FRONTS
//            (the pathways) are two-colour cards, m15mdfcfront/m's is MH3
//            #252 (a hybrid front // a two-colour land) and the land back's
//            eight alternates are pathways — 12 of the 22 primary references
//            and 15 alternates draw a rider on the compare page now, so a
//            tick made there before v41 judged a look that no longer
//            renders. Every one of the four templates has such a reference
//            and a tick's scope is its template: the four faces' ticks are
//            judged by this bump's own scope (no narrower VERIFICATION_
//            TEMPLATE_SCOPES entry, as v38 / v39). A tick made before v41 is
//            KEPT (the creator goes on offering the face —
//            getVerifiedFrameKeys reads `verified` alone) and FLAGGED "needs
//            re-verification" on the admin checklist until it is ticked
//            again; nothing is dropped.
//   42     — the saga rebuilt from Card Conjurer (TODO 4.21c = 3.7; design
//            2026-09-29 §3.4, owner decisions 2026-09-29, built 2026-10-06).
//            A CORRECTION against the prints (Scryfall PNGs at 1500 × 2100:
//            DOM #21 / #38 / #42 / #90 / #102 / #122 / #173, THB #53 / #160 /
//            #170, 40K #126, LTC #58, WHO #99, LTR #174, MH2 #259 and 40
//            more — the rail measured on 54):
//            * the masters: CC's 'Regular Frames' saga pack 1:1 (w u b r g m
//              = sagaFrame<K>; c = its Land Frame, MH2 #259) for the 375 px
//              MSE cut — the chapter RIBBON is in the master now; the art
//              slot is the masters' window + 0.1 % (50.03/11.19/42.4 ×
//              72.68: the window is 752–1384 × 237–1758 px on every key; the
//              MSE slot started 26 px left of the prints' window); the cost
//              discs at the CC-framed M15 height (CC_M15_COST_DY: DOM #122's
//              centre 151.5 px, 40K #126's 153), the title rect to 92.2 %W
//              (the last disc ends 1383–1386); the type line's baseline on
//              the prints' 1855.3 px (+9.3 px, TextSlot.dy) from 8.5 %W; the
//              set symbol in CC's box (right 92.27 %W, centred 87.39 %H —
//              the prints end 1380–1384, centred 1835–1836.5).
//            * the rail (lib/cards/saga-rail.ts, one layout both renderers
//              draw): the reminder block in its own fixed box (62 px on a
//              62 px pitch: the prints' baselines 341 / 403 / 465 / 527; its
//              emphasis the text's own, where v33 set the whole block
//              italic; its lines out of the fold's corner; one the box
//              cannot hold at the ladder's floor — past ≈ 240 characters —
//              outgrows it: the floor size, the chapters' column, the rows
//              under it, as v41 drew every reminder in full); the rows from
//              the first divider at 621 px (the
//              prints' 619–621 on 50 of 54 scans; CC draws 608), or from the
//              rail's own top (237 px) when the saga has no reminder (owner
//              decision 2026-09-29); the chapter text at 64 px on the rules
//              ladder (v33: 43.5) in the column 203–728 px; rows sized by
//              their content — never shorter than their stack of chapter
//              badges — with the rail's leftover shared equally (the walker
//              rows' arithmetic, lib/cards/loyalty-rows.ts contentRowsAt;
//              v33 gave every chapter the same height); the pack's gold
//              hexagon (118 × 132 px) once per chapter numeral, stacked 160
//              px apart where the rows have room (DOM, THB, KHM, 40K, WOE,
//              PIP) down to 138 px where they do not (LTC #58 138.3 / 138.6,
//              WHO #99 138.0) — v33 drew ONE dark badge with the joined
//              marker ("II,III,IV"); the numerals in MPlantin at 72 px (the
//              prints' Plantin semibold is TODO 4.8); the pack's divider on
//              every row's top edge but the first row of a saga with no
//              reminder. Up to six badges stack in one row, as the prints do
//              (LTR #174 six, WHO #99 five); the combined marker ("I–III")
//              is drawn only where stacks cannot fit — alone (repeated
//              numerals) or beside the text at the ladder's floor (before a
//              chapter loses a line: v41 drew one marker a row) — or past
//              six. The reminder is one paragraph, as v41 drew it.
//            The walker rows moved onto the shared arithmetic and are
//            byte-identical (tests/unit/cards/loyalty-rows-pinned.test.ts,
//            tests/unit/render/pw-rows-pinned-bake.test.tsx).
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[42] = saga): every
//            card on it, art or none. Public production (anonymous read,
//            2026-10-06): 4 public sagas, one owner, none with a reminder
//            (3 gold, 1 blue; I/II/III, I–IV twice, I / II,III,IV / V / VI)
//            — re-baked by the sweep after the owner's before/after sheet
//            (round 34); unlisted and private ones: owner SQL (the sweep
//            re-bakes public and unlisted cards, a private one re-bakes on
//            its next save). The visual
//            matrix: only the saga cases change. "sweep" (a correction,
//            FRAMES.md "Additions vs corrections"), never a badge. NOT
//            verification-neutral: the masters, the art slot, the type line
//            and the whole rail move — production's seven saga ticks are
//            judged by this scope: KEPT (the creator goes on offering the
//            saga) and FLAGGED "needs re-verification" until the owner
//            ticks them again against the registry's references (saga/m is
//            40K #126 now, with LTC #58).
//   43     — the landscape layouts re-sourced from Card Conjurer (TODO
//            4.21b; design 2026-09-29, owner decisions 2026-09-29; built
//            2026-10-06): split and battle leave their MSE masters (git)
//            for CC's (the frames bucket, scripts/lib/cc-frames.mjs — the
//            first LANDSCAPE recipes, 2100 × 1500). Measured against the
//            prints (Scryfall PNGs turned a quarter turn clockwise at 2100 ×
//            1500, each edge registered by correlation):
//            * split: CC's 'Split' pack turned clockwise without a resample
//              (two half-cards with their own coloured body) for the MSE
//              composite of two half-frames on a black canvas. The pack's
//              collector border is 160 px where MH2 #123 / #60 and TSR #161
//              / #186 print 147–148, so the importer moves the left half 11
//              px left and the right half 3 px through the flat black
//              border and spine (SPLIT_HALF_RECUT: byte for byte): every
//              edge within 3.6 px of the four prints' mean (was up to 14.3).
//              The art slots are the windows + 0.1 %. The prints set a
//              split half SMALLER than a regular card on every line, so
//              split stays out of the M15 family with constants of its own
//              (lib/cards/typography.ts): the name 76 px (the design's 80
//              came out 4–6 % wide on ten names), the type line 53 px on
//              its 69 px bar (the design's 60, Card Conjurer's 0.0286 H,
//              set "Sorcery" 201 px wide against the prints' 177–178), the
//              pips 68 px, the set symbol fitted by its ink's HEIGHT to a
//              48 px box (setSymbolFit "ink-height"). Both halves are
//              `fit: "measured"` — the right one, an unturned second face,
//              drawn exactly as the front draws its own lines — and both
//              sit on the prints' baselines relative to their bars; the
//              rules at the 9 pt ladder top, centred as the prints centre
//              theirs. No coloured half-pair (TODO 4.26), no fuse.
//            * battle: CC's 'Battle' pack (2814 × 2010 → 2100 × 1500 in one
//              Lanczos pass) for the MSE master with no border, siege arc,
//              icon or shield. Nine MOM battles print the type bar, the
//              text box and the shield 2.5–5.5 px lower than the pack, so
//              the importer moves that block 4 px down through flat rows
//              (BATTLE_BLOCK_RECUT, then named BATTLE_LOWER_RECUT: within 1.5 px of their mean; the
//              prints' bars also end 8–11 px further right, which no block
//              move reaches — kept as the pack has them). ONE art rect for every colour,
//              from the border's inner edge to the bottom border (the
//              window runs on in a sliver beside the shield), which is also
//              the see-through colourless master's under-frame picture. The
//              battle JOINS the M15 family through `displayPct(…,
//              "landscape")`: an 80 px name with M15's tracking (it starts
//              right of the icon, 23 px into the pill — closes 3.28), a 68
//              px type line, the family's cost disc and symbol box, each
//              on the prints' baseline relative to its bar. The defense is
//              the value alone, white, in the shield the MASTER paints —
//              the drawn disc and its outline are gone — and that shield is
//              a rules keep-out on every battle.
//            * both: the artist credit down the left border, M15's footer
//              line turned with the card (FrameProfile.footerTurn — 3.8's
//              slice; the collector number, set and language beside it are
//              4.9d's); the brand mark centred in the new bottom border.
//            Template-scoped (TEMPLATE_SCOPED_VERSIONS[43] = battle, split):
//            every card on the two, art or none. Public production
//            (anonymous read, 2026-10-06): 0 public or unlisted cards on
//            either (private cards and previews: owner SQL). The visual
//            matrix: only their cases change. "sweep" (a correction,
//            FRAMES.md "Additions vs corrections"). NOT
//            verification-neutral: masters and every slot move — but no
//            tick exists on either template to stale (0 of 7 each), so the
//            first ticks are the owner's after the deploy.
//   44     — the 2003 frame's artist line in the prints' ink (TODO 4.23a;
//            era design 2026-10-06, step E1): `modern` and `modernland`
//            printed the footer in INK_DARK on every master — 1.1 : 1 on
//            the black frame and 2.2–2.3 : 1 on the brown band all seven
//            land keys share (only the brush painted into the MSE master
//            showed). Eighth Edition → Journey into Nyx print it black on
//            white, blue, red, green, gold and the artifact frame and WHITE
//            on black and on lands (M12 #81, #224; Card Conjurer's
//            pack8th.js). So: MODERN.footer.inkByColorKey = { b: white },
//            MODERNLAND's = white on all seven keys (footerInk, both
//            renderers; 16.2 : 1 and 8.1–8.5 : 1). No slot, size, master,
//            plate or symbol moves (those are 4.10b). A CORRECTION
//            ("sweep", FRAMES.md "Additions vs corrections"), never a
//            badge. Template-scoped (TEMPLATE_SCOPED_VERSIONS[44] = modern,
//            modernland) AND card-scoped (VERSION_SCOPES[44], v44Changed):
//            every `modernland` card, and a `modern` card that paints the
//            black master — every other `modern` card bakes byte for byte
//            as before and is stamped without a re-bake. Public production
//            (anonymous read, 2026-10-07): 7 `modern` cards on m ×4, c ×2,
//            g ×1, none on b, none on `modernland` — the sweep re-bakes
//            nothing. The visual matrix: only the `modern`/b and
//            `modernland` cases change. VERIFICATION-NEUTRAL: the frame a
//            tick verified is the same master with every slot where it
//            was; the owner signs the ink off on the round-37 sheet
//            instead of re-ticking the eight combos (4.10b re-opens all
//            fourteen 2003 ticks once).
//   45     — the battle's right side, top block and icon re-cut onto the
//            prints (TODO 4.21d; owner round 33, 2026-10-06: re-cut before
//            the first battle tick). ITS number lives in
//            BATTLE_RECUT_LAYOUT_VERSION below (built as 44 beside the 2003
//            footer ink, which merged first and holds that number). After v43's block move
//            Card Conjurer's 'Battle' master still left nine MOM prints
//            (#1, #21, #22, #63, #115, #147, #149, #190, #230) by: the name
//            pill's right end +10.0 px, the type bar's +8.6, the text box's
//            right edge +7.6, the shield +11.7 (the prints' lies over the
//            right border), the pill 2.5 / 1.4 px high, the icon's dark
//            disc r 54.6 against 52.0 and 3.9 px low. The importer now
//            (scripts/lib/cc-frames.mjs): moves the top block 2 px up
//            through the flat top border (BATTLE_BLOCK_RECUT), stretches
//            the pill's paper 10 px and the type bar's and text box's 8 px
//            right (recutColumns: a 24-column cross-fade inside each bar's
//            own paper), lifts the shield through the pack's Defense mask
//            and sets it 12 px right, over the border, and redraws the
//            icon's three rings at the prints' radii (BATTLE_RIGHT_RECUT,
//            BATTLE_ICON_RECUT). Every one of those edges within 1 px of
//            the nine prints' mean. The profile rides it: the name and the
//            art rect's top 2 px up (the name's feet were on row 158 where
//            the prints' are on 156–157; the cost stays on the prints'
//            rows: costDy), the cost's end 10 px right, the type line's
//            rect and the symbol 8 px, the shield's rect and the defense
//            value 12 px; the name starts 4 px further left (388 px: by
//            direct reads on the nine prints v43's stood 5.5 px right at
//            its first letter and 2.5 at the word's end — the skeptic
//            pass's one change). The rules box keeps the pack's column (the
//            prints wrap their lines round the shield; ours keep out of it
//            by size, and a wider column set four of nine references'
//            texts 2–6 px smaller than their prints).
//            Template-scoped (battle alone): every card on it. Public
//            production (anonymous read, 2026-10-07): 0 public or unlisted
//            battles. The visual matrix: only the battle cases change.
//            "sweep" (a correction). NOT verification-neutral: the masters
//            and every slot on the right move — no battle tick exists to
//            stale (the first ticks wait for this bump).
//   46     — the 1997 frame on the ORIGINAL cards (TODO 4.10a; era design
//            2026-10-06 step E4, owner round 38 of 2026-10-07). ITS number
//            lives in RETRO_1997_LAYOUT_VERSION below — the ONE constant;
//            CARD_LAYOUT_VERSION reads it while it is the latest. `retro`
//            and `retroland` drew MSE masters from 375 px JPEGs (edges
//            5.8 px soft, 3.5 px off the prints' shape), every line of text
//            in dark ink and M15's shadowed pips. Now: the MASTERS are Card
//            Conjurer's Seventh drawing re-cut edge by edge (a piecewise-
//            linear map per axis, the text box per colour) and toned region
//            by region (mean and contrast) onto the 1996–2003 prints — seven
//            keys of `retro`, all seven of `retroland`; gold keeps the MSE
//            artwork, cut with the same edge map (scripts/lib/print-cut.mjs,
//            seventh-1997.mjs; the frames bucket). The PROFILE: name, type
//            line, P/T and artist line white with the prints' hard black
//            shadow on every key; the type line and the artist line in
//            MPlantin (their printed face), names and P/T in Beleren, at the
//            prints' sizes (71 / 67 / 86 / 58 px), `fit: "measured"`; the
//            centred `Illus. <artist>` footer over the © slot
//            (FrameProfile.copyrightSlot: the pipglyph.com mark on display,
//            off the border; a clean download's footer text);
//            `symbolStyle: "1997"` — flat 73 px discs, the 1997 tap; the art
//            slot on the new window, one rules box fitted to the smallest
//            text box. A CORRECTION ("sweep"), never a badge.
//            Template-scoped (retro, retroland): every card on the pair.
//            Public production (anonymous read, 2026-10-07): 0 public or
//            unlisted cards on either — the sweep re-bakes nothing; the
//            bump is the visual gate's record. The visual matrix: only the
//            retro / retroland cases change. NOT verification-neutral:
//            masters and every slot move — no tick exists on the pair to
//            stale (first ticks follow the merge; `retroland`/m is a
//            stand-in and is not ticked).
//   47     — the 2003 frame, the ONE sweep (TODO 4.10b; era design
//            2026-10-06 step E5, owner 2026-10-07: the artwork swapped in
//            the same sweep as the text fix). ITS number lives in
//            MODERN_2003_LAYOUT_VERSION below — the ONE constant;
//            CARD_LAYOUT_VERSION reads it while it is the latest. `modern`
//            and `modernland` drew MSE masters from 375 px JPEGs (edges
//            6–7 px soft), a P/T plate 17 px too flat, names / type lines /
//            P/T 14–18 % small, an artist line under half the printed
//            size in capitals, 60 px pips with M15's shadow and the mark
//            on the border. Now: the MASTERS are Card Conjurer's 8th
//            drawing re-cut with one piecewise-linear map per axis (0.6–
//            1.2 px RMS on every key) and toned region by region onto the
//            2004–2014 prints (mean ΔE 1.2–4.8, was 6.0–10.1), the P/T
//            plates the pack's own at the printed box (scripts/lib/
//            eighth-2003.mjs; the frames bucket). The PROFILE: name 80 px,
//            type line 66, P/T 80 (centred on the plate's face, as the
//            prints set every value), `fit: "measured"`; the footer as the
//            prints' two left-aligned lines — the brush (our own path,
//            FrameProfile.footerBrush) and the artist at 50 px, mixed case,
//            over the © slot (the pipglyph.com mark on display, off the
//            border; a clean download's footer text), in v44's ink per
//            master; `symbolStyle: "2003"` — 66 px cost discs with a black
//            shadow 6 px down and 2 px left, flat pips in the rules text; the art
//            slot on the new window, the rules box on the printed column.
//            A CORRECTION ("sweep"), never a badge. Template-scoped
//            (modern, modernland): every card on the pair. Public
//            production (anonymous read, 2026-10-07): 8 cards on `modern`
//            (gold ×5, the artifact `c` ×2, green ×1), none on
//            `modernland` — each re-bakes once; the owner signed their
//            before / after (round 41). The visual matrix: only the modern
//            / modernland cases change. NOT verification-neutral: masters
//            and every slot move — the fourteen ticks on the pair are
//            flagged "needs re-verification" (they stay verified and
//            offered) and the owner re-ticks them once.
//   48     — the 1993 frame on its prints (TODO 4.10c; era design
//            2026-10-06 step E6). ITS number lives in
//            ALPHA_1993_LAYOUT_VERSION below — the ONE constant;
//            CARD_LAYOUT_VERSION reads it while it is the latest.
//            `agclassic` and `alphaland` set every line small and in
//            Beleren (a 59 px name that never shrank — the renderer's
//            ellipsis cut it —, a 45 px type line estimated at 0.56 em a
//            character, a 60 px P/T, the credit as `ART: NAME` in 24 px
//            capitals), 54 px pips with M15's shadow and today's symbols.
//            Now, measured on 118 Alpha / Beta prints (proof 3): name
//            Beleren 72 px and type line MPlantin 70 px, both
//            `fit: "measured"`, on the prints' baselines (171.5 / 1227.4
//            px); the printed credit `Illus. <artist>` in MPlantin 70 px,
//            mixed case, and the P/T in MPlantin 84 px set against its
//            right end, both on the strip's one line (baseline 1949 px), in
//            the 2026-09-25 embossed ink; `symbolStyle: "original"` — flat
//            72 px cost discs 84 px apart on row 142.5, the five colour
//            symbols as 1993 drew them (frames-bucket images,
//            `manaoriginal/*`), the tilted-T tap; a clean download's
//            footer text on the black border where the mark sits
//            (FrameProfile.copyrightSlot with `endPct`; it was set at the
//            end of the credit line). Masters, art slot, rules box, ink
//            colours and the left margins of the name and the type line
//            (the owner's round 4) do not move. A CORRECTION ("sweep"),
//            never a badge. Template-scoped (agclassic, alphaland): every
//            card on the pair. Public production (anonymous read,
//            2026-10-08): 4 cards on `agclassic` (white, red, the artifact
//            `a` and a colourless foil on `c`), none on `alphaland` — each
//            re-bakes once, after the owner's before / after sheet. The
//            visual matrix: only the agclassic / alphaland cases change.
//            NOT verification-neutral: every text slot moves — no tick
//            exists on the pair to stale (first ticks follow the merge).
// ---------------------------------------------------------------------------

/** The 1993 frame on its prints (TODO 4.10c): every text slot and the
 *  symbols of `agclassic` and `alphaland`. ITS version lives here alone —
 *  CARD_LAYOUT_VERSION, the scoped tables and the rollout below read this
 *  constant — so a bump that merges first moves it in one place. Frozen
 *  like the lists below once it ships. */
export const ALPHA_1993_LAYOUT_VERSION = 48;
export const ALPHA_1993_TEMPLATES: readonly string[] = ["agclassic", "alphaland"];

/** The 2003 frame's one sweep (TODO 4.10b): the masters of `modern` and
 *  `modernland` and every slot on them. ITS version lives here alone —
 *  CARD_LAYOUT_VERSION, the scoped tables and the rollout below read this
 *  constant. Frozen like the lists below: v47 is history. */
export const MODERN_2003_LAYOUT_VERSION = 47;
export const MODERN_2003_TEMPLATES: readonly string[] = ["modern", "modernland"];

/** The 1997 frame rebuilt on the original cards (TODO 4.10a): the masters
 *  of `retro` and `retroland` and every slot on them. ITS version lives
 *  here alone — CARD_LAYOUT_VERSION, the scoped tables and the rollout below
 *  read this constant. Frozen like the lists below: v46 is history. */
export const RETRO_1997_LAYOUT_VERSION = 46;
export const RETRO_1997_TEMPLATES: readonly string[] = ["retro", "retroland"];

export const CARD_LAYOUT_VERSION = ALPHA_1993_LAYOUT_VERSION;

/** The first layout whose stored bakes are ROUND (v31, TODO 3.26). An older
 *  stamp — or a null one, whose bake may predate it — is a square bake with
 *  the frame's corner as it was (lib/og/card-social.tsx keeps its old clip
 *  for those until the sweep re-bakes them). */
export const ROUND_BAKE_LAYOUT_VERSION = 31;

/** True when a stored bake stamped `layoutVersion` is already round. */
export function isRoundBake(layoutVersion: number | null | undefined): boolean {
  return layoutVersion != null && layoutVersion >= ROUND_BAKE_LAYOUT_VERSION;
}

// v32 — the M15-era family (lib/cards/m15-family.ts M15_FAMILY_TEMPLATES) as
// it stood at v32: every card on these templates re-bakes. A LITERAL, frozen
// like V29_DISPLAY_FOOTER_TEMPLATES: v32 is history once it ships, so a
// template that joins the family later must not make its cards stamped below
// 32 owe v32 retroactively — it brings its own bump. A test pins the family
// to this list; when the family changes, that test records the change and
// the bump that ships it, never this list.
export const V32_M15_FAMILY_TEMPLATES: readonly string[] = [
  "m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15borderless", "m15borderlessartifact",
  "m15pw", "m15token", "m15tokenartifact", "saga", "adventure", "flip", "aftermath", "extendedart",
  "expeditionland", "nyx", "fullart", "m15textless", "m15textlessland", "m15fullartland", "fullartland",
];

// v38 — the portrait layouts 4.21a re-sourced from Card Conjurer (their
// masters, art slots and text slots). Frozen like the lists below: v38 is
// history once it ships (4.21b's split and battle — v43 — and 4.21c's saga
// bring their own bumps).
export const V38_PORTRAIT_LAYOUT_TEMPLATES: readonly string[] = ["adventure", "aftermath", "flip"];

// v39 — flip's lower half and aftermath's cost onto the prints (the 4.21a
// follow-up). Frozen like the lists above: v39 is history once it ships.
export const V39_FLIP_AFTERMATH_TEMPLATES: readonly string[] = ["aftermath", "flip"];
/** v40 — the modal faces (TODO 5.1d: the backs' strip toned): the two front
 *  templates a modal card is stored on and the two back bodies (the visual
 *  matrix's back-face cases, the ticks) — and the two transform FRONT
 *  bodies with the reverse-P/T tab, whose rules lines wrap round the
 *  digits since 5.1d. Frozen like v38's. */
export const V40_TEMPLATES: readonly string[] = ["m15mdfcfront", "m15mdfclandfront", "m15mdfcback", "m15mdfclandback", "m15dfcfront", "m15dfclandfront"];
/** v40's verification scope: the two modal BACK bodies' masters change and
 *  the two transform FRONT bodies' rules layout does; the modal fronts'
 *  ticks — none yet — would stay fresh. */
export const V40_VERIFICATION_TEMPLATES: readonly string[] = ["m15mdfcback", "m15mdfclandback", "m15dfcfront", "m15dfclandfront"];
/** v41 — the modal strip rider (TODO 5.1c): the four modal faces, whose
 *  two-colour cards gain the other face's tab. Frozen like v40's; the
 *  verification scope too (every one of the four has references whose
 *  compare render changes), so there is no V41_VERIFICATION_TEMPLATES. */
export const V41_TEMPLATES: readonly string[] = ["m15mdfcfront", "m15mdfclandfront", "m15mdfcback", "m15mdfclandback"];
/** The saga's rebuild (TODO 4.21c): the masters from Card Conjurer and the
 *  printed rail. ITS version lives here alone — the scoped table and the
 *  rollout below key their entries by this constant — because 4.21b (split
 *  and battle) was built beside it: whichever of the two merges second takes
 *  the next number by changing this constant (and CARD_LAYOUT_VERSION, when
 *  it becomes the latest). Frozen like the lists above once it ships. */
export const SAGA_RAIL_LAYOUT_VERSION = 42;
export const SAGA_RAIL_TEMPLATES: readonly string[] = ["saga"];
/** v43 — the landscape layouts 4.21b re-sourced from Card Conjurer (their
 *  masters, art slots and every text slot). Frozen like v38's: v43 is
 *  history once it ships (4.21c's saga brings its own bump). */
export const V43_LANDSCAPE_LAYOUT_TEMPLATES: readonly string[] = ["battle", "split"];
/** v44 — the 2003 pair whose artist line took the prints' white (4.23a).
 *  Frozen like the lists above: v44 is history once it ships (4.10b's swap
 *  of the same pair brings its own bump). */
export const V44_FOOTER_INK_TEMPLATES: readonly string[] = ["modern", "modernland"];
/** The battle's re-cut onto the prints (TODO 4.21d): its masters' right
 *  side, top block and icon, and the slots that ride them. ITS version
 *  lives here alone — the scoped table and the rollout below key their
 *  entries by this constant — because another bump was built beside it:
 *  whichever of the two merges second takes the next number by changing
 *  this constant (and CARD_LAYOUT_VERSION, when it becomes the latest).
 *  Frozen like the lists above once it ships. */
export const BATTLE_RECUT_LAYOUT_VERSION = 45;
export const BATTLE_RECUT_TEMPLATES: readonly string[] = ["battle"];

/**
 * Bumps that changed the output of only some frame templates, keyed by the
 * version they introduced (v24 and v25 so far; every earlier bump touched
 * every card). List EVERY template whose output changed — including the ones
 * that inherit a changed profile by spread (alphaland ← agclassic,
 * modernland ← modern). Template keys match `frame_style.template`
 * (types/card.ts FRAME_TEMPLATE_VALUES). The retired "alphatoken" (TODO
 * 4.54) stays in v25's list and v29's two as history, and is inert there: a
 * row that still carries it is judged on the frame it now DRAWS
 * (normalizeFrameTemplate → m15token / m15tokentext), never by that name.
 */
const TEMPLATE_SCOPED_VERSIONS: Readonly<Record<number, readonly string[]>> = {
  // v24: the Card Conjurer M15 swap + everything that draws the M15 P/T plate.
  24: [
    "m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid", "m15pw", "m15token", "m15tokenartifact",
    "adventure", "extendedart", "fullart", "fullartland", "m15textless", "m15textlessland", "expeditionland", "nyx",
  ],
  // v25: frame-review follow-ups — Alpha P/T, the brand mark into the black
  // border where it straddled the frame edge, Dragon Wing re-measured.
  25: [
    "agclassic", "alphaland", "alphatoken", "retro", "retroland", "modern", "modernland", "extendedart",
    "battle", "split", "tarkirdragon",
  ],
  // v27: owner decisions — Alpha re-cut + light ink, Dragon Wing split,
  // Ghostfire rebuilt, planeswalker mana cost and name lowered.
  27: ["agclassic", "alphaland", "tarkirdragon", "tarkirghostfire", "m15pw"],
  // (v29 is card-scoped only: see VERSION_SCOPES[29].)
  // v30: fullartland re-sourced from Card Conjurer, with its symbol slot,
  // pill and outlined footer (4.39).
  30: ["fullartland"],
  // (v31, the one corner radius, changes every template's bake: unscoped.)
  // v32: one M15-era title / type size (4.20) — the M15 family as it stood.
  32: V32_M15_FAMILY_TEMPLATES,
  // (v33, the rules layout, reaches every template that prints text: no
  // template list — VERSION_SCOPES[33] narrows it by what the card prints.)
  // (v34, the token release: no template list either — VERSION_SCOPES[34]
  // holds the two token frames' every card AND a token's wording on any
  // template; a list here would AND the second half away.)
  // v35: the art-area corrections — the templates whose art slot or
  // under-frame art moved (VERSION_SCOPES[35] narrows the three whose only
  // change is the see-through colourless master's under-frame art).
  35: [
    "m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid", "nyx", "fullart",
    "m15token", "m15tokentext", "m15pw",
  ],
  // (v36, the second correction round: no template list — its inline pips
  // reach every template; VERSION_SCOPES[36] holds the walkers, the
  // printed-size set symbols and the cards with an inline pip.)
  // v37: nyx's darker type bar and text box (4.17e) — its masters only.
  37: ["nyx"],
  // v38: the portrait layouts re-sourced from Card Conjurer (4.21a) — their
  // masters, art slots and text slots; every card on them.
  38: V38_PORTRAIT_LAYOUT_TEMPLATES,
  // v39: flip's re-cut masters + art slot and rules rect, aftermath's cost
  // (the 4.21a follow-up); every card on the two.
  39: V39_FLIP_AFTERMATH_TEMPLATES,
  // v40: the modal backs' strip toned (5.1d) — every card on the modal
  // faces (its back bake changes), the back bodies for the matrix, and the
  // transform fronts (the reverse-P/T float).
  40: V40_TEMPLATES,
  // v41: the modal strip rider (5.1c) — the four modal faces; a tick on
  // them is judged by this scope too (each has references whose compare
  // render gains the rider): kept, flagged for a re-check.
  41: V41_TEMPLATES,
  // The saga rebuilt from Card Conjurer (4.21c): its masters, art slot,
  // type line and the whole chapter rail; every card on it. A tick on it is
  // judged by this scope too: kept, flagged for a re-check.
  [SAGA_RAIL_LAYOUT_VERSION]: SAGA_RAIL_TEMPLATES,
  // v43: the landscape layouts re-sourced from Card Conjurer (4.21b) —
  // their masters, art slots and text slots; every card on the two. No
  // narrower verification scope: neither has a tick.
  43: V43_LANDSCAPE_LAYOUT_TEMPLATES,
  // v44: the 2003 footer ink (4.23a) — the pair; VERSION_SCOPES[44] narrows
  // `modern` to the cards on the black master.
  44: V44_FOOTER_INK_TEMPLATES,
  // The battle re-cut onto the prints (4.21d): its masters and the slots on
  // its right side and top block; every card on it. No narrower
  // verification scope: the battle has no tick.
  [BATTLE_RECUT_LAYOUT_VERSION]: BATTLE_RECUT_TEMPLATES,
  // The 1997 frame on the original cards (4.10a): the pair's masters and
  // every slot; every card on it (none stored). No narrower verification
  // scope: neither template has a tick.
  [RETRO_1997_LAYOUT_VERSION]: RETRO_1997_TEMPLATES,
  // The 2003 frame's one sweep (4.10b): the pair's masters and every slot;
  // every card on it (8 stored on `modern`). No narrower verification
  // scope: all fourteen ticks on the pair go stale and are re-made once.
  [MODERN_2003_LAYOUT_VERSION]: MODERN_2003_TEMPLATES,
  // The 1993 frame on its prints (4.10c): every text slot and the symbols
  // of the pair; every card on it (4 stored on `agclassic`). No narrower
  // verification scope: neither template has a tick.
  [ALPHA_1993_LAYOUT_VERSION]: ALPHA_1993_TEMPLATES,
};

// v34 — the token frames 4.49 re-measured: EVERY card on them re-bakes (the
// type line and the set symbol move on all of them, the P/T plate appears
// where there is a P/T). Frozen like the v29 / v32 / v33 lists: v34 is history
// once it ships, and a token template added later (4.48's m20token…, 4.49's
// m15tokentext) is new — no card was baked on it before v34.
export const V34_TOKEN_FRAME_TEMPLATES: readonly string[] = ["m15token", "m15tokenartifact"];

// v35 — the art-area corrections (TODO 4.4 (2), 4.17a, 4.17b). Frozen like
// the lists above: v35 is history once it ships.
//   * EVERY card on these templates re-bakes: the Card Conjurer M15 family's
//     art slot (m15 — the legacy templates drawn as m15 included —,
//     m15artifact, m15land, m15snow, m15snowland, m15devoid; with no art the
//     empty-art box moves with it), the under-frame art of m15/c and every
//     m15devoid master, and the nyx / fullart slots that now run under the
//     whole translucent text box.
//   * On these, only a card that paints the see-through colourless master
//     ("c") AND has art: their slot is unchanged, the under-frame layer
//     (drawn only under art) is what moved or appeared.
export const V35_ART_SLOT_TEMPLATES: readonly string[] = [
  "m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid", "nyx", "fullart",
];
export const V35_SEE_THROUGH_C_TEMPLATES: readonly string[] = ["m15token", "m15tokentext", "m15pw"];

// v36 — the second correction round (TODO 3.31, 4.46, 4.47). Frozen
// like the lists above: v36 is history once it ships.
//   * EVERY card on these templates re-bakes: the planeswalkers' set symbol
//     moved (4.47; every card draws one — the default mark when it has no
//     icon or set).
export const V36_EVERY_CARD_TEMPLATES: readonly string[] = ["m15pw", "m15borderlesspw", "m15borderlesspwtall"];
//   * The templates that draw a Keyrune glyph at its set's printed size
//     (4.46, setSymbolFit "ink"): the M15-era family as it stood at v36,
//     the full-art basics excepted ("ink-box").
export const V36_PRINTED_SYMBOL_TEMPLATES: readonly string[] = [
  "m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15borderless", "m15borderlessartifact",
  "m15pw", "m15borderlesspw", "m15borderlesspwtall", "m15token", "m15tokenartifact", "m15tokentext",
  "m15tokenartifacttext", "m15borderlessland", "emblem", "m20token", "m20tokentext", "m20tokentall",
  "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall", "saga", "adventure", "flip", "aftermath",
  "extendedart", "expeditionland", "nyx", "fullart", "m15textless", "m15textlessland",
];
//   * The sets whose printed size the table held at v36
//     (lib/cards/set-symbol-prints.ts SET_SYMBOL_PRINTED_PX): a card draws
//     one through the Keyrune glyph its code selects.
export const V36_PRINTED_SYMBOL_SETS: readonly string[] = [
  "afr", "blb", "dmu", "dom", "dsk", "eld", "eoe", "fdn", "fin", "grn", "iko", "khm", "ktk", "ltr", "m19", "m20",
  "m21", "mh3", "mid", "mkm", "neo", "one", "otj", "snc", "spm", "stx", "tdm", "thb", "tla", "woe",
];
//   * Every set code whose Keyrune glyph is one of those sets' at v36 — the
//     sets themselves and the four codes keyrune draws with one of their
//     glyphs (gk1, xdnd, xkld, xssm) — as set-symbol-size.ts's
//     keyruneCodepointFor looks a code up (lower case, "ss-" dropped; an
//     unknown code draws the default glyph, which is not listed). Literal,
//     so this module (imported by client code) never pulls in the keyrune
//     tables; a test holds it to them.
export const V36_PRINTED_SYMBOL_CODES: readonly string[] = [
  "afr", "blb", "dmu", "dom", "dsk", "eld", "eoe", "fdn", "fin", "gk1", "grn", "iko", "khm", "ktk", "ltr", "m19",
  "m20", "m21", "mh3", "mid", "mkm", "neo", "one", "otj", "snc", "spm", "stx", "tdm", "thb", "tla", "woe", "xdnd",
  "xkld", "xssm",
];
/** Whether a set code draws a v36-listed set's glyph (V36_PRINTED_SYMBOL_CODES). */
export function v36PrintedSymbolCode(setCode: string): boolean {
  return V36_PRINTED_SYMBOL_CODES.includes(setCode.toLowerCase().replace(/^ss-/, ""));
}
//   * Where a card's text draws its inline pips (3.31) at v36: nowhere on a
//     frame that prints no text (FrameProfile.textless); a back face's rules
//     text only on the adventure page and the second faces; face_content's
//     chapters only on the saga rail (the walkers' rows are on the
//     every-card templates above).
export const V36_TEXTLESS_TEMPLATES: readonly string[] = ["m20token", "m20tokenartifact"];
export const V36_BACK_FACE_TEXT_TEMPLATES: readonly string[] = ["adventure", "flip", "split", "aftermath"];

/**
 * Bumps whose frame SLOTS move on fewer templates than their stored bakes
 * change on: frame verification judges a tick by this list instead of the
 * card scope. v34's wording (3b.15, a token's line on any template) moves no
 * slot and alone would be verification-neutral; its frame half (4.49) moves
 * the P/T, type line and symbol on the two token frames, so only their ticks
 * go stale (owner decision 7, 2026-09-29).
 */
const VERIFICATION_TEMPLATE_SCOPES: Readonly<Record<number, readonly string[]>> = {
  34: V34_TOKEN_FRAME_TEMPLATES,
  // (v36 is not here: verification-neutral, VERIFICATION_NEUTRAL_VERSIONS.)
  // v40: the two modal BACK bodies' masters change (their strip) and the
  // two transform FRONT bodies' rules layout (the reverse-P/T float); the
  // modal fronts' ticks — none yet — would stay fresh.
  40: V40_VERIFICATION_TEMPLATES,
};

/**
 * Bumps that don't cost the owner a frame VERIFICATION: a tick in
 * /admin/frame-compare (frame_reviews.verified_layout_version) survives them.
 * v31 only cuts the card's corner — no slot, bar or text moves — so the
 * owner's existing ticks stay fresh (owner decision, TODO 3.26). v32 does
 * move text (the M15 family's name, type line and set-symbol sizes), but
 * the owner signs it off on the round-8 print comparison instead of
 * re-ticking every family combo (owner decision 2026-09-28, TODO 4.20).
 * v33 moves no slot either, only text inside the rules boxes (the rules
 * layout, TODO 3.29) — the alignment scores a tick stored would change on a
 * re-score — and the owner signs it off on the round-9 print comparison
 * (owner decision 2026-09-28). v34 is NOT here: 4.49 moves the token frames'
 * slots, so their ticks are re-verified (VERIFICATION_TEMPLATE_SCOPES).
 * v35 is (the default for small art-edge fixes, as v31–v33): no title, type
 * line, pip, symbol, rules box or plate moves — only where the ART is
 * painted: the CC M15 family's slot by 0.95–2.45 px outward to cover the
 * master's own window, the art under the see-through masters from the
 * border's inner edge, nyx / fullart's art on down under their translucent
 * text box, and m15pw/c's as one picture (its window's crop ~14 % larger —
 * the one verified combo whose look changes beyond an art edge; the owner
 * may re-tick it by hand after the sheet). The frame a tick verified
 * against its prints is the same master in the same place; the owner signs
 * the art off on the v35 before/after sheet instead of re-ticking.
 * v36 is (owner round 18, 2026-09-30, on the walker sheet): the inline pips
 * move text inside the rules boxes (as v33), the printed set-symbol sizes
 * move no slot (as v32), and 4.47 moves the walkers' symbolRect — a scored
 * box — onto the prints, as v32 moved
 * m15pw's costRect and stayed neutral. Production's seven m15pw ticks
 * (legacy) stay fresh; the owner signed the walkers off on the sheet.
 * v37 is: it darkens the black of nyx's type bar and text box on the
 * masters (4.17e) and moves no slot — and nyx has no tick.
 * v44 is (era design D9, TODO 4.23a): only the INK of the 2003 artist line
 * changes, on `modern`/b and the seven `modernland` keys — no slot, size,
 * master or plate moves, so no alignment score a tick stored would change.
 * Production's fourteen 2003 ticks stay fresh; the owner signs the ink off
 * on the round-37 sheet (black frame, land), and 4.10b re-opens them once.
 * Stored bakes still owe these bumps: this list is read by frame
 * verification only, never by the stale / sweep / download rules.
 */
export const VERIFICATION_NEUTRAL_VERSIONS: readonly number[] = [31, 32, 33, 35, 36, 37, 44];

/** TEMPLATE_SCOPED_VERSIONS with VERIFICATION_TEMPLATE_SCOPES laid over it
 *  (v34: only the token frames' ticks) and every verification-neutral bump
 *  scoped to no template — the map lib/cards/frame-verification-state.ts
 *  judges a tick by. */
export const VERIFICATION_SCOPED_VERSIONS: Readonly<Record<number, readonly string[]>> = {
  ...TEMPLATE_SCOPED_VERSIONS,
  ...VERIFICATION_TEMPLATE_SCOPES,
  ...Object.fromEntries(VERIFICATION_NEUTRAL_VERSIONS.map((version) => [version, [] as readonly string[]])),
};

/** The card fields a scoped bump can look at — `cards` columns, as stored.
 *  Optional so partial rows work — a predicate treats a missing column as
 *  "can't tell" and answers conservatively (affected), the same as passing
 *  no card at all. A caller that builds one from a row should select them
 *  all (lib/cards/bake-core.ts BAKE_SELECT_COLUMNS has them). */
export type ScopeCard = {
  rarity?: string | null;
  set_icon_url?: string | null;
  set_icon_code?: string | null;
  /** The raw `frame_style` jsonb — finish-scoped bumps read `.finish`.
   *  `undefined` = not selected (can't tell); null/{} = a regular card. */
  frame_style?: unknown;
  /** v35: which frame master the card paints (pickFrameColorKey of the
   *  identities the bake keeps) and whether it has art. */
  color_identity?: readonly string[] | null;
  art_url?: string | null;
  // v29: the display lines (word spacing) and the printed stats (3.18).
  title?: string | null;
  supertype?: string | null;
  card_type?: string | null;
  subtypes?: readonly string[] | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
  /** The raw `back_face` jsonb (a flip card's P/T; a flip / split back
   *  face's name and type line; v33: a back face's rules and flavor text). */
  back_face?: unknown;
  // v33: the text a bake prints in its rules box, walker rows or saga rail.
  rules_text?: string | null;
  flavor_text?: string | null;
  /** The raw `face_content` jsonb (loyalty abilities, saga chapters). */
  face_content?: unknown;
};

// v29 — the templates on which EVERY card's bake changed: their footer is
// set in the display face and prints "ART: …", whose T + colon the kerned
// display lines re-space (the word-spacing track; each template's
// `footer.font` was "display" at v29). Frozen: v29 is history, a later
// footer change is its own bump.
const V29_DISPLAY_FOOTER_TEMPLATES: readonly string[] = [
  "m15", "m15land", "m15token", "m15artifact", "m15snow", "m15snowland", "m15devoid", "m15pw", "m15tokenartifact",
  "agclassic", "alphaland", "alphatoken", "saga", "adventure", "extendedart", "fullart", "fullartland",
  "m15textless", "m15textlessland", "expeditionland", "nyx", "retro", "retroland", "modern", "modernland",
];
// v29 — the templates whose rules backdrop now carries the foil sheen.
const V29_FOIL_BACKDROP_TEMPLATES: readonly string[] = [
  "m15pw", "m15token", "m15tokenartifact", "alphatoken", "bloomanime", "expeditionland",
];
// v29 — the templates that draw a rotated second face (FrameProfile
// .secondFace), whose back-face name and type line are display lines too.
const V29_SECOND_FACE_TEMPLATES: readonly string[] = ["flip", "split", "aftermath"];

/** A single-line display text the v29 renderer re-spaces: one with a space
 *  between two words (displayLine joins them into one no-break run). */
function v29Respaced(text: string): boolean {
  return displayLine(text) !== text;
}

/** buildTypeLine from a card row or a back_face jsonb, as the bake builds it. */
function v29TypeLine(face: { supertype?: unknown; card_type?: unknown; subtypes?: unknown }): string {
  return buildTypeLine({
    supertype: typeof face.supertype === "string" ? face.supertype : null,
    cardType: (typeof face.card_type === "string" ? face.card_type : null) as CardType | null,
    subtypes: Array.isArray(face.subtypes) ? face.subtypes.filter((s): s is string => typeof s === "string") : undefined,
  });
}

/**
 * Whether layout v29 changed a card's bake: the OR of the six round-5
 * tracks' scopes (see the history above). Templates are judged as DRAWN
 * (normalizeFrameTemplate: {} / null / a retired value is m15). Any column a
 * term needs that the row doesn't carry → affected.
 */
function v29Changed(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style), card);
  // Word spacing on every display-face footer. This also holds the
  // planeswalker rows + names (m15pw, modern), Alpha's ink and artifact card
  // (agclassic) and five of the six foil-backdrop templates.
  if (V29_DISPLAY_FOOTER_TEMPLATES.includes(template)) return true;
  // Aftermath's turned second half + print sizes: every card.
  if (template === "aftermath") return true;
  // Foil through translucent rules backdrops.
  if (finishOfFrameStyle(card.frame_style) === "foil" && V29_FOIL_BACKDROP_TEMPLATES.includes(template)) {
    return true;
  }
  // Stat values that shrink, or print on one centred line now; Draconic P/T.
  // (Conservative on its own for a row missing any stat column.)
  if (statLayoutChanged(card)) return true;
  // Word spacing on the footer-less templates: a name or type line with a
  // space in it — the front face's, and a flip / split back face's.
  if ([card.title, card.supertype, card.card_type, card.subtypes, card.back_face].some((v) => v === undefined)) {
    return true;
  }
  if (v29Respaced(card.title?.trim() || "Untitled Card") || v29Respaced(v29TypeLine(card))) return true;
  const back = card.back_face;
  if (!V29_SECOND_FACE_TEMPLATES.includes(template) || !back || typeof back !== "object") return false;
  const backTitle = (back as { title?: unknown }).title;
  return (
    v29Respaced((typeof backTitle === "string" ? backTitle.trim() : "") || "Untitled") ||
    v29Respaced(v29TypeLine(back as { supertype?: unknown; card_type?: unknown; subtypes?: unknown }))
  );
}

// v33 — the templates that print no rules box, rows or rail at v33
// (FrameProfile.textless: none yet — the "M15 Textless" frames print their
// text straight on the art), and those that draw a saga's chapter rail
// (FrameProfile.chapters) in its place. Frozen like the v29 / v32 lists: v33
// is history once it ships (a test pins them to the profiles as they stand).
const V33_TEXTLESS_TEMPLATES: readonly string[] = [];
const V33_CHAPTER_TEMPLATES: readonly string[] = ["saga"];

function v33HasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Whether a `face_content` jsonb holds something the v33 layout draws: a
 *  loyalty ability (its row and badge are sized by the rules text size, so
 *  one with no text changes too), a saga chapter's text or the saga's
 *  intro. A chapter with no text keeps today's row, badge and size. */
function v33FaceContentPrints(faceContent: unknown): boolean {
  if (!faceContent || typeof faceContent !== "object") return false;
  const { loyalty, saga } = faceContent as { loyalty?: unknown; saga?: unknown };
  const abilities = loyalty && typeof loyalty === "object" ? (loyalty as { abilities?: unknown }).abilities : undefined;
  if (Array.isArray(abilities) && abilities.length > 0) return true;
  if (!saga || typeof saga !== "object") return false;
  const { intro, chapters } = saga as { intro?: unknown; chapters?: unknown };
  return (
    v33HasText(intro) ||
    (Array.isArray(chapters) &&
      chapters.some((ch) => Boolean(ch) && typeof ch === "object" && v33HasText((ch as { text?: unknown }).text)))
  );
}

/**
 * Whether layout v33 (the rules layout, TODO 3.29) changed a card's bake:
 * it prints rules, flavor, loyalty or chapter text — its rules_text or
 * flavor_text in the rules box, walker rows or saga rail; face_content's
 * loyalty abilities, saga chapters or intro; a back face's rules or flavor
 * text (the adventure page, a flip / split / aftermath half). Never a card
 * on a frame that prints no text box (V33_TEXTLESS_TEMPLATES), nor a basic
 * land's text (the rules box prints none for it — a saga's chapter rail
 * still would). Any column a term needs that the row doesn't carry →
 * affected.
 */
function v33PrintsText(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style), card);
  if (V33_TEXTLESS_TEMPLATES.includes(template)) return false;
  if ([card.rules_text, card.flavor_text, card.face_content, card.back_face].some((v) => v === undefined)) return true;
  if (v33FaceContentPrints(card.face_content)) return true;
  const back = card.back_face && typeof card.back_face === "object" ? (card.back_face as Record<string, unknown>) : null;
  if (back && (v33HasText(back.rules_text) || v33HasText(back.flavor_text))) return true;
  if (!v33HasText(card.rules_text) && !v33HasText(card.flavor_text)) return false;
  if (V33_CHAPTER_TEMPLATES.includes(template)) return true;
  if ([card.card_type, card.supertype, card.subtypes, card.title].some((v) => v === undefined)) return true;
  // The renderers' isBasicLand (lib/cards/watermark.ts): its text is never drawn.
  return (
    basicLandManaKey({
      cardType: card.card_type,
      supertype: card.supertype,
      subtypes: card.subtypes,
      title: card.title,
      rulesText: card.rules_text,
    }) === null
  );
}

/**
 * TODO 3b.15's card scope — v34's wording half (v34Changed). Whether a
 * card's bake changes with the token wording: a token whose supertype is not
 * empty (a word: the line now prints "Token" first — "Basic Token — Wastes"
 * → "Token Basic — Wastes"; a Treasure's stray P/T goes too; a blank one of
 * spaces is trimmed away), and a token with a P/T
 * and no word, which migration 0128 gives "Creature" ("Token — Soldier" → "Token
 * Creature — Soldier") — counted whether the sweep reaches the row before or
 * after the migration, so it is never stamped current on the old line. A
 * back face typed token with a non-empty supertype is its own line too. Any token template
 * (m15token, m15tokenartifact, alphatoken, a showcase, flip): no template
 * list. A token with neither a word nor a P/T ("Token" / "Token — Boar")
 * prints what it did. Any column it needs that the row doesn't carry →
 * affected.
 */
export function tokenTypeLineChanged(card: ScopeCard): boolean {
  if ([card.card_type, card.supertype, card.power, card.toughness, card.back_face].some((v) => v === undefined)) {
    return true;
  }
  // Any non-empty supertype, spaces included: the old line kept a blank
  // supertype's spaces before "Token" ("   Token — Boar"), the new one trims
  // it, so a blank-but-not-empty supertype is a changed line too.
  if (card.card_type === "token" && (Boolean(card.supertype) || Boolean(card.power || card.toughness))) {
    return true;
  }
  const back = card.back_face && typeof card.back_face === "object" ? (card.back_face as Record<string, unknown>) : null;
  return (
    back !== null &&
    back.card_type === "token" &&
    typeof back.supertype === "string" &&
    back.supertype.length > 0
  );
}

/**
 * Whether layout v34 (the token release) changed a card's bake: EVERY card
 * on the two token frames 4.49 re-measured (V34_TOKEN_FRAME_TEMPLATES — the
 * P/T plate, the type line and the set symbol; drawn template, so a {}
 * frame_style is m15 and not one of them), OR a token whose printed line
 * changes with 3b.15's wording on any other template (tokenTypeLineChanged:
 * alphatoken, a showcase, flip's Roles). A non-token card anywhere else is
 * untouched. A row without frame_style → affected (conservative).
 */
function v34Changed(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style), card);
  if (V34_TOKEN_FRAME_TEMPLATES.includes(template)) return true;
  return tokenTypeLineChanged(card);
}

/**
 * Whether layout v35 (the art-area corrections) changed a card's bake: every
 * card on V35_ART_SLOT_TEMPLATES (drawn template: a {} frame_style is m15),
 * and on V35_SEE_THROUGH_C_TEMPLATES a card that paints the colourless
 * master — the bake's own pick, pickFrameColorKey of the identities it
 * keeps (none of the three dresses a colour by type) — and has art (the
 * under-frame layer is drawn only under art). Any column it needs that the
 * row doesn't carry → affected.
 */
function v35Changed(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style), card);
  if (V35_ART_SLOT_TEMPLATES.includes(template)) return true;
  if (!V35_SEE_THROUGH_C_TEMPLATES.includes(template)) return false;
  if (card.color_identity === undefined || card.art_url === undefined) return true;
  const identities = (card.color_identity ?? []).filter(isColorIdentity);
  return pickFrameColorKey(identities) === "c" && Boolean(card.art_url);
}

/**
 * Whether layout v44 (the 2003 footer ink, TODO 4.23a) changed a card's
 * bake: every `modernland` card (white on all seven keys), and a `modern`
 * card that paints the BLACK master — the bake's own pick: `modern` has no
 * pair, crowned or artifact-dressed master, so frameMasterKey is
 * pickFrameColorKey of the identities the card keeps. Every other `modern`
 * card (white, blue, red, green, gold, the artifact `c`) prints the same
 * dark ink as before, byte for byte. Any column it needs that the row
 * doesn't carry → affected.
 */
function v44Changed(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style));
  if (template === "modernland") return true;
  if (template !== "modern") return false;
  if (card.color_identity === undefined) return true;
  return pickFrameColorKey((card.color_identity ?? []).filter(isColorIdentity)) === "b";
}

/** A mana token the rules tokenizer draws as a disc: braces around
 *  anything but whitespace (lib/cards/rules-text.ts tokenizeRulesText —
 *  every such token has a pip suffix; "{ }" draws nothing). A regex, not
 *  the tokenizer, so this module stays free of the components tree; a test
 *  holds the two to the same answer. */
const V36_PIP_TOKEN = /\{[^}]*[^}\s][^}]*\}/;

/** Whether a rules text holds an inline pip. */
export function v36HasPip(value: unknown): boolean {
  return typeof value === "string" && V36_PIP_TOKEN.test(value);
}

/** Whether a `face_content` jsonb holds a pip the rows or the rail draw: a
 *  loyalty ability's text, a saga chapter's text or its intro. */
function v36FaceContentHasPip(faceContent: unknown): boolean {
  if (!faceContent || typeof faceContent !== "object") return false;
  const { loyalty, saga } = faceContent as { loyalty?: unknown; saga?: unknown };
  const abilities = loyalty && typeof loyalty === "object" ? (loyalty as { abilities?: unknown }).abilities : undefined;
  if (
    Array.isArray(abilities) &&
    abilities.some((a) => Boolean(a) && typeof a === "object" && v36HasPip((a as { text?: unknown }).text))
  ) {
    return true;
  }
  if (!saga || typeof saga !== "object") return false;
  const { intro, chapters } = saga as { intro?: unknown; chapters?: unknown };
  return (
    v36HasPip(intro) ||
    (Array.isArray(chapters) &&
      chapters.some((ch) => Boolean(ch) && typeof ch === "object" && v36HasPip((ch as { text?: unknown }).text)))
  );
}

/**
 * Whether layout v36 (the second correction round) changed a card's bake:
 * every card on V36_EVERY_CARD_TEMPLATES (the walkers' moved symbol); a
 * card that may draw a listed set's Keyrune glyph (a code in
 * V36_PRINTED_SYMBOL_CODES) on a printed-size template (4.46) — with or
 * without an uploaded icon: the renderers drop an icon URL they may not draw
 * (lib/cards/drawable-media.ts; a pre-0127 row can name an outside host, and
 * which host is "ours" is the deployment's), and then draw the code's glyph,
 * so an icon never rules the glyph out here (a drawable one re-bakes to the
 * same pixels); a card whose PRINTED text has an inline pip (3.31): its
 * rules text unless it is a basic land's or the frame prints none, a saga's
 * chapters, a back face's rules text on the templates that draw it —
 * flavor draws none. Templates are judged as drawn (a {} frame_style is
 * m15). Any column it needs that the row doesn't carry → affected.
 */
function v36Changed(card: ScopeCard): boolean {
  if (card.frame_style === undefined) return true;
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style), card);
  if (V36_EVERY_CARD_TEMPLATES.includes(template)) return true;
  if (card.set_icon_code === undefined) return true;
  if (
    typeof card.set_icon_code === "string" &&
    card.set_icon_code &&
    V36_PRINTED_SYMBOL_TEMPLATES.includes(template) &&
    v36PrintedSymbolCode(card.set_icon_code)
  ) {
    return true;
  }
  if (V36_TEXTLESS_TEMPLATES.includes(template)) return false;
  if ([card.rules_text, card.face_content, card.back_face].some((v) => v === undefined)) return true;
  if (V33_CHAPTER_TEMPLATES.includes(template)) {
    return v36FaceContentHasPip(card.face_content) || v36HasPip(card.rules_text);
  }
  const back = card.back_face && typeof card.back_face === "object" ? (card.back_face as Record<string, unknown>) : null;
  if (V36_BACK_FACE_TEXT_TEMPLATES.includes(template) && back && v36HasPip(back.rules_text)) return true;
  if (!v36HasPip(card.rules_text)) return false;
  if ([card.card_type, card.supertype, card.subtypes, card.title].some((v) => v === undefined)) return true;
  // The renderers' isBasicLand (lib/cards/watermark.ts): its text is never drawn.
  return (
    basicLandManaKey({
      cardType: card.card_type,
      supertype: card.supertype,
      subtypes: card.subtypes,
      title: card.title,
      rulesText: card.rules_text,
    }) === null
  );
}

/** The frozen v33 template lists, for the test that pins them to the
 *  profiles. */
export const V33_SCOPE_TEMPLATES = {
  textless: V33_TEXTLESS_TEMPLATES,
  chapters: V33_CHAPTER_TEMPLATES,
} as const;

/**
 * Bumps that changed the output of only SOME cards regardless of template,
 * keyed by the version they introduced: the predicate says whether a card's
 * bake actually changed. Cards it returns false for are stamped current by
 * the sweep / update flow without a re-render, and never see the "newer
 * look" badge. Template scoping (above) and card scoping compose: a version
 * affects a card only when both say so.
 */
export const VERSION_SCOPES: Readonly<Record<number, (card: ScopeCard) => boolean>> = {
  // v23 — the default set mark's COMMON colourway changed; uncommon / rare /
  // mythic and any card with a custom icon render exactly as before.
  // A row that doesn't carry `rarity` can't be judged → conservative.
  23: (card) =>
    card.rarity === undefined ||
    (!card.set_icon_url && !card.set_icon_code && card.rarity === "common"),
  // v26 — only the ETCHED finish's overlay changed, on any template. A row
  // that doesn't carry frame_style can't be judged → conservative.
  26: (card) => card.frame_style === undefined || finishOfFrameStyle(card.frame_style) === "etched",
  // v28 — only the FOIL finish's overlay changed, on any template.
  28: (card) => card.frame_style === undefined || finishOfFrameStyle(card.frame_style) === "foil",
  // v29 — the round-5 leftovers: every track's scope, OR'd (v29Changed).
  29: v29Changed,
  // v33 — the rules layout: every card that prints text (v33PrintsText).
  33: v33PrintsText,
  // v34 — the token release: every card on the two token frames (4.49) and
  // a token's changed wording on any template (3b.15) — v34Changed.
  34: v34Changed,
  // v35 — the art-area corrections: every card on the templates whose art
  // slot moved, and a colourless card with art on the three whose
  // see-through master gained or moved its under-frame art — v35Changed.
  35: v35Changed,
  // v36 — the second correction round: every walker card, a listed
  // set's printed-size glyph, an inline pip — v36Changed.
  36: v36Changed,
  // v44 — the 2003 footer ink: every `modernland` card and a `modern` card
  // on the black master — v44Changed.
  44: v44Changed,
};

/** `frame_style.finish` from the jsonb column, or null when absent (= regular). */
export function finishOfFrameStyle(frameStyle: unknown): string | null {
  if (!frameStyle || typeof frameStyle !== "object") return null;
  const finish = (frameStyle as { finish?: unknown }).finish;
  return typeof finish === "string" && finish ? finish : null;
}

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
  card?: ScopeCard,
  scopes: Readonly<Record<number, (card: ScopeCard) => boolean>> = VERSION_SCOPES,
): boolean {
  if (layoutVersion == null || !Number.isFinite(layoutVersion)) return true;
  return pendingVersions(layoutVersion, template, card, { scoped, scopes, current }).length > 0;
}

/**
 * The bumps between a card's baked version and `current` that actually
 * changed ITS output — template scope and card scope both have to say so.
 * Empty = the stored bake still matches the current renderer.
 */
function pendingVersions(
  layoutVersion: number,
  template: string | null | undefined,
  card: ScopeCard | undefined,
  opts: {
    scoped?: Readonly<Record<number, readonly string[]>>;
    scopes?: Readonly<Record<number, (card: ScopeCard) => boolean>>;
    current?: number;
  } = {},
): number[] {
  const scoped = opts.scoped ?? TEMPLATE_SCOPED_VERSIONS;
  const scopes = opts.scopes ?? VERSION_SCOPES;
  const current = opts.current ?? CARD_LAYOUT_VERSION;
  // Judge by the template the card is DRAWN on when we can tell: a known
  // template, a RETIRED one read as its replacement (retiredFrameTemplate,
  // TODO 4.54 — with the card's text when the row carries it), or a
  // frame_style that was read ({} or an unknown value draws
  // DEFAULT_FRAME_TEMPLATE — the rule lib/cards/frame-override-stale.ts
  // uses; 272 production cards carry frame_style = {}). A caller that didn't
  // supply frame_style can't tell → conservative (touched), as
  // lib/render/stored-render.ts documents.
  const drawn =
    template != null || (card !== undefined && card.frame_style !== undefined)
      ? normalizeFrameTemplate(template, card)
      : null;
  const pending: number[] = [];
  for (let version = layoutVersion + 1; version <= current; version += 1) {
    const templates = scoped[version];
    const templateHit = !templates || drawn === null || templates.includes(drawn);
    const predicate = scopes[version];
    // No card to judge by → conservative (affected).
    const cardHit = !predicate || !card || predicate(card);
    if (templateHit && cardHit) pending.push(version);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Rollout policy — WHO gets to trigger the re-bake for a bump.
//
//   "sweep"  — the platform refreshes every affected card centrally (the
//              automatic re-bake cron; scripts/rebake-renders.mjs by hand).
//              For changes that must not linger: watermark policy, a broken
//              bake, a wrong emblem.
//   "opt-in" — the owner decides, through the "newer look" badge and the
//              update walkthrough. For taste changes (typography, spacing).
//
// The sweep never re-bakes, and never stamps, a card whose only pending
// bumps are opt-in — stamping would erase the badge the owner is meant to
// see. This is what the v22 decision ("don't sweep; let users decide")
// looked like in a conversation until a later sweep for v23 re-rendered
// 329 cards that were still on v21 (2026-09-16). Policy now lives here.
// Versions not listed are historical and count as "sweep".
// ---------------------------------------------------------------------------

export type RolloutPolicy = "sweep" | "opt-in";

export const VERSION_ROLLOUT: Readonly<Record<number, RolloutPolicy>> = {
  20: "sweep", // display always watermarked — must not linger
  21: "sweep", // re-do of the v20 sweep with the billing flag set
  22: "opt-in", // rules-text typography standard — owner's call
  23: "sweep", // default set mark for commons — one emblem across a set
  24: "sweep", // Card Conjurer M15 swap — a platform correction, owner-approved
  25: "sweep", // frame-review follow-ups (Alpha P/T, brand mark, Dragon Wing)
  26: "sweep", // etched finish — the baked left-edge strip was a bug, not a look
  27: "sweep", // owner decisions: Alpha re-cut + ink, Dragon Wing split, Ghostfire, pw title bar
  28: "sweep", // foil finish — it never reached a saved image
  29: "sweep", // round-5 leftovers: word spacing, pw rows, Alpha ink, stats, foil backdrops, aftermath
  30: "sweep", // fullartland re-sourced from Card Conjurer (4.39) — a frame swap, never an owner badge
  31: "sweep", // one corner radius (3.26): the bake's rounded corner, every card — a correction, never a badge
  32: "sweep", // one M15-era title / type size (4.20): the family's print sizes — a platform correction, never a badge
  33: "sweep", // rules text by its real lines at the prints' spacing (3.29) — a measurement correction, never a badge
  34: "sweep", // token release: P/T plate, type line + symbol on the token frames (4.49), "Token" first (3b.15) — a platform correction
  35: "sweep", // art-area corrections: CC M15 art slot (4.4 (2)), under-frame art from the border (4.17a), nyx / fullart / m15pw-c (4.17b)
  36: "sweep", // correction round 2: inline pips on the capitals (3.31), printed set-symbol sizes (4.46), walker symbol (4.47)
  37: "sweep", // nyx's type bar + text box darkened to the THB prints (4.17e) — a correction, never a badge
  38: "sweep", // the portrait layouts re-sourced from Card Conjurer (4.21a) — a frame swap, never a badge
  39: "sweep", // flip's lower half re-cut + aftermath's cost onto the prints (4.21a follow-up) — a correction, never a badge
  40: "sweep", // the modal backs' flipside strip toned onto the prints + the transform front's reverse P/T made a rules float (5.1d) — corrections on bodies no card uses yet, never a badge
  41: "sweep", // the modal strip rider (5.1c): an addition the visual gate records as a bump on the four modal faces — 0 cards on them, never a badge
  [SAGA_RAIL_LAYOUT_VERSION]: "sweep", // the saga rebuilt from Card Conjurer (4.21c): the ribbon in the master, the printed rail — a correction after the owner's sheet, never a badge
  43: "sweep", // the landscape layouts re-sourced from Card Conjurer (4.21b): split and battle — a frame swap on two templates no public card uses, never a badge
  44: "sweep", // the 2003 artist line white on the black frame and on lands (4.23a) — a legibility correction against the prints on combos no stored card uses, never a badge
  [RETRO_1997_LAYOUT_VERSION]: "sweep", // the 1997 frame on the original cards (4.10a): masters, ink, footer, sizes, symbols — a correction on a pair no stored card uses, never a badge
  [MODERN_2003_LAYOUT_VERSION]: "sweep", // the 2003 frame's one sweep (4.10b): masters, P/T box, sizes, footer, symbols — a correction of a live pair against its prints after the owner's before / after sign-off, never a badge
  [ALPHA_1993_LAYOUT_VERSION]: "sweep", // the 1993 frame on its prints (4.10c): sizes, faces, the `Illus.` credit, the P/T, the original symbols — a correction of a pair against Alpha / Beta after the owner's before / after sheet (4 stored cards), never a badge
  [BATTLE_RECUT_LAYOUT_VERSION]: "sweep", // the battle's right side, top block and icon re-cut onto the prints (4.21d) — a correction on a template no public card uses, never a badge
};

export function rolloutPolicy(version: number, rollout = VERSION_ROLLOUT): RolloutPolicy {
  return rollout[version] ?? "sweep";
}

export type SweepRow = ScopeCard & {
  layout_version: number | null;
  rendered_image_url: string | null;
  frame_style: unknown;
};

export type SweepVerdict =
  | "current" // already at the current version
  | "rebake" // a sweep-policy bump changed this card's output — re-render
  | "stamp" // nothing pending changed this card — stamp it current, no render
  | "opt-in"; // only opt-in bumps pending — leave it (and its badge) alone

/**
 * What a sweep may do to a card.
 *
 *   `targetVersion` — sweep ONE bump: re-bake only cards that bump changed
 *   (and only if its policy is "sweep"); otherwise stamp/opt-in as usual.
 *   No target — re-bake cards with ANY pending sweep-policy bump.
 *
 * A re-bake always renders with the current renderer, so any opt-in bumps
 * pending on THAT card come along — unavoidable, and the reason a sweep
 * must be as narrow as the bump that needs it. Never-baked or unversioned
 * cards are re-baked (there is no render to leave alone).
 */
export function classifyForSweep(
  row: SweepRow,
  targetVersion?: number,
  opts: {
    rollout?: Readonly<Record<number, RolloutPolicy>>;
    current?: number;
    scoped?: Readonly<Record<number, readonly string[]>>;
    scopes?: Readonly<Record<number, (card: ScopeCard) => boolean>>;
  } = {},
): SweepVerdict {
  const current = opts.current ?? CARD_LAYOUT_VERSION;
  const rollout = opts.rollout ?? VERSION_ROLLOUT;
  if (row.layout_version == null || !Number.isFinite(row.layout_version) || !row.rendered_image_url) {
    return "rebake";
  }
  if (row.layout_version >= current) return "current";
  const pending = pendingVersions(row.layout_version, templateOfFrameStyle(row.frame_style), row, {
    scoped: opts.scoped,
    scopes: opts.scopes,
    current,
  });
  if (pending.length === 0) return "stamp";
  const sweepPending = pending.filter((v) => rolloutPolicy(v, rollout) === "sweep");
  if (targetVersion !== undefined) {
    return sweepPending.includes(targetVersion) ? "rebake" : "opt-in";
  }
  return sweepPending.length > 0 ? "rebake" : "opt-in";
}

/** The newest owner opt-in version at or below `current` — the version an
 *  owner's "newer look" notification is keyed on — or null when there is
 *  none. A sweep bump never re-notifies owners. */
export function latestOptInVersion(
  rollout: Readonly<Record<number, RolloutPolicy>> = VERSION_ROLLOUT,
  current: number = CARD_LAYOUT_VERSION,
): number | null {
  let latest: number | null = null;
  for (let version = 1; version <= current; version += 1) {
    if (rolloutPolicy(version, rollout) === "opt-in") latest = version;
  }
  return latest;
}

/** The newest SWEEP-policy version at or below `current` (versions missing
 *  from the rollout map count as sweep). A stamp at or above it owes no
 *  platform correction: every bump after it is owner opt-in. The automatic
 *  re-bake's cheap "anything pending?" count reads cards stamped below it
 *  (lib/cards/auto-rebake.ts). */
export function latestSweepVersion(
  rollout: Readonly<Record<number, RolloutPolicy>> = VERSION_ROLLOUT,
  current: number = CARD_LAYOUT_VERSION,
): number {
  for (let version = current; version >= 1; version -= 1) {
    if (rolloutPolicy(version, rollout) === "sweep") return version;
  }
  return 0;
}

type PolicyOptions = {
  rollout?: Readonly<Record<number, RolloutPolicy>>;
  current?: number;
  scoped?: Readonly<Record<number, readonly string[]>>;
  scopes?: Readonly<Record<number, (card: ScopeCard) => boolean>>;
};

/**
 * True when the platform still owes this card a re-bake: the stamp is null
 * (a frame-geometry change marked it, or it predates versioning) or a
 * SWEEP-policy bump since its stamp changed its output. Such a bake is not
 * what the renderer means the card to look like, so downloads render live
 * instead of serving it (lib/render/stored-render.ts); the sweep and the
 * compare page's re-bake clear it.
 */
export function hasPendingCorrection(
  card: { layout_version: number | null | undefined; frame_style: unknown } & ScopeCard,
  opts: PolicyOptions = {},
): boolean {
  if (card.layout_version == null || !Number.isFinite(card.layout_version)) return true;
  const rollout = opts.rollout ?? VERSION_ROLLOUT;
  return pendingVersions(card.layout_version, templateOfFrameStyle(card.frame_style), card, opts).some(
    (version) => rolloutPolicy(version, rollout) === "sweep",
  );
}

/**
 * Owner-facing "a newer look is available" — the badge, the dashboard
 * count, the update walkthrough and the daily notification. Only a
 * PUBLISHED card with a STORED render can have a newer look: a private
 * card never carries a render, and a public card whose bake hasn't landed
 * yet (an AI card between publish and bake) or failed is "not baked", not
 * "out of date" — flagging it sent freshly generated cards straight into
 * the update prompt (2026-09-16).
 *
 * And only an OPT-IN bump is the owner's call (TODO 0.20, 2026-09-25): a
 * sweep bump or a frame-geometry change (null stamp) is a correction the
 * platform re-bakes itself — one override save used to badge 176 of the
 * dev database's 189 cards. A card that ALSO owes a correction gets no
 * badge either: the sweep re-renders it with the current renderer, opt-in
 * look included, so the badge would offer a choice the owner doesn't have.
 */
export function hasNewerLook(
  card: {
    visibility: string | null | undefined;
    layout_version: number | null | undefined;
    rendered_image_url: string | null | undefined;
    frame_style: unknown;
  } & ScopeCard,
  opts: PolicyOptions = {},
): boolean {
  if (card.visibility === "private") return false;
  if (!card.rendered_image_url) return false;
  if (card.layout_version == null || !Number.isFinite(card.layout_version)) return false;
  const rollout = opts.rollout ?? VERSION_ROLLOUT;
  const pending = pendingVersions(card.layout_version, templateOfFrameStyle(card.frame_style), card, opts);
  return (
    pending.some((version) => rolloutPolicy(version, rollout) === "opt-in") &&
    !pending.some((version) => rolloutPolicy(version, rollout) === "sweep")
  );
}

/**
 * True when a card's stored image predates what the current renderer draws
 * for it (any pending bump, or a null stamp). A live render — a paid
 * viewer's clean PNG or PDF, which cannot come from the watermarked bake —
 * then looks different from the gallery image, and the download modal says
 * so (TODO 0.21).
 */
export function storedLookIsOlder(
  card: {
    rendered_image_url: string | null | undefined;
    layout_version: number | null | undefined;
    frame_style: unknown;
  } & ScopeCard,
  opts: PolicyOptions = {},
): boolean {
  if (!card.rendered_image_url) return false;
  return isRenderStale(
    card.layout_version,
    templateOfFrameStyle(card.frame_style),
    opts.scoped ?? TEMPLATE_SCOPED_VERSIONS,
    opts.current ?? CARD_LAYOUT_VERSION,
    card,
    opts.scopes ?? VERSION_SCOPES,
  );
}

/**
 * Whether THIS viewer's download differs from the card's stored (gallery)
 * image. A paid viewer's clean download always renders live, so it differs
 * whenever the stored look is older; a free viewer's watermarked download
 * serves the stored bake unless a platform correction is pending
 * (lib/render/stored-render.ts), when it renders live too.
 */
export function downloadDiffersFromGallery(
  card: {
    rendered_image_url: string | null | undefined;
    layout_version: number | null | undefined;
    frame_style: unknown;
  } & ScopeCard,
  viewerIsPaid: boolean,
  opts: PolicyOptions = {},
): boolean {
  if (!card.rendered_image_url) return false;
  return viewerIsPaid ? storedLookIsOlder(card, opts) : hasPendingCorrection(card, opts);
}
