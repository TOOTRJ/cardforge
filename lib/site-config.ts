// ---------------------------------------------------------------------------
// Centralized nav + footer config.
//
// The header reads `primaryNav` and renders items based on the visitor's
// auth state (no auth-aware filtering needed by the consumer — every entry
// declares whether it requires sign-in). Marketing and app routes share
// the same nav so the menu doesn't shift as the user navigates between
// `/gallery` (public) and `/create` (authed).
// ---------------------------------------------------------------------------

export type NavItem = {
  label: string;
  href: string;
  /** True if this item is only shown when a user is signed in. */
  authedOnly?: boolean;
  /** True if this item is only shown to anonymous visitors. Used for the
   *  Create nav entry, which is hidden once the user has the prominent
   *  "New card" CTA in the right-side toolbar. */
  anonOnly?: boolean;
};

export const siteConfig = {
  name: "PipGlyph",
  tagline: "Precision tools for legendary ideas.",
  description:
    "PipGlyph is the MTG card creator, mana pip editor, and custom card maker for Magic: The Gathering fans. Design cards with precise mana pips, advanced text tools, and beautiful frames — then share full expansion sets with your playgroup in seconds.",
  disclaimer:
    "PipGlyph is an unofficial fan tool for custom Magic: The Gathering card design and playtesting. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast, Hasbro, or any official trading card game publisher. Magic: The Gathering is a trademark of Wizards of the Coast LLC. Users are responsible for ensuring they have rights to any uploaded artwork.",

  // Primary nav rendered in the header. The "Create" link is intentionally
  // omitted for authed users because the right-side "New card" CTA already
  // covers that path; anon visitors still get it so they have a clear
  // entry point into the editor (which redirects them to /signup).
  primaryNav: [
    { label: "Gallery", href: "/gallery" },
    { label: "Sets", href: "/sets" },
    { label: "Challenges", href: "/challenges" },
    { label: "Pricing", href: "/pricing" },
    { label: "Create", href: "/create", anonOnly: true } as NavItem,
    { label: "Feed", href: "/feed", authedOnly: true } as NavItem,
    { label: "Dashboard", href: "/dashboard", authedOnly: true } as NavItem,
    { label: "My Sets", href: "/dashboard/sets", authedOnly: true } as NavItem,
  ] as readonly NavItem[],

  // Dashboard left-rail nav (legacy — used inside DashboardShell).
  dashboardNav: [
    { label: "Overview", href: "/dashboard" },
    { label: "My Sets", href: "/dashboard/sets" },
    { label: "Settings", href: "/settings" },
  ] as readonly NavItem[],

  footerNav: [
    {
      title: "Discover",
      links: [
        { label: "Gallery", href: "/gallery" },
        { label: "Community sets", href: "/sets" },
        { label: "Challenges", href: "/challenges" },
        { label: "Pricing", href: "/pricing" },
      ],
    },
    {
      title: "Guides",
      links: [
        { label: "MTG card maker", href: "/mtg-card-maker" },
        { label: "AI card generator", href: "/ai-mtg-card-generator" },
        { label: "Mana pip editor", href: "/mana-pip-editor" },
        { label: "FAQ", href: "/faq" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Disclaimer", href: "/disclaimer" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms", href: "/terms" },
        { label: "Privacy", href: "/privacy" },
      ],
    },
  ],
} as const;
