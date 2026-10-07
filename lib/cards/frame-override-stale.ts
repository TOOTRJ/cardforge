import { DEFAULT_FRAME_TEMPLATE, FRAME_TEMPLATE_VALUES, RETIRED_FRAME_TEMPLATES } from "@/types/card";

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
