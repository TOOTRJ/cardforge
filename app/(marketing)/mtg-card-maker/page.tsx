import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";

// ---------------------------------------------------------------------------
// SEO landing page: /mtg-card-maker
//
// Dedicated page targeting the high-volume query "MTG card maker" and
// related searches. Structured with direct Q&A answers so AI engines
// (ChatGPT, Perplexity, Google AI Mode) can cite specific passages.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "MTG Card Maker — Create Custom Magic: The Gathering Cards",
  description:
    "Spellwright is the best free MTG card maker. Design custom Magic: The Gathering cards with mana costs, oracle text, art, and power/toughness. No download required.",
  alternates: { canonical: "/mtg-card-maker" },
  openGraph: {
    title: "MTG Card Maker — Create Custom Magic Cards for Free | Spellwright",
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
const FAQ: { q: string; a: string }[] = [
  {
    q: "What is an MTG card maker?",
    a: "An MTG card maker is a web tool that lets you design custom Magic: The Gathering cards. You fill in the card's name, mana cost, type line, oracle text, power/toughness (or loyalty for planeswalkers), and upload art. The tool renders your inputs as a card that looks like a real MTG card. Spellwright is a free, browser-based MTG card maker with a live preview editor.",
  },
  {
    q: "How do I make a custom MTG card?",
    a: "To make a custom MTG card on Spellwright: (1) Go to the card creator at /create. (2) Enter the card's name and mana cost using pip notation like {2}{R}{R}. (3) Choose the card type — creature, instant, sorcery, enchantment, artifact, planeswalker, land, or battle. (4) Write the oracle text for the card's abilities. (5) Set power and toughness for creatures, or loyalty for planeswalkers. (6) Upload art or use the art prompt tool. (7) Download as PNG or publish to the gallery.",
  },
  {
    q: "Is Spellwright free to use?",
    a: "Yes. Spellwright is completely free to use. You can preview and design cards without creating an account. Creating an account (also free) lets you save cards, build sets, publish to the community gallery, and remix other players' cards.",
  },
  {
    q: "Can I make a custom planeswalker card?",
    a: "Yes. Spellwright supports planeswalker cards with loyalty counters and +/– ability lines. Select 'Planeswalker' from the card type dropdown, enter the starting loyalty value, and write each loyalty ability in the oracle text field.",
  },
  {
    q: "Can I print my custom MTG cards?",
    a: "You can export your card as a high-resolution PNG and then print it at home or at a print shop. Custom fan-made cards are intended for personal, non-commercial use — such as playtesting a new Commander deck or sharing with your playgroup. Spellwright does not use official Wizards of the Coast card backs, fonts, or set symbols.",
  },
  {
    q: "What is the difference between Spellwright and MTG Cardsmith or Card Conjurer?",
    a: "Spellwright, MTG Cardsmith, and Card Conjurer are all free browser-based MTG card makers. Spellwright differentiates itself with a modern UI, a built-in AI assistant for oracle text and flavor text, full set management (group cards into named expansions), and a structured data model that keeps every card editable as JSON — not just a flat image.",
  },
  {
    q: "Is it legal to make custom MTG cards?",
    a: "Making custom Magic cards for personal, non-commercial use — playtesting, playgroup games, Commander homebrew — is generally accepted by the Magic community and falls under fan creation norms. Spellwright uses original card frames, fonts, and design elements and does not reproduce Wizards of the Coast's proprietary assets. Users are responsible for any artwork they upload and must not sell or commercially distribute printed proxy cards.",
  },
  {
    q: "How do I write proper MTG oracle text?",
    a: "MTG oracle text follows specific conventions: keyword abilities are capitalized (Flying, Trample, Vigilance), triggered abilities start with 'When', 'Whenever', or 'At', activated abilities use the format 'Cost: Effect', and reminder text goes in parentheses in italics. Spellwright's AI assistant can suggest properly templated oracle text for any ability you describe in plain English.",
  },
];

export default function MtgCardMakerPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">

      {/* Hero */}
      <div className="mb-14 flex flex-col gap-5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Free · Browser-based · No download required
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          The MTG Card Maker for Magic Fans
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-muted">
          Spellwright is a free, browser-based Magic: The Gathering card creator.
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
          What Spellwright can do
        </h2>
        <SurfaceCard className="p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
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
