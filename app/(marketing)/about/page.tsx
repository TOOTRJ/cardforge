import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "About",
  description:
    "PipGlyph is a modern, creator-first platform for designing custom trading cards. Learn what we're building.",
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
        PipGlyph is a modern platform for designing, sharing, and remixing
        custom trading cards. The MVP launches with a polished fantasy-card
        creator and is built to grow into any custom card game — your homebrew
        Commander deck, your indie TCG, your tabletop RPG cards, classroom
        flashcards, whatever you can imagine.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          <strong>Originality first.</strong> We do not use proprietary card
          frames, fonts, set symbols, or trademarked names. Every visual element
          shipped with PipGlyph is original to the project.
        </li>
        <li>
          <strong>Creators own their work.</strong> Cards are structured data —
          not just rendered images — so you can edit, remix, export, and move
          your designs without lock-in.
        </li>
        <li>
          <strong>Sharing without surrendering.</strong> Visibility is
          per-card: private, link-only, or public. We don&apos;t claim rights
          to your art or rules text.
        </li>
        <li>
          <strong>AI is a power-up, not the product.</strong> Forge AI helps
          you tighten templating, balance, and flavor. It never overwrites
          fields without an explicit apply.
        </li>
      </ul>

      <h2>What ships today</h2>
      <ul>
        <li>
          A nine-panel card editor with live preview — frames from three
          decades of card design, double-faced and adventure cards, and
          precise mana pips with per-user <strong>custom pip icons</strong>
        </li>
        <li>Scryfall import for remixing real cards, with lineage tracking</li>
        <li>Print-ready PNG and PDF export (single cards and 9-up sheets)</li>
        <li>A public gallery with filters, search, likes, and remix</li>
        <li>Custom sets with analytics and shareable detail pages</li>
        <li>Community design challenges with briefs, entry tags, and spotlights</li>
        <li>An optional AI design assistant powered by Anthropic Claude</li>
        <li>Account creation, profiles, visibility controls, and light/dark themes</li>
      </ul>

      <h2>The roadmap</h2>
      <p>
        Phase Zero locked the scope; phases 1 through 9 shipped the MVP. From
        here, the direction we&apos;re excited about includes:
      </p>
      <ul>
        <li>
          Card version history and per-card change logs.
        </li>
        <li>
          A more flexible template system so you can ship your own card
          layouts (planeswalker-style, board game style, RPG cards).
        </li>
        <li>
          A sets index for discovery, plus pinning featured sets.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Bugs, feature requests, partnership questions: open an issue on the
        repo or email the team at the address listed in your{" "}
        <Link href="/settings">account settings</Link> once we publish a
        contact channel publicly.
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
