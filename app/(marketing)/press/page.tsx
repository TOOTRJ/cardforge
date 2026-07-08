import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import { BrandAssetCard } from "@/components/marketing/brand-asset-card";
import { BRAND } from "@/lib/brand/constants";
import { siteConfig } from "@/lib/site-config";

// Hard guarantee of static rendering: if a future change introduces a
// cookie/header read on this page, the build fails instead of silently
// losing CDN cacheability.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "Press kit",
  description:
    "PipGlyph brand assets: the Astral Rose logo in every variant, color palette, typography, usage guidelines, and a downloadable press kit.",
  alternates: { canonical: "/press" },
};

const PALETTE = [
  { name: "Gold", hex: BRAND.gold, className: "bg-gold" },
  { name: "Gold light", hex: BRAND.goldLight, className: "bg-[#ecca8a]" },
  { name: "Gold deep", hex: BRAND.goldDeep, className: "bg-[#b8904a]" },
  { name: "Purple", hex: BRAND.purple, className: "bg-primary-bright" },
  { name: "Purple deep", hex: BRAND.purpleDeep, className: "bg-primary" },
  { name: "Navy", hex: BRAND.navy, className: "bg-background" },
  { name: "Surface", hex: BRAND.surface, className: "bg-surface" },
  { name: "Foreground", hex: BRAND.foreground, className: "bg-foreground" },
];

export default function PressPage() {
  return (
    <LegalPageShell
      eyebrow="Press kit"
      title="PipGlyph brand assets"
      description="Everything you need to write about, link to, or feature PipGlyph — the Astral Rose mark in every variant, palette, type, and usage rules."
    >
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/brand/pipglyph-brand-kit.zip"
          download
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_4px_24px_-8px_var(--color-primary)] transition-colors hover:bg-primary/85"
        >
          <Download className="h-4 w-4" aria-hidden />
          Download brand kit (.zip)
        </a>
        <a
          href="/brand/pipglyph-brand-guidelines.pdf"
          download
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong"
        >
          Brand guidelines (PDF)
        </a>
      </div>

      <h2>About PipGlyph</h2>
      <p>
        PipGlyph is a custom card creator for Magic: The Gathering fans —
        precision mana pips, advanced text tools, and frames from three
        decades of card design, with a public gallery, custom sets, and
        community challenges. Boilerplate: &ldquo;{siteConfig.name} —{" "}
        {siteConfig.tagline}&rdquo;
      </p>

      <h2>The mark: the Astral Rose</h2>
      <p>
        A compass rose become astrolabe. The graduation ticks are the craft
        of measurement; the violet sphere riding the ring is a plane in
        orbit — the walk between worlds; the three-star wake is what every
        journey leaves glowing; the cut gem at the heart is the idea, held
        steady.
      </p>

      <div className="not-prose grid grid-cols-2 gap-4 sm:grid-cols-3">
        <BrandAssetCard
          title="Mark — gradient"
          note="The primary mark on dark surfaces."
          previewSrc="/brand/pipglyph-mark.svg"
          downloads={[
            { label: "SVG", href: "/brand/pipglyph-mark.svg" },
            { label: "PNG 512", href: "/brand/pipglyph-mark-512.png" },
            { label: "PNG 2048", href: "/brand/pipglyph-mark-2048.png" },
          ]}
        />
        <BrandAssetCard
          title="Medallion"
          note="Self-contained coin — avatars and social profiles."
          previewSrc="/brand/pipglyph-mark-medallion.svg"
          downloads={[
            { label: "SVG", href: "/brand/pipglyph-mark-medallion.svg" },
            { label: "PNG 512", href: "/brand/pipglyph-medallion-512.png" },
            { label: "PNG 1024", href: "/brand/pipglyph-medallion-1024.png" },
          ]}
        />
        <BrandAssetCard
          title="Sigil Plaque"
          note="App-icon tile form."
          previewSrc="/brand/pipglyph-mark-plaque.svg"
          downloads={[
            { label: "SVG", href: "/brand/pipglyph-mark-plaque.svg" },
            { label: "PNG 512", href: "/brand/pipglyph-plaque-512.png" },
            { label: "PNG 1024", href: "/brand/pipglyph-plaque-1024.png" },
          ]}
        />
        <BrandAssetCard
          title="Deep Seal"
          note="Carved-relief treatment used in the site header."
          previewSrc="/brand/pipglyph-mark-seal.svg"
          downloads={[{ label: "SVG", href: "/brand/pipglyph-mark-seal.svg" }]}
        />
        <BrandAssetCard
          title="Mono — white"
          note="Single-ink for dark backgrounds."
          previewSrc="/brand/pipglyph-mark-mono-white.svg"
          downloads={[
            { label: "SVG", href: "/brand/pipglyph-mark-mono-white.svg" },
          ]}
        />
        <BrandAssetCard
          title="Mono — black"
          note="Single-ink for light backgrounds."
          previewSrc="/brand/pipglyph-mark-mono-black.svg"
          previewBg="light"
          downloads={[
            { label: "SVG", href: "/brand/pipglyph-mark-mono-black.svg" },
          ]}
        />
        <BrandAssetCard
          title="Lockup — horizontal"
          note="Mark + outlined Cinzel wordmark."
          previewSrc="/brand/pipglyph-logo-horizontal-dark.svg"
          previewSize={44}
          downloads={[
            { label: "SVG dark", href: "/brand/pipglyph-logo-horizontal-dark.svg" },
            { label: "SVG light", href: "/brand/pipglyph-logo-horizontal-light.svg" },
            { label: "PNG 2048", href: "/brand/pipglyph-logo-horizontal-dark-2048.png" },
          ]}
        />
        <BrandAssetCard
          title="Lockup — stacked"
          note="For square placements."
          previewSrc="/brand/pipglyph-logo-stacked-dark.svg"
          downloads={[
            { label: "SVG dark", href: "/brand/pipglyph-logo-stacked-dark.svg" },
            { label: "SVG light", href: "/brand/pipglyph-logo-stacked-light.svg" },
          ]}
        />
        <BrandAssetCard
          title="Social banners"
          note="OG, X header, GitHub, Discord."
          previewSrc="/brand/og-default-1200x630.png"
          previewSize={56}
          downloads={[
            { label: "OG", href: "/brand/og-default-1200x630.png" },
            { label: "X", href: "/brand/x-header-1500x500.png" },
            { label: "GitHub", href: "/brand/github-social-1280x640.png" },
            { label: "Discord", href: "/brand/discord-banner-960x540.png" },
          ]}
        />
      </div>

      <h2>Color</h2>
      <div className="not-prose grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PALETTE.map((c) => (
          <div
            key={c.hex}
            className="overflow-hidden rounded-lg border border-border"
          >
            <div className={`h-14 ${c.className}`} />
            <div className="bg-surface/80 px-3 py-2">
              <div className="text-xs font-semibold text-foreground">
                {c.name}
              </div>
              <div className="font-mono text-[11px] text-muted">{c.hex}</div>
            </div>
          </div>
        ))}
      </div>

      <h2>Typography</h2>
      <p>
        <span className="font-display text-xl text-foreground">
          Cinzel SemiBold
        </span>{" "}
        for display and the wordmark (no true lowercase — lowercase renders
        as small caps; the distributed wordmark is outlined, so no font is
        required). <strong>Geist</strong> for body and UI.
      </p>

      <h2>Usage</h2>
      <ul>
        <li>
          Keep clear space of at least 25% of the mark&apos;s width on all
          sides.
        </li>
        <li>
          Minimum sizes: 16px for the flat mark, 24px for bordered
          treatments; relief effects are for 32px and up.
        </li>
        <li>
          Prefer the medallion or plaque on backgrounds you control&nbsp;—
          they carry their own stage.
        </li>
        <li>
          Don&apos;t recolor, rotate, outline, stretch, or add effects
          beyond the provided treatments.
        </li>
        <li>
          The name is &ldquo;PipGlyph&rdquo; — one word, capital P and
          capital G.
        </li>
      </ul>

      <h2>Legal</h2>
      <p>{siteConfig.disclaimer}</p>
      <p>
        Questions? See <Link href="/about">About</Link> or send a note via{" "}
        <Link href="/feedback">Feedback</Link>.
      </p>
    </LegalPageShell>
  );
}
