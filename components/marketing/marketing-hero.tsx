import Link from "next/link";
import { FileDown, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompassStar } from "@/components/ui/compass-star";
import { StarfieldBackdrop } from "@/components/ui/starfield-backdrop";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";

// WUBRG pips rendered with the Mana font — the same glyphs the card pips use,
// so the strip shows real MTG mana symbols rather than plain colored dots.
const MANA_PIPS = [
  { key: "w", label: "White" },
  { key: "u", label: "Blue" },
  { key: "b", label: "Black" },
  { key: "r", label: "Red" },
  { key: "g", label: "Green" },
];

// The three precision promises under the CTAs (mockup's micro-feature row).
const MICRO_FEATURES = [
  { icon: Sparkles, label: "Pixel-perfect pips" },
  { icon: Type, label: "Advanced text tools" },
  { icon: FileDown, label: "Print-ready exports" },
];

export type HeroFeaturedCard = {
  slug: string;
  title: string;
  imageUrl: string;
  owner: { username: string; displayName: string | null };
};

export function MarketingHero({
  featured = [],
}: {
  /** Admin-curated hero cards (0053). Empty → the placeholder pair below. */
  featured?: HeroFeaturedCard[];
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <StarfieldBackdrop withGlyphs />

      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8 lg:py-32">
        <div className="flex flex-col items-start gap-6">
          {/* Eyebrow */}
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
            <CompassStar className="h-3.5 w-3.5" />
            Built for creators. Inspired by legends.
          </p>

          {/* Headline */}
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Create custom MTG-style cards with
            <span className="block bg-linear-to-r from-gold-strong via-primary-bright to-primary-bright bg-clip-text text-transparent">
              perfect pips, text, and frames.
            </span>
          </h1>

          {/* Sub-copy — MTG vocabulary throughout */}
          <p className="max-w-xl text-base leading-7 text-muted sm:text-lg">
            Set mana costs with precision pips, write oracle text with smart
            tools, and pick frames from three decades of card design — then
            share the result with your playgroup or the community. Free to
            start; no account needed to preview.
          </p>

          {/* WUBRG pip strip */}
          <div className="flex items-center gap-2" aria-label="Supports all five Magic colors">
            <span className="flex items-center gap-1.5 text-xl leading-none" aria-hidden>
              {MANA_PIPS.map((pip) => (
                <i
                  key={pip.key}
                  className={`ms ms-${pip.key} ms-cost ms-shadow`}
                  title={pip.label}
                />
              ))}
            </span>
            <span className="ml-1 text-xs text-subtle">All five colors supported</span>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/preview">Start creating</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/gallery">Explore the gallery</Link>
            </Button>
          </div>

          {/* Micro-features — the precision promises */}
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {MICRO_FEATURES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"
              >
                <Icon className="h-3.5 w-3.5 text-gold" aria-hidden />
                {label}
              </li>
            ))}
          </ul>

          {/* Legal micro-copy */}
          <p className="text-xs leading-5 text-subtle">
            Fan-made tool. Not affiliated with Wizards of the Coast.
            Original frames — no copyrighted assets used.
          </p>
        </div>

        {/* Hero card preview — admin-featured community cards when curated,
            otherwise the two tilted placeholder cards. */}
        <div className="relative">
          <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-linear-to-br from-primary/25 via-gold/10 to-transparent blur-2xl" aria-hidden />
          {featured.length > 0 ? (
            <div className="flex flex-col gap-4">
              <div
                className={
                  featured.length === 1
                    ? "mx-auto grid max-w-xs grid-cols-1"
                    : "grid grid-cols-2 gap-4 sm:gap-6"
                }
              >
                {featured.slice(0, 2).map((card, i) => (
                  <div
                    key={card.slug}
                    className={
                      featured.length === 1
                        ? ""
                        : i === 0
                          ? "rotate-[-4deg]"
                          : "mt-12 rotate-[4deg]"
                    }
                  >
                    <Link
                      href={`/card/${card.owner.username}/${card.slug}`}
                      className="group block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={card.imageUrl}
                        alt={card.title}
                        className="w-full rounded-xl border border-gold/30 shadow-xl transition-transform group-hover:-translate-y-1"
                      />
                    </Link>
                    <p className="mt-2 text-center text-xs text-muted">
                      by{" "}
                      <Link
                        href={`/profile/${card.owner.username}`}
                        className="font-medium text-primary-bright hover:underline"
                      >
                        {card.owner.displayName ?? `@${card.owner.username}`}
                      </Link>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:gap-6">
              <CardPreviewPlaceholder
                className="rotate-[-4deg]"
                card={{
                  title: "Cinderclaws Drake",
                  cost: "{2}{R}{R}",
                  cardType: "creature",
                  rarity: "mythic",
                  colorIdentity: "red",
                  artistCredit: "You",
                }}
              />
              <CardPreviewPlaceholder
                className="mt-12 rotate-[4deg]"
                card={{
                  title: "Veilwarden Sage",
                  cost: "{1}{U}{U}",
                  cardType: "creature",
                  rarity: "rare",
                  colorIdentity: "blue",
                  artistCredit: "You",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
