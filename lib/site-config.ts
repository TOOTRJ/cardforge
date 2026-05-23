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
  name: "Spellwright",
  tagline: "Custom Magic cards, forged by hand.",
  description:
    "Spellwright is the modern platform for designing, sharing, and remixing custom Magic: The Gathering cards. Build a creature, instant, planeswalker, or full expansion set — and share it with your playgroup in seconds.",
  disclaimer:
    "Spellwright is an unofficial fan tool for custom Magic: The Gathering card design and playtesting. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast, Hasbro, or any official trading card game publisher. Magic: The Gathering is a trademark of Wizards of the Coast LLC. Users are responsible for ensuring they have rights to any uploaded artwork.",

  // Primary nav rendered in the header. The "Create" link is intentionally
  // omitted for authed users because the right-side "New card" CTA already
  // covers that path; anon visitors still get it so they have a clear
  // entry point into the editor (which redirects them to /signup).
  primaryNav: [
    { label: "Gallery", href: "/gallery" },
    { label: "Sets", href: "/sets" },
    { label: "Create", href: "/create", anonOnly: true } as NavItem,
    { label: "Dashboard", href: "/dashboard", authedOnly: true } as NavItem,
    { label: "My Sets", href: "/dashboard/sets", authedOnly: true } as NavItem,
  ] as readonly NavItem[],

  // Items in the avatar dropdown menu. Sign-out is rendered separately by
  // the menu component (it's a server action, not a link).
  accountMenu: [
    { label: "View profile", href: "/profile" }, // resolved to /profile/{username} in the menu
    { label: "Dashboard", href: "/dashboard" },
    { label: "My sets", href: "/dashboard/sets" },
    { label: "Settings", href: "/settings" },
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
