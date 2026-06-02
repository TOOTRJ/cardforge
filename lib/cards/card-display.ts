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

export function showsPowerToughness(
  cardType: CardType | null | undefined,
): boolean {
  return cardType === "creature" || cardType === "token";
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
