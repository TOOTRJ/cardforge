import Link from "next/link";
import { Logo } from "./logo";
import { siteConfig } from "@/lib/site-config";
import { isBillingEnabled } from "@/lib/billing/flags";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-gold/20 bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_repeat(3,_1fr)]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="max-w-xs text-sm leading-6 text-muted">
              {siteConfig.tagline}
            </p>
          </div>

          {siteConfig.footerNav.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              {/* h2: the footer's columns are top-level sections of the page
                  outline. They were h4s, which skipped a level after every
                  page's h1 / h2 (axe heading-order on every creator screen,
                  TODO 3b.34); the classes keep the look. */}
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                {column.title}
              </h2>
              <ul className="space-y-2 text-sm">
                {column.links
                  .filter(
                    (link) => isBillingEnabled() || link.href !== "/pricing",
                  )
                  .map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-xs leading-6 text-subtle md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}. All rights reserved. ·{" "}
            <Link href="/disclaimer" className="hover:text-foreground">
              Full disclaimer
            </Link>
          </p>
          <p className="max-w-3xl md:text-right">{siteConfig.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
