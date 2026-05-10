import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
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

export const metadata: Metadata = {
  title: {
    default: "CardForge — Design custom trading cards",
    template: "%s · CardForge",
  },
  description:
    "CardForge is a modern platform for designing, sharing, and remixing custom trading cards. Forge a fantasy card in under sixty seconds.",
  applicationName: "CardForge",
  keywords: [
    "custom trading cards",
    "card maker",
    "fantasy card creator",
    "homebrew cards",
    "playtest cards",
  ],
};

export const viewport: Viewport = {
  themeColor: "#13131c",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <Toaster
          theme="dark"
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
