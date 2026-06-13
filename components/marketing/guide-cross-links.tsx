import Link from "next/link";
import { ArrowRight } from "lucide-react";

// ---------------------------------------------------------------------------
// GuideCrossLinks — "keep exploring" block for the SEO landing pages. Pass
// the current page's href so it links to the OTHER guides (internal linking
// keeps these pages out of orphan status for crawlers and visitors alike).
// ---------------------------------------------------------------------------

export const GUIDE_LINKS = [
  { href: "/mtg-card-maker", label: "MTG card maker" },
  { href: "/ai-mtg-card-generator", label: "AI MTG card generator" },
  { href: "/mana-pip-editor", label: "Mana pip editor" },
  { href: "/faq", label: "FAQ" },
] as const;

export function GuideCrossLinks({ current }: { current: string }) {
  const others = GUIDE_LINKS.filter((g) => g.href !== current);
  if (others.length === 0) return null;
  return (
    <nav aria-label="Related guides" className="mt-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
        Keep exploring
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {others.map((g) => (
          <li key={g.href}>
            <Link
              href={g.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-bright underline-offset-2 hover:underline"
            >
              {g.label}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
