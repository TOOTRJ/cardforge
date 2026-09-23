import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { UpgradeModalProvider } from "@/components/billing/upgrade-modal-provider";
import { GenerationJobProvider } from "@/components/ai/generation-provider";
import { CreditConfirmProvider } from "@/components/billing/credit-confirm-provider";
import { DeckExportProvider } from "@/components/decks/deck-export-provider";
import { ShareParamCleanup } from "@/components/seo/share-param-cleanup";
import { serializeJsonLd } from "@/components/seo/json-ld";
import { getSiteBaseUrl } from "@/lib/site-url";
import { noFlashScript } from "@/lib/theme-shared";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { AckSplash } from "@/components/updates/ack-splash";
import { UpdatePrompt } from "@/components/updates/update-prompt";
import "./globals.css";
import { BRAND } from "@/lib/brand/constants";

// ---------------------------------------------------------------------------
// JSON-LD structured data — consumed by Google, ChatGPT, Perplexity, and
// other AI search engines to understand what PipGlyph is and cite it
// accurately when users ask about custom MTG card tools.
// ---------------------------------------------------------------------------
function JsonLd() {
  const baseUrl = getSiteBaseUrl();
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${baseUrl}/#webapp`,
        name: "PipGlyph",
        url: baseUrl,
        description:
          "PipGlyph is a free custom Magic: The Gathering card creator and mana pip editor. Design creatures, instants, sorceries, planeswalkers, enchantments, artifacts, and whole decks with a live preview editor.",
        applicationCategory: "GameApplication",
        operatingSystem: "Web Browser",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "Custom MTG card creator",
          "Mana pip editor",
          "Mana cost builder",
          "Oracle text editor",
          "WUBRG color identity",
          "Planeswalker loyalty abilities",
          "Deck builder with AI generation",
          "AI rules text assistant",
          "PNG export",
          "Community gallery",
          "Card remix and fork",
        ],
        keywords:
          "MTG card maker, custom Magic card, MTG card creator, mana pip editor, custom planeswalker, homebrew MTG, proxy card maker",
      },
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#org`,
        name: "PipGlyph",
        url: baseUrl,
        description:
          "Fan-made custom MTG card design tool. Not affiliated with Wizards of the Coast.",
        sameAs: [],
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        url: baseUrl,
        name: "PipGlyph",
        description:
          "The MTG card creator, mana pip editor, and custom card maker for Magic: The Gathering fans.",
        publisher: { "@id": `${baseUrl}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${baseUrl}/gallery/browse?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
    />
  );
}

// Self-hosted fonts — never `next/font/google`. That loader fetches from
// fonts.googleapis.com during the BUILD, and on 2026-09-22 the production
// deploy of a green merge failed inside it ("next/font/google queries have
// exactly one entry" / can't resolve …/internal/font/google/font) while the
// same tree had built fine minutes earlier. A deploy must not depend on a
// third-party fetch. Geist comes from Vercel's own `geist` package
// (next/font/local under the hood, same --font-geist-* variables); Cinzel is
// the OFL variable font from github.com/google/fonts, committed under
// app/fonts/cinzel with its licence. tests/unit/content/fonts-self-hosted
// guards the import. Every other font (card renders, OG images) is already
// a committed .ttf under public/.
const geistSans = GeistSans; // --font-geist-sans, weight 100–900
const geistMono = GeistMono; // --font-geist-mono
const cinzel = localFont({
  src: "./fonts/cinzel/Cinzel-Variable.woff2",
  variable: "--font-cinzel",
  // One variable file covers the 500/600/700 the UI uses (and every other
  // weight), latin + latin-ext included — no per-subset files to juggle.
  weight: "400 900",
  display: "swap",
});

// GA4 loads only where NEXT_PUBLIC_GA_MEASUREMENT_ID is configured (the
// Vercel production env) — local dev, previews, and e2e stay
// analytics-free unless explicitly opted in.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const description =
  "PipGlyph is the MTG card creator and mana pip editor for Magic: The Gathering fans. Design cards with perfect pips, text, and frames — then share cards and whole decks with your playgroup in seconds.";

export const metadata: Metadata = {
  // metadataBase lets relative OG image URLs (e.g. /api/cards/[id]/og)
  // resolve to absolute ones when emitted in <meta og:image>.
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "PipGlyph — MTG Card Creator & Mana Pip Editor",
    template: "%s · PipGlyph",
  },
  description,
  applicationName: "PipGlyph",
  keywords: [
    "MTG card maker",
    "mana pip editor",
    "custom MTG cards",
    "Magic the Gathering card creator",
    "custom magic card maker",
    "MTG card designer",
    "homebrew MTG cards",
    "custom planeswalker card",
    "MTG proxy maker",
    "magic card generator",
    "custom creature card",
    "MTG card creator",
    "playtest magic cards",
    "fan made magic cards",
    "MTG homebrew",
  ],
  openGraph: {
    title: "PipGlyph — MTG Card Creator & Mana Pip Editor",
    description,
    type: "website",
    siteName: "PipGlyph",
  },
  twitter: {
    card: "summary_large_image",
    title: "PipGlyph — MTG Card Creator & Mana Pip Editor",
    description,
  },
};

// Tells the browser which UI affordances (scrollbars, form controls) to
// theme. We declare both schemes so the browser picks based on the
// resolved data-theme attribute that the no-flash script sets pre-paint.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: BRAND.navy },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // Parallel slot (app/@modal) for the intercepted card-detail dialog.
  // Renders null via @modal/default.tsx except when a card tile click
  // soft-navigates to /card/[username]/[slug].
  modal: React.ReactNode;
}>) {
  // The root layout reads NO cookies — that keeps every route eligible
  // for static rendering / CDN caching. data-theme is always "dark"
  // (the brand default) in server HTML; the inline no-flash script in
  // <head> reads the theme cookie + prefers-color-scheme and corrects
  // the attribute before the stylesheet evaluates, so light-theme users
  // never see a dark flash. React doesn't manage `data-theme`, and
  // suppressHydrationWarning covers the attribute swap.
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} h-full antialiased`}
      // Suppress the hydration warning for `data-theme` — the no-flash
      // script may legitimately change it between server render and
      // hydration when the user prefers light + cookie is "system".
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme script. Runs before any stylesheet evaluates
            so the right OKLCH palette applies on first paint. Inlined
            (not a `next/script` import) because timing is critical. */}
        <script
          dangerouslySetInnerHTML={{ __html: noFlashScript() }}
        />
      </head>
      <body className="min-h-full">
        <JsonLd />
        {/* Keyboard a11y: skip past the SiteHeader straight into the page
            content. Invisible until focused. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus-visible:outline-none"
        >
          Skip to main content
        </a>
        <UpgradeModalProvider>
          {/* AI batch-generation runner lives at the ROOT so client-side
              navigation never interrupts a job; it also auto-resumes any
              job a closed tab left behind. */}
          {/* Every credit spend asks first (cost + balance after) — above
              the runner so retries confirm too. */}
          <CreditConfirmProvider>
            <GenerationJobProvider>
              {/* Whole-deck exports (Pro) build in the background the same
                  way, with their own progress card. */}
              <DeckExportProvider>
                {children}
                {modal}
                {/* "A new version is ready" pill — checks /api/version on
                    focus and reloads at the next safe moment. Sits inside the
                    runners so it never reloads over an in-flight job/export. */}
                <UpdatePrompt />
              </DeckExportProvider>
            </GenerationJobProvider>
          </CreditConfirmProvider>
        </UpgradeModalProvider>
        <Toaster
          // Sonner's `theme="system"` follows prefers-color-scheme, which
          // matches what our `data-theme` attribute already reflects
          // post-hydration. The CSS-variable toastOptions ensure the
          // toasts pick up the correct OKLCH palette either way.
          theme="system"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            },
          }}
        />
        {/* GA4 — page views track automatically on App Router navigations
            (@next/third-parties). Gated on the env var so only deploys
            that configure it load analytics. */}
        {GA_MEASUREMENT_ID ? <GoogleAnalytics gaId={GA_MEASUREMENT_ID} /> : null}
        {/* Strips ?via= share-attribution params after the GA pageview
            captures them, so re-copied URLs stay clean. */}
        <ShareParamCleanup />
        {/* Vercel Speed Insights — tracks Core Web Vitals and page
            performance metrics for real user monitoring. */}
        <SpeedInsights />
        {/* Vercel Web Analytics — tracks page views and user
            interactions for analytics and insights. */}
        <Analytics />
        {/* Must-read site updates for signed-in users (see /admin/updates). */}
        <AckSplash />
      </body>
    </html>
  );
}
