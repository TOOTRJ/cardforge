import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";

// ---------------------------------------------------------------------------
// The rail's call to action (TODO WD10): a reading page's one "do this next"
// beside the text, in the width a wide frame gives it. ONE look for every
// rail (the landing pages, the legal shell, help) — never a hand-made box.
// ---------------------------------------------------------------------------

export type RailCtaProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action: { href: string; label: string };
  secondary?: { href: string; label: string };
};

export function RailCta({ eyebrow, title, description, action, secondary }: RailCtaProps) {
  return (
    <SurfaceCard tone="gold" className="relative flex flex-col gap-3 overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-radial-glow opacity-50" aria-hidden />
      {eyebrow ? (
        <span className="relative text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="relative font-display text-lg font-semibold leading-snug text-foreground">{title}</h2>
      <p className="relative text-sm leading-6 text-muted">{description}</p>
      <div className="relative mt-1 flex flex-col gap-2">
        <Button asChild>
          <Link href={action.href}>
            {action.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        {secondary ? (
          <Button asChild variant="ghost">
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

/** A rail's list of related pages: a small heading and plain links. */
export function RailLinks({
  title,
  links,
  current,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string }>;
  /** The page's own href — marked, never linked to itself. */
  current?: string;
}) {
  return (
    <nav aria-label={title} className="border-l border-border/60 pl-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {links.map((link) =>
          link.href === current ? (
            <li key={link.href}>
              <span aria-current="page" className="font-medium text-foreground">
                {link.label}
              </span>
            </li>
          ) : (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-sm text-muted underline-offset-4 transition-colors hover:text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                {link.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

/** The SEO landing pages' rail (TODO WD10): the page's one action, then the
 *  other guides. Phones keep the page's own inline copies of both. */
export function LandingRail({
  current,
  links,
  action = { href: "/create", label: "Open the card creator" },
}: {
  current: string;
  links: ReadonlyArray<{ href: string; label: string }>;
  action?: { href: string; label: string };
}) {
  return (
    <>
      <RailCta
        eyebrow="Free to start"
        title="Make your first card"
        description="Every frame, every card type and a live preview — sign up in seconds, with 5 AI credits to start."
        action={action}
        secondary={{ href: "/gallery", label: "Browse community cards" }}
      />
      <RailLinks title="Keep exploring" links={links.filter((link) => link.href !== current)} />
    </>
  );
}
