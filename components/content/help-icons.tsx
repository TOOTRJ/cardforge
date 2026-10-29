import { createElement, type SVGProps } from "react";
import {
  Compass,
  Import,
  Layers,
  LifeBuoy,
  PenLine,
  Printer,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// One icon per help section (lib/content/help.ts) — the hub's cards, a
// section's header and the "Other help topics" row draw the same glyph for
// the same section. Kept out of lib/content/help.ts so that module stays
// React-free.
// ---------------------------------------------------------------------------

export const HELP_SECTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  "getting-started": Compass,
  "card-creator": PenLine,
  importing: Import,
  decks: Layers,
  printing: Printer,
  "ai-and-credits": Sparkles,
  "sharing-and-community": Users,
  "account-and-privacy": ShieldCheck,
};

/** A section's icon (the life buoy for one the table doesn't name). */
export function HelpSectionIcon({
  slug,
  ...props
}: { slug: string } & SVGProps<SVGSVGElement>) {
  return createElement(HELP_SECTION_ICONS[slug] ?? LifeBuoy, { "aria-hidden": true, ...props });
}
