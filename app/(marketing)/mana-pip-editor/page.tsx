import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { GuideCrossLinks } from "@/components/marketing/guide-cross-links";

// ---------------------------------------------------------------------------
// SEO landing page: /mana-pip-editor
//
// Dedicated page for the brand's namesake feature — precision mana pips and
// per-user custom pip icons. Targets "mana pip editor", "custom mana
// symbols", "MTG mana symbol maker" and related searches. Same structure as
// /mtg-card-maker: direct Q&A answers that AI engines can cite.
// ---------------------------------------------------------------------------

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "Mana Pip Editor — Custom MTG Mana Symbols",
  description:
    "PipGlyph's mana pip editor builds precise MTG-style mana costs — generic, hybrid, twobrid, phyrexian, snow, and energy — and lets you upload your own custom pip icons that render on every card you own.",
  alternates: { canonical: "/mana-pip-editor" },
  openGraph: {
    title: "Mana Pip Editor — Custom MTG Mana Symbols | PipGlyph",
    description:
      "Click-to-build mana costs with the full symbol vocabulary, then upload custom pip icons that replace the standard symbols on your cards — in the editor, the gallery, and exports.",
    type: "article",
  },
};

const FEATURES = [
  "Click-to-build mana costs — no notation to memorize",
  "Full symbol vocabulary: {0}–{20}, {X}, W U B R G C",
  "All ten hybrid symbols plus twobrids like {2/W}",
  "Phyrexian mana for all five colors and colorless",
  "Tap, untap, snow, and energy symbols",
  "Custom pip uploads — your own icon per core symbol",
  "Custom pips render everywhere: editor, gallery, PNG and PDF exports",
  "Pixel-identical pips in the live preview and the exported card",
  "Inline pips in rules text, sized like real card text",
  "Color identity derived from your cost automatically",
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is a mana pip editor?",
    a: "A mana pip editor is a tool for building the mana symbols (pips) on a custom trading card — the circular icons that show a card's cost. PipGlyph's pip editor is click-driven: you tap colored pip buttons to build costs like {2}{R}{R}, and the same symbols render inline in rules text for activation costs like {T}: Add one mana.",
  },
  {
    q: "Can I upload my own custom mana symbols?",
    a: "Yes. PipGlyph lets you upload a custom icon for each core mana symbol — white, blue, black, red, green, and colorless. Your icon replaces the standard symbol everywhere your cards render: the editor preview, your gallery thumbnails, public card pages, and PNG or PDF exports. Costs, color identity, and rules keep working exactly the same; only the icon changes.",
  },
  {
    q: "Which mana symbols does PipGlyph support?",
    a: "PipGlyph supports the full MTG-style mana vocabulary: generic costs {0} through {20}, variable costs {X} {Y} {Z}, the five colors plus colorless {W} {U} {B} {R} {G} {C}, all ten hybrid pairs like {W/U}, twobrids like {2/W}, phyrexian symbols like {R/P}, and the utility symbols tap {T}, untap {Q}, snow {S}, and energy {E}.",
  },
  {
    q: "Do custom pips show up on exported cards?",
    a: "Yes. PipGlyph renders exports server-side with the same layout engine as the live preview, so your custom pips appear in downloaded PNGs, print-ready PDFs, and the social-share images — pixel-aligned with standard symbols at any resolution.",
  },
  {
    q: "How do hybrid and phyrexian pips work?",
    a: "Hybrid pips show two halves — either two colors like {W/U} or a generic-color twobrid like {2/W} — and phyrexian pips carry the phi symbol, meaning the cost can be paid with mana or life. In PipGlyph you insert them from the symbol toolbar in the rules editor or build them into the mana cost, and they render as proper split discs in both the preview and the export.",
  },
  {
    q: "Is the pip editor free?",
    a: "Yes. The mana cost builder, the full symbol vocabulary, and custom pip uploads are free for every account. Custom pips are per-user: visitors always see a card with its owner's pips, so your set keeps a consistent look when you share it.",
  },
];

export default function ManaPipEditorPage() {
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Hero */}
      <div className="mb-14 flex flex-col gap-5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          Precision pips · Custom symbols · Free
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          The Mana Pip Editor for Custom Cards
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          Build MTG-style mana costs with the complete symbol vocabulary —
          hybrids, twobrids, phyrexian, snow, energy — then go further: upload
          your own pip icons and every card you own wears them, from the live
          preview to the printed PDF.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/preview">
              Try the pip editor <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/gallery">See cards in the gallery</Link>
          </Button>
        </div>
      </div>

      {/* Feature checklist */}
      <section aria-labelledby="features-heading" className="mb-14">
        <h2 id="features-heading" className="font-display mb-6 text-2xl font-semibold text-foreground">
          What the pip editor can do
        </h2>
        <SurfaceCard tone="gold" className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
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
      <GuideCrossLinks current="/mana-pip-editor" />

      <section
        aria-labelledby="cta-heading"
        className="relative overflow-hidden rounded-frame border border-gold/40 bg-surface p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2 id="cta-heading" className="font-display text-2xl font-semibold text-foreground">
            Make the pips yours
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            Build a cost in seconds, then upload your own symbols from the
            editor or your settings page. Free account, no downloads.
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
