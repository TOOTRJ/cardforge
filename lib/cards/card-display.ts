// Pure, framework-free card-display helpers shared by BOTH the live preview
// (components/cards/card-preview.tsx, a client component) and the Satori bake
// (lib/render/card-image.tsx, server-only). No "use client" / "server-only"
// directive so either side can import it without crossing the boundary.
//
// Centralizing the "which stat does this card type show?" logic here is what
// keeps the editor preview and the exported PNG in agreement — previously each
// renderer defined its own copy and they drifted (e.g. the bake gated loyalty
// on rarity instead of card type).

import {
  DEFAULT_FRAME_TEMPLATE,
  FRAME_TEMPLATE_VALUES,
  type CardType,
  type FrameTemplate,
} from "@/types/card";

// Coerce a persisted frame template to a known one. Older cards may carry the
// retired "regular" placeholder (or an empty/unknown value); those resolve to
// the default frame so the renderers never point at a deleted asset folder.
export function normalizeFrameTemplate(
  template: string | null | undefined,
): FrameTemplate {
  return (FRAME_TEMPLATE_VALUES as readonly string[]).includes(template ?? "")
    ? (template as FrameTemplate)
    : DEFAULT_FRAME_TEMPLATE;
}

// Subtypes that print P/T without being creatures — Vehicles show their
// crewed stats, Spacecraft their stationed stats. Matched case-insensitively
// so hand-typed subtypes ("vehicle") behave like imported ones ("Vehicle").
const PT_SUBTYPES = new Set(["vehicle", "spacecraft"]);

export function showsPowerToughness(
  cardType: CardType | null | undefined,
  subtypes?: readonly string[] | null,
): boolean {
  if (cardType === "creature" || cardType === "token") return true;
  return (subtypes ?? []).some((s) => PT_SUBTYPES.has(s.trim().toLowerCase()));
}

export function showsLoyalty(cardType: CardType | null | undefined): boolean {
  return cardType === "planeswalker";
}

export function showsDefense(cardType: CardType | null | undefined): boolean {
  return cardType === "battle";
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

// ---------------------------------------------------------------------------
// Saga chapters. The Saga frame has no normal text box — its rules are a
// vertical list of chapters down the left rail. We parse the card's rules text
// into chapters by their Roman-numeral markers ("I — …", "II, III — …",
// "IV: …"). Lines without a marker continue the previous chapter; lines before
// the first marker are dropped (sagas put the lore-counter reminder in the
// frame, not the text). Shared by the preview + bake so both render the same.
// ---------------------------------------------------------------------------

export type SagaChapter = { marker: string; text: string };

const CHAPTER_LINE =
  /^\s*([ivx]+(?:\s*,\s*[ivx]+)*)\s*[—:–-]\s*(.+)$/i;

export function parseChapters(
  rulesText: string | null | undefined,
): SagaChapter[] {
  if (!rulesText?.trim()) return [];
  const out: SagaChapter[] = [];
  for (const raw of rulesText.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = CHAPTER_LINE.exec(line);
    if (match) {
      out.push({
        marker: match[1].toUpperCase().replace(/\s+/g, ""),
        text: match[2].trim(),
      });
    } else if (out.length > 0) {
      out[out.length - 1].text += ` ${line}`;
    }
  }
  return out;
}

/** Lines before the first chapter marker — the saga's intro/reminder text
 *  ("(As this Saga enters …)"), printed above chapter I on real cards. */
export function parseSagaIntro(
  rulesText: string | null | undefined,
): string | null {
  if (!rulesText?.trim()) return null;
  const intro: string[] = [];
  for (const raw of rulesText.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (CHAPTER_LINE.test(line)) break;
    intro.push(line);
  }
  return intro.length > 0 ? intro.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Planeswalker loyalty abilities. Real M15 planeswalkers print each ability as
// its own row with a loyalty-cost badge (+1 / −3 / 0) in a left rail and
// alternating row shading. We parse the card's rules text by leading loyalty
// costs; lines without one (static abilities) render as unbadged rows. Shared
// by the preview + bake so both render the same.
// ---------------------------------------------------------------------------

export type LoyaltyAbility = { cost: string | null; text: string };

const LOYALTY_LINE = /^\s*([+\-−–]?)\s*(\d+|X)\s*:\s*(.+)$/i;

export function parseLoyaltyAbilities(
  rulesText: string | null | undefined,
): LoyaltyAbility[] {
  if (!rulesText?.trim()) return [];
  const out: LoyaltyAbility[] = [];
  for (const raw of rulesText.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = LOYALTY_LINE.exec(line);
    if (match) {
      // Normalize the sign to ASCII so the Satori bake (whose fonts lack
      // U+2212) and the browser render the identical glyph.
      const sign = match[1] === "+" ? "+" : match[1] ? "-" : "";
      out.push({
        cost: `${sign}${match[2].toUpperCase()}`,
        text: match[3].trim(),
      });
    } else {
      out.push({ cost: null, text: line });
    }
  }
  return out;
}

// Builds the "Supertype Type — Subtype Subtype" line shown in the type bar.
export function buildTypeLine({
  supertype,
  cardType,
  subtypes,
}: {
  supertype?: string | null;
  cardType?: CardType | null;
  subtypes?: string[];
}): string {
  const left = [supertype, cardType ? capitalize(cardType) : null]
    .filter(Boolean)
    .join(" ");
  const right = subtypes?.filter(Boolean).join(" ") ?? "";
  if (left && right) return `${left} — ${right}`;
  return left || right || "Type";
}
