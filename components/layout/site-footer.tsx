import Link from "next/link";
import { Logo } from "./logo";
import { FooterNavLink } from "./footer-nav-link";
import { WIDE_FRAME_CLASS } from "./wide-frame";
import { siteConfig } from "@/lib/site-config";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cn } from "@/lib/utils";

// The site footer (TODO NV2): the brand, then four EVEN columns — Create ·
// Community · Learn · Company — from siteConfig.footerNav. The grid has one
// track per column (the old one had four tracks for five, and "Legal"
// wrapped onto a row of its own). The wide frame, like the header (TODO
// WD2). Static: no cookie read; the links' nav_click is a client island.
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-gold/20 bg-background">
      <div className={cn(WIDE_FRAME_CLASS, "py-14")}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,4fr)] lg:gap-12">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="max-w-xs text-sm leading-6 text-muted">{siteConfig.tagline}</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
            {siteConfig.footerNav.map((column) => (
              <div key={column.title} className="flex min-w-0 flex-col gap-3">
                {/* h2: the footer's columns are top-level sections of the page
                    outline. They were h4s, which skipped a level after every
                    page's h1 / h2 (axe heading-order on every creator screen,
                    TODO 3b.34); the classes keep the look. */}
                <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  {column.title}
                </h2>
                <ul className="space-y-2 text-sm">
                  {column.links
                    .filter((link) => isBillingEnabled() || link.href !== "/pricing")
                    .map((link) => (
                      <li key={link.href}>
                        <FooterNavLink
                          id={link.id}
                          href={link.href}
                          className="text-muted transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </FooterNavLink>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>
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
