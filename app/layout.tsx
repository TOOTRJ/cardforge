import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { UpgradeModalProvider } from "@/components/billing/upgrade-modal-provider";
import { getSiteBaseUrl } from "@/lib/site-url";
import { noFlashScript } from "@/lib/theme-shared";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

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
          "PipGlyph is a free custom Magic: The Gathering card creator and mana pip editor. Design creatures, instants, sorceries, planeswalkers, enchantments, artifacts, and full expansion sets with a live preview editor.",
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
          "Card set builder",
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
            urlTemplate: `${baseUrl}/gallery?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// GA4 loads only where NEXT_PUBLIC_GA_MEASUREMENT_ID is configured (the
// Vercel production env) — local dev, previews, and e2e stay
// analytics-free unless explicitly opted in.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const description =
  "PipGlyph is the MTG card creator and mana pip editor for Magic: The Gathering fans. Design cards with perfect pips, text, and frames — then share full expansion sets with your playgroup in seconds.";

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
    { media: "(prefers-color-scheme: dark)", color: "#0d1320" },
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
          {children}
          {modal}
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
      </body>
    </html>
  );
}
