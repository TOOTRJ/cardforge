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
  "CardForge is a modern platform for designing, sharing, and remixing custom trading cards. Forge a fantasy card in under sixty seconds.";

export const metadata: Metadata = {
  // metadataBase lets relative OG image URLs (e.g. /api/cards/[id]/og)
  // resolve to absolute ones when emitted in <meta og:image>.
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "CardForge — Design custom trading cards",
    template: "%s · CardForge",
  },
  description,
  applicationName: "CardForge",
  keywords: [
    "custom trading cards",
    "card maker",
    "fantasy card creator",
    "homebrew cards",
    "playtest cards",
  ],
  openGraph: {
    title: "CardForge — Design custom trading cards",
    description,
    type: "website",
    siteName: "CardForge",
  },
  twitter: {
    card: "summary_large_image",
    title: "CardForge — Design custom trading cards",
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
