import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  getTheme,
  noFlashScript,
  resolveThemeForServer,
} from "@/lib/theme";
import "./globals.css";

// ---------------------------------------------------------------------------
// JSON-LD structured data — consumed by Google, ChatGPT, Perplexity, and
// other AI search engines to understand what Spellwright is and cite it
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
        name: "Spellwright",
        url: baseUrl,
        description:
          "Spellwright is a free custom Magic: The Gathering card creator. Design creatures, instants, sorceries, planeswalkers, enchantments, artifacts, and full expansion sets with a live preview editor.",
        applicationCategory: "GameApplication",
        operatingSystem: "Web Browser",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "Custom MTG card creator",
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
          "MTG card maker, custom Magic card, MTG card creator, custom planeswalker, homebrew MTG, proxy card maker",
      },
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#org`,
        name: "Spellwright",
        url: baseUrl,
        description:
          "Fan-made custom MTG card design tool. Not affiliated with Wizards of the Coast.",
        sameAs: [],
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        url: baseUrl,
        name: "Spellwright",
        description:
          "The modern custom MTG card creator for Magic: The Gathering fans.",
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

const description =
  "Spellwright is the custom MTG card creator for Magic: The Gathering fans. Design creatures, instants, planeswalkers, and full expansion sets — then share with your playgroup in seconds.";

export const metadata: Metadata = {
  // metadataBase lets relative OG image URLs (e.g. /api/cards/[id]/og)
  // resolve to absolute ones when emitted in <meta og:image>.
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "Spellwright — Custom MTG Card Creator",
    template: "%s · Spellwright",
  },
  description,
  applicationName: "Spellwright",
  keywords: [
    "MTG card maker",
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
    title: "Spellwright — Custom MTG Card Creator",
    description,
    type: "website",
    siteName: "Spellwright",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spellwright — Custom MTG Card Creator",
    description,
  },
};

// Tells the browser which UI affordances (scrollbars, form controls) to
// theme. We declare both schemes so the browser picks based on the
// resolved data-theme attribute that the no-flash script sets pre-paint.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#13131c" },
  ],
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-resolved theme: the cookie wins. When the cookie says
  // "system" (or is missing), we render `dark` and let the inline
  // no-flash script swap to `light` based on prefers-color-scheme
  // before the stylesheet evaluates. That avoids a hydration mismatch
  // (React doesn't manage `data-theme` so it doesn't complain about a
  // post-hydration attribute change either).
  const theme = await getTheme();
  const initialDataTheme = resolveThemeForServer(theme);

  return (
    <html
      lang="en"
      data-theme={initialDataTheme}
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
        {children}
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
      </body>
    </html>
  );
}
