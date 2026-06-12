import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { GuideCrossLinks } from "@/components/marketing/guide-cross-links";

// ---------------------------------------------------------------------------
// SEO landing: /ai-mtg-card-generator
//
// Targets the long-tail query family "AI MTG card generator", "AI magic
// card generator", "ChatGPT custom magic card", etc. Mirrors the structure
// of /mtg-card-maker but with copy and FAQ focused on the AI features:
// the in-editor assistant (Claude) and the random-card generator (GPT-4o
// + gpt-image-1, Phase 4).
// ---------------------------------------------------------------------------

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "AI MTG Card Generator — Design Custom Magic Cards with AI",
  description:
    "PipGlyph is an AI-powered Magic: The Gathering card generator. Describe a concept and the AI drafts a balanced creature, instant, planeswalker, or land — original card, original art, ready to share.",
  alternates: { canonical: "/ai-mtg-card-generator" },
  openGraph: {
    title: "AI MTG Card Generator — Free Custom Magic Cards | PipGlyph",
    description:
      "Generate a complete MTG card from a one-sentence concept. AI drafts the rules text, mana cost, rarity, and flavor — you tweak and publish. Free, browser-based.",
    type: "article",
  },
};

const FEATURES = [
  "One-click random card — AI picks rarity, color, type, and rules text",
  "Concept-to-card: type a theme and the AI drafts every field",
  "AI-generated original art sized for the card frame",
  "Live preview as the AI fills the editor",
  "Rules-text improver — clean templating + correct keyword capitalization",
  "Balance check — risk level, specific concerns, suggested tweaks",
  "Cost suggester — picks a mana value appropriate for the card's effect",
  "Rarity recommender — fits the card's complexity and impact",
  "Flavor-text writer in the voice of your color identity",
  "All work stays editable — the AI seeds the form, you ship the design",
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is an AI MTG card generator?",
    a: "An AI MTG card generator uses a large language model to draft a complete Magic: The Gathering card from a brief prompt or a click. PipGlyph's generator picks a rarity, color identity, type, mana cost, and rules text — then optionally generates original art with OpenAI's image model — and drops the result into the editor where you can tweak any field before publishing.",
  },
  {
    q: "How do I generate a random MTG card with AI?",
    a: "Open the card creator at /create and click 'Generate random card'. The AI picks every field for you and renders the result in the live preview. If you want a specific direction (e.g. 'a Selesnya Saga about a city of trees'), use the AI Assistant panel and pick 'Generate from concept'.",
  },
  {
    q: "Does the AI use real MTG keyword abilities?",
    a: "Yes. The AI assistant is allowed to use the full vocabulary of published MTG keyword abilities — Flying, Trample, Deathtouch, Lifelink, Vigilance, Menace, Cascade, Convoke, Cycling, Flashback, and so on — and to template rules text the same way Wizards' R&D does ('When …', 'Whenever …', 'Pay {N}'). The generator does NOT copy published card names, planeswalker names (Jace, Liliana, etc.), or set/world names — every card you generate is original.",
  },
  {
    q: "Can the AI generate artwork for my card?",
    a: "Yes. After the AI drafts the card's text, it composes a vivid art prompt and generates a single original image via OpenAI's image model. The image is uploaded to your card's art slot and you can replace it with your own upload at any time. Generated artwork is yours under the underlying OpenAI usage policy — typically free to use for non-commercial purposes.",
  },
  {
    q: "Is the AI random card generator free?",
    a: "Yes, within a daily quota. You need a free account to use the AI generator (it's disabled for signed-out visitors), and each account can generate up to 10 random cards per day so a single user can't drain the AI budget for everyone. Heavy users will eventually have an option to bring their own OpenAI API key.",
  },
  {
    q: "Will the AI design balanced cards?",
    a: "The AI is trained to follow MTG's color pie and mana curve heuristics, but it isn't infallible — a generated mythic might still be undercosted, and a generated common might be too weak. Run the 'Balance check' tool inside the AI assistant panel to get a risk-level read and concrete tweaks before publishing to the gallery.",
  },
  {
    q: "Can I edit the AI's output after it generates a card?",
    a: "Every field is editable in the live editor. The AI seeds the form; you ship the design. Change the title, swap the art, rewrite a rules-text line, downshift the mana cost — the AI's draft is a starting point, not a fixed output.",
  },
  {
    q: "How is this different from asking ChatGPT for a custom Magic card?",
    a: "A general chat assistant returns plain text — you'd still have to copy each field into a card editor, find or generate art, format the result, and share it. PipGlyph integrates the same kind of generation directly into the card editor: every AI output is a structured patch that lands on the canvas, the art lands in the right slot, and the published card has a real public URL with social previews, comments, likes, and remix lineage.",
  },
];

export default function AiMtgCardGeneratorPage() {
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
    <main
      id="main"
      className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mb-14 flex flex-col gap-5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
          AI-powered · Free · No setup
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          The AI MTG Card Generator
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          Describe a concept — &ldquo;a Boros planeswalker that punishes
          tapping creatures&rdquo;, &ldquo;a Simic ramp instant that scales
          with snow lands&rdquo; — and PipGlyph drafts a complete,
          original Magic: The Gathering card. AI writes the rules text, AI
          generates the art, you edit and publish.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/create">
              <Wand2 className="h-4 w-4" aria-hidden />
              Generate a random card
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/gallery">Browse community cards</Link>
          </Button>
        </div>
      </div>

      <section aria-labelledby="features-heading" className="mb-14">
        <h2
          id="features-heading"
          className="font-display mb-6 text-2xl font-semibold text-foreground"
        >
          What the AI does for you
        </h2>
        <SurfaceCard className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright"
                  aria-hidden
                />
                {f}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      </section>

      <section aria-labelledby="faq-heading" className="mb-14">
        <h2
          id="faq-heading"
          className="font-display mb-8 text-2xl font-semibold text-foreground"
        >
          Frequently asked questions
        </h2>
        <div className="flex flex-col gap-8">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <h3 className="font-display mb-2 text-lg font-semibold text-foreground">
                {q}
              </h3>
              <p className="text-sm leading-7 text-muted">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <GuideCrossLinks current="/ai-mtg-card-generator" />

      <section
        aria-labelledby="cta-heading"
        className="relative overflow-hidden rounded-frame border border-border bg-surface p-10"
      >
        <div className="absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <h2
            id="cta-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Let the AI draft the next one
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted">
            Open the card creator and click &ldquo;Generate random
            card&rdquo;. The AI fills every field, generates original
            artwork, and drops the result into the live preview. You take
            it from there.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/create">
                <Sparkles className="h-4 w-4" aria-hidden /> Open the card
                creator
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/mtg-card-maker">Manual card maker tour</Link>
            </Button>
          </div>
          <p className="text-xs text-subtle">
            Fan-made tool · Not affiliated with Wizards of the Coast · AI
            generates original card names, art, and flavor — published
            card names from Wizards&rsquo; sets are never reused verbatim.
          </p>
        </div>
      </section>
    </main>
  );
}
