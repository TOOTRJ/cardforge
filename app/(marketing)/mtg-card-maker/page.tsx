import type { Metadata } from "next";
import { serializeJsonLd } from "@/components/seo/json-ld";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { GuideCrossLinks } from "@/components/marketing/guide-cross-links";
import { CARD_MAKER_FAQ } from "@/lib/content/faq";

// ---------------------------------------------------------------------------
// SEO landing page: /mtg-card-maker
//
// Dedicated page targeting the high-volume query "MTG card maker" and
// related searches. Structured with direct Q&A answers so AI engines
// (ChatGPT, Perplexity, Google AI Mode) can cite specific passages.
// ---------------------------------------------------------------------------

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "MTG Card Maker — Create Custom Magic: The Gathering Cards",
  description:
    "PipGlyph is the best free MTG card maker. Design custom Magic: The Gathering cards with mana costs, oracle text, art, and power/toughness. No download required.",
  alternates: { canonical: "/mtg-card-maker" },
  openGraph: {
    title: "MTG Card Maker — Create Custom Magic Cards for Free | PipGlyph",
    description:
      "Build custom MTG cards online in seconds. Set mana cost, oracle text, color identity, rarity, and art. Free, browser-based, no account required to preview.",
    type: "article",
  },
};

// ---------------------------------------------------------------------------
// Feature checklist — scanned quickly by visitors and AI parsers alike
// ---------------------------------------------------------------------------
const FEATURES = [
  "All MTG card types — creature, instant, sorcery, enchantment, artifact, land, planeswalker, battle",
  "Mana cost notation with W U B R G C X support",
  "Oracle text with reminder text rendered in italics",
  "Power, toughness, loyalty, and defense fields",
  "WUBRG color identity selection",
  "Four rarities: Common, Uncommon, Rare, Mythic",
  "Art upload and focal point control",
  "AI assistant for rules text and flavor text",
  "Export card as PNG",
  "Community gallery to share and remix",
  "Full expansion set builder",
];

// ---------------------------------------------------------------------------
// FAQ — each Q/A pair is a direct answer to a real user query.
// This structure is what AI engines extract for citations.
// ---------------------------------------------------------------------------
const FAQ = CARD_MAKER_FAQ;

export default function MtgCardMakerPage() {
  // FAQPage structured data so the Q&A is eligible for rich results and is
  // citable by AI answer engines (the same FAQ rendered below, one source).
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
      />

      {/* Hero */}
      <div className="mb-14 flex flex-col gap-5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
          Free · Browser-based · No download required
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          The MTG Card Maker for Magic Fans
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          PipGlyph is a free, browser-based Magic: The Gathering card creator.
          Design any card type — creatures, instants, planeswalkers, full sets —
          with a live preview editor, then share with your playgroup in seconds.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/preview">
              Create your first card <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/gallery">Browse community cards</Link>
          </Button>
        </div>
      </div>

      {/* Feature checklist */}
      <section aria-labelledby="features-heading" className="mb-14">
        <h2 id="features-heading" className="font-display mb-6 text-2xl font-semibold text-foreground">
          What PipGlyph can do
        </h2>
        <SurfaceCard className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </section>

      {/* FAQ — the core SEO / AI citation content */}
      <section aria-labelledby="faq-heading" className="mb-14">
        <h2 id="faq-heading" className="font-display mb-8 text-2xl font-semibold text-foreground">
          Frequently asked questions
        </h2>
        <div className="flex flex-col gap-8">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <h3 className="font-display mb-2 text-lg font-semibold text-foreground">{q}</h3>
              <p className="text-sm leading-7 text-muted">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA footer */}
      <GuideCrossLinks current="/mtg-card-maker" />

      <section
        aria-labelledby="cta-heading"
        className="relative overflow-hidden rounded-frame border border-border bg-surface p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2 id="cta-heading" className="font-display text-2xl font-semibold text-foreground">
            Ready to forge your first spell?
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            No account required to start. Design your card, see the live preview,
            and sign up only when you want to save or share it.
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
            Fan-made tool · Not affiliated with Wizards of the Coast ·
            Original frames and assets
          </p>
        </div>
      </section>
    </main>
  );
}
