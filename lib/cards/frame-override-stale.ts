import { DEFAULT_FRAME_TEMPLATE, FRAME_TEMPLATE_VALUES } from "@/types/card";

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
// "current" with a stale PNG.
// ---------------------------------------------------------------------------

export type StaleTemplateFilter =
  | { kind: "eq"; template: string }
  | { kind: "or"; expression: string };

export function staleTemplateFilter(template: string): StaleTemplateFilter {
  if (template !== DEFAULT_FRAME_TEMPLATE) return { kind: "eq", template };
  const known = FRAME_TEMPLATE_VALUES.join(",");
  return {
    kind: "or",
    expression: [
      `frame_style->>template.eq.${template}`,
      "frame_style->>template.is.null",
      `frame_style->>template.not.in.(${known})`,
    ].join(","),
  };
}
