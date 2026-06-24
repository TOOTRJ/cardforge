import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { GuideCrossLinks } from "@/components/marketing/guide-cross-links";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { COMPARISON_FAQ } from "@/lib/content/faq";

// ---------------------------------------------------------------------------
// SEO landing page: /best-mtg-card-makers
//
// Comparison / capture page targeting "best MTG card maker" and the displaced
// "CardConjurer alternative" demand (CardConjurer was taken down in late 2023
// after a WotC cease-and-desist). Factual and neutral about other tools; the
// differentiator we lean on is PipGlyph's original, fan-policy-compliant
// assets. FAQ uses the shared COMPARISON_FAQ so the hub and structured data
// stay in sync.
// ---------------------------------------------------------------------------

export const dynamic = "error";

export const metadata: Metadata = {
  title: "Best MTG Card Makers in 2026, Compared",
  description:
    "The best MTG card makers compared, and a free CardConjurer alternative. How PipGlyph, MTG Cardsmith, MTGNexus, and Magic Set Editor stack up for custom Magic cards.",
  alternates: { canonical: "/best-mtg-card-makers" },
  openGraph: {
    title: "Best MTG Card Makers in 2026, Compared | PipGlyph",
    description:
      "An honest comparison of custom MTG card makers — and a free, browser-based CardConjurer alternative with live preview, custom pips, AI, and proxy export.",
    type: "article",
  },
};

const CRITERIA = [
  "All card types — creatures, instants, sorceries, planeswalkers, lands, and more",
  "Accurate mana pips, including custom uploaded pip icons",
  "Faithful card frames built from original (non-WotC) assets",
  "High-resolution PNG and print-ready PDF export for proxies",
  "Full expansion-set building, not just one-off cards",
  "A community to share, get feedback, and remix designs",
  "An AI assistant for rules text and flavor",
  "Respects Wizards' intellectual property and Fan Content Policy",
];

const PIPGLYPH_STRENGTHS = [
  "Live-preview editor — your card renders as you type",
  "The complete mana-symbol vocabulary, plus custom pip uploads",
  "AI assistant for oracle text, flavor, and whole-card generation",
  "Expansion-set builder with a booster-draft simulator",
  "Public gallery with likes, comments, and card remixing",
  "PNG and print-ready PDF export sized for real cards",
  "Original frames and fonts — not Wizards' proprietary assets",
  "Free to start, no account needed to preview",
];

type Tool = {
  name: string;
  type: string;
  bestFor: string;
};

const LANDSCAPE: Tool[] = [
  {
    name: "PipGlyph",
    type: "Free · Browser",
    bestFor:
      "Live-preview editing, custom mana pips, AI text, set building, sharing and remixing, and proxy export.",
  },
  {
    name: "MTG Cardsmith",
    type: "Freemium · Browser",
    bestFor:
      "A large, long-running community and quick single-card creation.",
  },
  {
    name: "MTGNexus",
    type: "Free · Browser",
    bestFor:
      "Publishing full custom sets and gathering community feedback.",
  },
  {
    name: "Magic Set Editor",
    type: "Free · Desktop",
    bestFor:
      "Building large sets offline with deep, scriptable templating.",
  },
  {
    name: "CardConjurer",
    type: "Discontinued (2023)",
    bestFor:
      "Was prized for high-fidelity rendering; taken down after a WotC cease-and-desist.",
  },
];

export default function BestMtgCardMakersPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: COMPARISON_FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <JsonLd data={faqJsonLd} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Best MTG card makers", path: "/best-mtg-card-makers" },
        ])}
      />

      {/* Hero */}
      <div className="mb-14 flex flex-col gap-5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
          Comparison · 2026
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          The Best MTG Card Makers, Compared
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          Looking for the best way to make custom Magic: The Gathering cards —
          or a CardConjurer alternative? Here&apos;s an honest look at the
          landscape and where PipGlyph fits: a free, browser-based card maker
          with a live preview, custom mana pips, an AI assistant, set building,
          and proxy export.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/preview">
              Try the card maker <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/gallery">Browse community cards</Link>
          </Button>
        </div>
      </div>

      {/* What to look for */}
      <section aria-labelledby="criteria-heading" className="mb-14">
        <h2
          id="criteria-heading"
          className="font-display mb-6 text-2xl font-semibold text-foreground"
        >
          What to look for in an MTG card maker
        </h2>
        <SurfaceCard className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {CRITERIA.map((c) => (
              <li
                key={c}
                className="flex items-start gap-2.5 text-sm text-muted"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright"
                  aria-hidden
                />
                {c}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </section>

      {/* Landscape table */}
      <section aria-labelledby="landscape-heading" className="mb-14">
        <h2
          id="landscape-heading"
          className="font-display mb-6 text-2xl font-semibold text-foreground"
        >
          The custom MTG card maker landscape
        </h2>
        <SurfaceCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border px-4 py-3 text-left font-semibold text-foreground">
                  Tool
                </th>
                <th className="border-b border-border px-4 py-3 text-left font-semibold text-foreground">
                  Type
                </th>
                <th className="border-b border-border px-4 py-3 text-left font-semibold text-foreground">
                  Best for
                </th>
              </tr>
            </thead>
            <tbody>
              {LANDSCAPE.map((tool) => (
                <tr key={tool.name}>
                  <td className="border-b border-border/50 px-4 py-3 align-top font-medium text-foreground">
                    {tool.name}
                  </td>
                  <td className="border-b border-border/50 px-4 py-3 align-top text-muted">
                    {tool.type}
                  </td>
                  <td className="border-b border-border/50 px-4 py-3 align-top text-muted">
                    {tool.bestFor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
        <p className="mt-3 text-xs text-subtle">
          Tool descriptions are our own neutral summaries for comparison. Each
          tool is owned by its respective makers.
        </p>
      </section>

      {/* Why CardConjurer went away */}
      <section aria-labelledby="cardconjurer-heading" className="mb-14">
        <h2
          id="cardconjurer-heading"
          className="font-display mb-4 text-2xl font-semibold text-foreground"
        >
          What happened to CardConjurer, and what it means
        </h2>
        <div className="flex flex-col gap-4 text-sm leading-7 text-muted">
          <p>
            CardConjurer was, for years, one of the most popular custom-card
            renderers, prized for its high-fidelity frames. In late 2023 its
            creator took it offline after receiving a cease-and-desist from
            Wizards of the Coast over the use of official intellectual property.
          </p>
          <p>
            The takeaway for anyone choosing a tool today: custom-card platforms
            last only if they respect Wizards&apos; IP. PipGlyph is built from
            original frames, fonts, and mana symbols — not Wizards&apos;
            proprietary assets — and follows the spirit of the Fan Content
            Policy, so you can design, share, and print proxies for personal use
            with confidence. It is not affiliated with Wizards of the Coast.
          </p>
        </div>
      </section>

      {/* Where PipGlyph fits */}
      <section aria-labelledby="pipglyph-heading" className="mb-14">
        <h2
          id="pipglyph-heading"
          className="font-display mb-6 text-2xl font-semibold text-foreground"
        >
          Where PipGlyph fits
        </h2>
        <p className="mb-6 max-w-2xl text-sm leading-7 text-muted">
          PipGlyph is built for designers who want their cards to look printed,
          not pasted together — and who want to take a design from idea to a
          full, shareable set. Learn the craft with our{" "}
          <Link
            href="/articles"
            className="font-medium text-primary-bright underline-offset-2 hover:underline"
          >
            custom card design guides
          </Link>
          , build with the{" "}
          <Link
            href="/mtg-card-maker"
            className="font-medium text-primary-bright underline-offset-2 hover:underline"
          >
            card maker
          </Link>
          , and dial in costs with the{" "}
          <Link
            href="/mana-pip-editor"
            className="font-medium text-primary-bright underline-offset-2 hover:underline"
          >
            mana pip editor
          </Link>
          .
        </p>
        <SurfaceCard className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {PIPGLYPH_STRENGTHS.map((s) => (
              <li
                key={s}
                className="flex items-start gap-2.5 text-sm text-muted"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright"
                  aria-hidden
                />
                {s}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </section>

      {/* FAQ — the core SEO / AI citation content */}
      <section aria-labelledby="faq-heading" className="mb-14">
        <h2
          id="faq-heading"
          className="font-display mb-8 text-2xl font-semibold text-foreground"
        >
          Frequently asked questions
        </h2>
        <div className="flex flex-col gap-8">
          {COMPARISON_FAQ.map(({ q, a }) => (
            <div key={q}>
              <h3 className="font-display mb-2 text-lg font-semibold text-foreground">
                {q}
              </h3>
              <p className="text-sm leading-7 text-muted">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <GuideCrossLinks current="/best-mtg-card-makers" />

      {/* CTA footer */}
      <section
        aria-labelledby="cta-heading"
        className="relative mt-10 overflow-hidden rounded-frame border border-border bg-surface p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2
            id="cta-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Make your first card free
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            No account required to start. Design your card, see the live
            preview, and sign up only when you want to save, share, or build a
            full set.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/preview">Open the card creator</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/signup">Create a free account</Link>
            </Button>
          </div>
          <p className="text-xs text-subtle">
            Fan-made tool · Not affiliated with Wizards of the Coast · Original
            frames and assets
          </p>
        </div>
      </section>
    </main>
  );
}
