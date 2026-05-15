export const siteConfig = {
  name: "Spellwright",
  tagline: "Custom Magic cards, forged by hand.",
  description:
    "Spellwright is the modern platform for designing, sharing, and remixing custom Magic: The Gathering cards. Build a creature, instant, planeswalker, or full expansion set — and share it with your playgroup in seconds.",
  disclaimer:
    "Spellwright is an unofficial fan tool for custom Magic: The Gathering card design and playtesting. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast, Hasbro, or any official trading card game publisher. Magic: The Gathering is a trademark of Wizards of the Coast LLC. Users are responsible for ensuring they have rights to any uploaded artwork.",
  marketingNav: [
    { label: "Gallery", href: "/gallery" },
    { label: "Create", href: "/create" },
  ],
  appNav: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Create", href: "/create" },
    { label: "Gallery", href: "/gallery" },
    { label: "Sets", href: "/sets" },
  ],
  dashboardNav: [
    { label: "Overview", href: "/dashboard" },
    { label: "My Sets", href: "/sets" },
    { label: "Settings", href: "/settings" },
  ],
  footerNav: [
    {
      title: "Product",
      links: [
        { label: "MTG Card Maker", href: "/mtg-card-maker" },
        { label: "Create", href: "/create" },
        { label: "Gallery", href: "/gallery" },
      ],
    },
    {
      title: "Account",
      links: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Settings", href: "/settings" },
        { label: "Sign in", href: "/login" },
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

export type NavItem = (typeof siteConfig.marketingNav)[number];
