import { DEFAULT_FRAME_TEMPLATE, FRAME_TEMPLATE_VALUES, RETIRED_FRAME_TEMPLATES } from "@/types/card";
import type { CardBackFace } from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { isDfcBackBody } from "@/lib/cards/dfc";
import { backBodyOf, type CardFaceColumns } from "@/lib/cards/faces";

// ---------------------------------------------------------------------------
// Which baked cards render on a frame template — the filter the override
// actions use to mark renders stale after a layout change. Pure so it can be
// unit-tested (the action file is "use server" and can only export async
// functions).
//
// Cards with NO explicit template render on the default one, and so do
// cards carrying a legacy/unknown value (the retired "regular" placeholder):
// normalizeFrameTemplate (lib/cards/card-display.ts) maps both to
// DEFAULT_FRAME_TEMPLATE, so a default-template override changes their
// geometry too. Matching only `eq` and `is.null` left the legacy rows
// "current" with a stale PNG. A RETIRED template (types/card.ts
// RETIRED_FRAME_TEMPLATES) draws on its replacement instead, so an override
// of the replacement marks those rows too.
//
// BACK BODIES (TODO 5.3): a double-faced card's back face draws on the body
// stored at `back_face.frame_style.template` (lib/cards/faces.ts
// backBodyOf), and its `{id}.back.png` / `.back.thumb.webp` are baked from
// it. A save on a back body therefore owes a re-bake to every card whose
// back is DRAWN on it: `staleBackBodyFilter` is a second scan beside the
// front one (null for a template no back is drawn on, so a front-only
// template's scan is exactly what it was), narrowed in code by
// `backFaceDrawsOn` — the renderer's own rule: a front that holds a back
// AND a back-body template. A legacy back draws on the FRONT's frame and is
// never baked, so the front scan already covers its card.
// ---------------------------------------------------------------------------

export type StaleTemplateFilter =
  | { kind: "eq"; template: string }
  | { kind: "or"; expression: string };

/** The retired template values a card may still carry that DRAW on
 *  `template` (RETIRED_FRAME_TEMPLATES, TODO 4.54): both of a retired
 *  value's replacements count — whether a row has text is not worth a
 *  second filter, and marking a bake stale that wasn't costs one re-bake. */
function retiredValuesDrawnOn(template: string): string[] {
  return [...RETIRED_FRAME_TEMPLATES]
    .filter(([, to]) => to.bare === template || to.withText === template)
    .map(([retired]) => retired);
}

export function staleTemplateFilter(template: string): StaleTemplateFilter {
  const retired = retiredValuesDrawnOn(template);
  if (template !== DEFAULT_FRAME_TEMPLATE) {
    if (retired.length === 0) return { kind: "eq", template };
    return {
      kind: "or",
      expression: [template, ...retired].map((t) => `frame_style->>template.eq.${t}`).join(","),
    };
  }
  // A retired value draws on its replacement, not on the default frame.
  const known = [...FRAME_TEMPLATE_VALUES, ...RETIRED_FRAME_TEMPLATES.keys()].join(",");
  return {
    kind: "or",
    expression: [
      `frame_style->>template.eq.${template}`,
      "frame_style->>template.is.null",
      `frame_style->>template.not.in.(${known})`,
      ...retired.map((t) => `frame_style->>template.eq.${t}`),
    ].join(","),
  };
}

/** The back-face filter of a template a back face can be drawn on (a DFC
 *  back body: `isDfcBackBody`), else null — the column path as PostgREST
 *  reads it. */
export function staleBackBodyFilter(template: string): { column: string; template: string } | null {
  if (!isDfcBackBody(template)) return null;
  return { column: "back_face->frame_style->>template", template };
}

/** True when a stored row's BACK face is drawn — and baked — on `template`
 *  (backBodyOf: the rule both bake paths and the preview read). */
export function backFaceDrawsOn(row: CardFaceColumns, template: string): boolean {
  const body = backBodyOf({
    frameStyle: (row.frame_style as CardPreviewData["frameStyle"]) ?? {},
    backFace: (row.back_face as CardBackFace | null) ?? null,
  });
  return body?.template === template;
}
