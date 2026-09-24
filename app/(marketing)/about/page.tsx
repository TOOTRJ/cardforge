import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import { siteConfig } from "@/lib/site-config";

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "About",
  description:
    "PipGlyph is a free, browser-based custom Magic: The Gathering card creator with deck building, AI help, and a community gallery. What it is and what it stands for.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <LegalPageShell
      eyebrow="About"
      title={`What is ${siteConfig.name}?`}
      description={siteConfig.description}
    >
      <p>
        PipGlyph is a free, browser-based workshop for designing, sharing, and
        remixing custom Magic: The Gathering-style cards — and for turning them
        into playable decks. It began as a card creator with precise mana pips
        and grew into the whole loop: design a card in a live-preview editor,
        publish it to a community gallery, build a deck around it, print
        proxies, and playtest. It is a fan-made tool, not affiliated with
        Wizards of the Coast.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          <strong>Originality first.</strong> We do not use proprietary card
          frames, fonts, set symbols, or trademarked names. Every visual element
          shipped with PipGlyph is original to the project, measured against
          real printings so it looks right without copying them.
        </li>
        <li>
          <strong>Creators own their work.</strong> Cards are structured data —
          not just rendered images — so you can edit, remix, export, and move
          your designs without lock-in.
        </li>
        <li>
          <strong>Sharing without surrendering.</strong> Visibility is per card
          and per deck: private, link-only, or public. We don&apos;t claim
          rights to your art or rules text.
        </li>
        <li>
          <strong>AI is a power-up, not the product.</strong> The AI drafts a
          field, a card, an art piece or a whole deck when you ask it to, and
          never overwrites anything without an explicit apply.
        </li>
      </ul>

      <h2>What ships today</h2>
      <ul>
        <li>
          A step-by-step card creator with a live preview — every card type
          including sagas, adventures, split, aftermath and flip cards and
          double-faced backs; frames from three decades of card design; the
          full mana-symbol vocabulary plus your own uploaded pip icons; and a
          printed set symbol of your choosing
        </li>
        <li>
          AI on demand: generate any single field, get three costed ideas for a
          theme, draft a whole card from a concept, restyle a card&apos;s art,
          or generate a full deck with a how-to-play guide
        </li>
        <li>
          Decks: import a decklist from the popular deck sites, remix real
          cards into custom versions, see the curve and color analytics, and
          print proxy sheets
        </li>
        <li>Scryfall import for remixing real cards, with lineage tracking</li>
        <li>
          Downloads: a watermarked PNG on every account; watermark-free
          high-resolution PNG and print-ready PDF on paid plans, and whole-deck
          proxy sheets on Pro
        </li>
        <li>A public gallery with search, likes, comments, and remixing</li>
        <li>Community design challenges with briefs, entry tags, and spotlights</li>
        <li>Profiles, a following feed, notifications, and light/dark themes</li>
        <li>
          A free plan with 5 AI credits to start, and Plus and Pro plans for
          monthly credits, clean downloads and a bigger card library — see{" "}
          <Link href="/pricing">pricing</Link>
        </li>
      </ul>

      <h2>What&apos;s next</h2>
      <p>
        Premium custom frames and finishes, card printing, and richer deck
        tools are in development. Releases are announced on the{" "}
        <Link href="/news">news page</Link>, and the{" "}
        <Link href="/articles">guides</Link> grow alongside the product.
      </p>

      <h2>Contact</h2>
      <p>
        Bugs, feature requests, takedown or privacy requests, partnership
        questions: use the <Link href="/feedback">feedback form</Link> (pick
        the category that fits, or &ldquo;Other&rdquo;). It lands in the
        team&apos;s inbox and you&apos;ll get a reply in your account
        messages.
      </p>

      <h2>Legal</h2>
      <p>
        <Link href="/disclaimer">Disclaimer</Link> ·{" "}
        <Link href="/terms">Terms of service</Link> ·{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
    </LegalPageShell>
  );
}
