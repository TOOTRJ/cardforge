import { buildTypeLine, displayLine, normalizeFrameTemplate } from "@/lib/cards/card-display";
import { statLayoutChanged } from "@/lib/cards/stat-fit";
import type { CardType } from "@/types/card";

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
//     decision 2026-09-25); the admin sweep re-bakes the affected cards and
//     downloads keep serving the stored bake until then only when no
//     correction is pending (lib/render/stored-render.ts).
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
//   * `node scripts/rebake-renders.mjs` (admin sweep) still exists for
//     corrections every card should get without asking (text clipping, the
//     2026-09 land fix) — reserve owner-driven updates for changes a user
//     might reasonably prefer to keep.
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
//            and the mana-symbol socket is painted (the symbol slot is
//            3.24's). Template-scoped to fullartland, "sweep": 0 public
//            production cards (anonymous read, 2026-09-26); private rows
//            need the owner's admin count before the sweep.
// ---------------------------------------------------------------------------

export const CARD_LAYOUT_VERSION = 30;

/**
 * Bumps that changed the output of only some frame templates, keyed by the
 * version they introduced (v24 and v25 so far; every earlier bump touched
 * every card). List EVERY template whose output changed — including the ones
 * that inherit a changed profile by spread (alphaland ← agclassic,
 * modernland ← modern). Template keys match `frame_style.template`
 * (types/card.ts FRAME_TEMPLATE_VALUES).
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
  // v30: fullartland's masters re-sourced from Card Conjurer (4.39).
  30: ["fullartland"],
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
   *  face's name and type line). */
  back_face?: unknown;
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
  const template = normalizeFrameTemplate(templateOfFrameStyle(card.frame_style));
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
  // template, or a frame_style that was read ({} or a retired value draws
  // DEFAULT_FRAME_TEMPLATE — the rule lib/cards/frame-override-stale.ts
  // uses; 272 production cards carry frame_style = {}). A caller that didn't
  // supply frame_style can't tell → conservative (touched), as
  // lib/render/stored-render.ts documents.
  const drawn =
    template != null || (card !== undefined && card.frame_style !== undefined)
      ? normalizeFrameTemplate(template)
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
//   "sweep"  — the platform refreshes every affected card centrally
//              (scripts/rebake-renders.mjs). For changes that must not
//              linger: watermark policy, a broken bake, a wrong emblem.
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
): boolean {
  if (!card.rendered_image_url) return false;
  return isRenderStale(
    card.layout_version,
    templateOfFrameStyle(card.frame_style),
    TEMPLATE_SCOPED_VERSIONS,
    CARD_LAYOUT_VERSION,
    card,
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
): boolean {
  if (!card.rendered_image_url) return false;
  return viewerIsPaid ? storedLookIsOlder(card) : hasPendingCorrection(card);
}
