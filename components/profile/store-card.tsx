import { ArrowUpRight, Gavel, Globe, Radio, ShoppingBag, Store, Users } from "lucide-react";
import type { ComponentType } from "react";
import { displayLink } from "@/lib/profile/https-link";
import {
  USER_LINK_REL,
  storePlatformOf,
  type ProfileStore,
  type StorePlatformKey,
} from "@/lib/profile/store-platforms";

// ---------------------------------------------------------------------------
// StoreCard — one of a creator's stores on their profile (migration 0153):
// a whole-card link out, the platform's NAME as text beside a neutral icon
// (no platform's logo is drawn — the brand rules and the decision are in
// docs/research/profiles-and-stores-2026-10.md), the maker's title (else the
// platform's one-line blurb), the shop's address and a "Visit store" call
// to action. User-written: rel="nofollow noopener ugc", a new tab, said in
// its name. The rows are re-checked before they get here
// (listProfileStores → drawableProfileStores).
// ---------------------------------------------------------------------------

const PLATFORM_ICONS: Partial<Record<StorePlatformKey, ComponentType<{ className?: string; "aria-hidden"?: boolean }>>> = {
  ebay: Gavel,
  whatnot: Radio,
  etsy: ShoppingBag,
  mercari: ShoppingBag,
  facebook: Users,
  website: Globe,
};

export function StoreCard({ store }: { store: ProfileStore }) {
  const platform = storePlatformOf(store.platform);
  if (!platform) return null;
  const Icon = PLATFORM_ICONS[store.platform] ?? Store;
  const title = store.title ?? platform.blurb;
  return (
    <a
      href={store.url}
      target="_blank"
      rel={USER_LINK_REL}
      className="group relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-frame border border-border bg-surface p-4 shadow-sm sm:gap-4 sm:p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--profile-accent,var(--color-primary))] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* The creator's accent colour, as a rule along the top: the CTA keeps
          the brand primary, whose contrast is known (an accent may be pale). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--profile-accent,var(--color-primary))] opacity-70 transition-opacity group-hover:opacity-100"
      />
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--profile-accent,var(--color-primary))_16%,transparent)] text-[var(--profile-accent,var(--color-primary-bright))]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
            {platform.label}
          </span>
          <span className="truncate font-mono text-xs text-muted">{displayLink(store.url)}</span>
        </span>
      </span>
      <span className="font-display text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere] sm:text-lg">
        {title}
      </span>
      <span className="mt-auto inline-flex h-10 w-fit items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[filter] group-hover:brightness-110">
        Visit store
        <ArrowUpRight className="h-4 w-4" aria-hidden />
        <span className="sr-only"> on {platform.label} (opens in a new tab)</span>
      </span>
    </a>
  );
}
