export const siteConfig = {
  name: "CardForge",
  tagline: "Design custom trading cards in seconds.",
  description:
    "A modern platform for creating, sharing, and remixing custom trading cards. CardForge launches with a polished fantasy-card creator and is built to grow into any card game.",
  disclaimer:
    "CardForge is an unofficial custom card design and playtesting tool. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or any official trading card game publisher. Users are responsible for ensuring they have rights to any uploaded artwork.",
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
