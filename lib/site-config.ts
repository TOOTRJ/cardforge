// ---------------------------------------------------------------------------
// Centralized nav + footer config.
//
// The header and its mobile drawer both read `primaryNav` (TODO NV1): two
// groups — Community and Learn — that open as disclosure panels, plus
// Pricing. "Create a card" (`createCta`) and the Account menu
// (`accountNav`) sit beside them. Every entry declares whether it needs a
// session, so a consumer filters by auth state alone; the panels are plain
// data, so marketing pages stay static.
//
// Every link carries a stable `id` — the `item` the nav_click event reports
// (TODO NV10, owner decision D9: Gallery moved under Community and its
// header clicks are watched). Never rename an id: the funnel compares
// clicks across releases by it. A link keeps ONE id on every surface
// (header, drawer, footer); the event's `surface` tells them apart.
// ---------------------------------------------------------------------------

/** A plain label + href — the dashboard rail and the admin lists. */
export type NavItem = {
  label: string;
  href: string;
  /** True if this item is only shown when a user is signed in. */
  authedOnly?: boolean;
};

/** A header, drawer or footer link. */
export type NavLink = {
  /** The nav_click `item` (`community.gallery`). */
  id: string;
  label: string;
  href: string;
  /** The one line under the label in the header panels and the drawer. */
  description?: string;
  /** Only shown to a signed-in visitor. */
  authedOnly?: boolean;
  /** A live pill after the label, filled in by the header (the current
   *  challenge's "Ends in N days"). */
  liveBadge?: "challenge";
};

/** A run of links inside a group. The drawer shows a group's sections as
 *  they are, so each holds six links or fewer (a unit test holds it). */
export type NavSection = {
  id: string;
  /** Shown above the section when its group has more than one. */
  title?: string;
  items: readonly NavLink[];
};

/** A group that opens a panel (desktop) or an accordion (drawer). */
export type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  sections: readonly NavSection[];
};

/** A top-level header entry: a group, or a plain link. */
export type PrimaryNavEntry = NavGroup | ({ kind: "link" } & NavLink);

/** An Account menu link. `when` names the viewer fact it waits for. */
export type AccountNavLink = NavLink & {
  when?: "billing" | "messages";
};

export const siteConfig = {
  name: "PipGlyph",
  tagline: "Precision tools for legendary ideas.",
  description:
    "PipGlyph is the MTG card creator, mana pip editor, and custom card maker for Magic: The Gathering fans. Design cards with precise mana pips, advanced text tools, and beautiful frames — then share them with your playgroup in seconds.",
  disclaimer:
    "PipGlyph is an unofficial fan tool for custom Magic: The Gathering card design and playtesting. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast, Hasbro, or any official trading card game publisher. Magic: The Gathering is a trademark of Wizards of the Coast LLC. Users are responsible for ensuring they have rights to any uploaded artwork.",

  // The header's top level, left to right (TODO NV1). Pricing is hidden for
  // accounts that can't buy a plan (billing off, or already paid — they
  // manage it on /dashboard/billing); the consumer decides that.
  // "MTG lore" joins Learn once there are four lore articles (owner
  // decision D10; there is one today).
  primaryNav: [
    {
      kind: "group",
      id: "community",
      label: "Community",
      sections: [
        {
          id: "community",
          items: [
            {
              id: "community.gallery",
              label: "Card gallery",
              href: "/gallery",
              description: "Community cards, newest and trending",
            },
            {
              id: "community.decks",
              label: "Community decks",
              href: "/decks",
              description: "Decklists built with custom cards",
            },
            {
              id: "community.challenges",
              label: "Design challenges",
              href: "/challenges",
              description: "Design to a theme and enter your card",
              liveBadge: "challenge",
            },
            {
              id: "community.creators",
              label: "Creators",
              href: "/creators",
              description: "Makers with public cards",
            },
            {
              id: "community.roadmap",
              label: "Roadmap",
              href: "/roadmap",
              description: "What we're building now, next and later",
            },
            {
              id: "community.feed",
              label: "Your feed",
              href: "/feed",
              description: "New cards from creators you follow",
              authedOnly: true,
            },
          ],
        },
      ],
    },
    {
      kind: "group",
      id: "learn",
      label: "Learn",
      sections: [
        {
          id: "guides",
          title: "Guides & reference",
          items: [
            {
              id: "learn.design",
              label: "Design guides",
              href: "/learn/design",
              description: "Creatures, walkers, sets, cubes, balance",
            },
            {
              id: "learn.reference",
              label: "Rules & reference",
              href: "/learn/reference",
              description: "Mana symbols, keywords, types, frames",
            },
            {
              id: "learn.comparisons",
              label: "Reviews & comparisons",
              href: "/learn/comparisons",
              description: "PipGlyph next to Card Conjurer and others",
            },
            {
              id: "learn.articles",
              label: "All articles",
              href: "/articles",
              description: "Newest first, filter by topic",
            },
          ],
        },
        {
          id: "using",
          title: "Using PipGlyph",
          items: [
            {
              id: "learn.help",
              label: "Help & FAQ",
              href: "/help",
              description: "The creator, exports, credits, printing",
            },
            {
              id: "learn.whats-new",
              label: "What's new",
              href: "/news",
              description: "Updates and what's coming",
            },
            {
              id: "learn.tools",
              label: "Tools",
              href: "/tools",
              description: "Card maker, AI generator, pip editor & more",
            },
            {
              id: "learn.frames",
              label: "Frames",
              href: "/frames",
              description: "Every frame in the creator, by era",
            },
          ],
        },
      ],
    },
    { kind: "link", id: "pricing", label: "Pricing", href: "/pricing" },
  ] as readonly PrimaryNavEntry[],

  // The one start button (TODO NV1): straight to the creator, which serves
  // guests too — they sign up when they save. It replaced both "Create"
  // and "Start creating".
  createCta: { id: "create", label: "Create a card", href: "/create" } as NavLink,

  // The Account menu (header panel and the drawer's Account part). Signed
  // out it offers the two doors in; signed in, the viewer's own pages in two
  // runs of six or fewer. "Billing & plan" has ONE destination everywhere,
  // /dashboard/billing (the credits chip too). Admins also get every admin
  // page (siteConfig.adminNav) and Sign out closes the menu.
  accountNav: {
    signedOut: [
      {
        id: "account.sign-in",
        label: "Sign in",
        href: "/login",
        description: "Pick up where you left off",
      },
      {
        id: "account.sign-up",
        label: "Create account",
        href: "/signup",
        description: "Free: save cards, build decks, share them",
      },
    ] as readonly AccountNavLink[],
    signedIn: [
      {
        id: "library",
        items: [
          { id: "account.dashboard", label: "Dashboard", href: "/dashboard" },
          { id: "account.my-cards", label: "My cards", href: "/dashboard/cards" },
          { id: "account.my-decks", label: "My decks", href: "/dashboard/decks" },
          { id: "account.new-deck", label: "New deck", href: "/dashboard/decks/new" },
        ],
      },
      {
        id: "account",
        items: [
          // `{username}` is the viewer's handle (Settings while there is none).
          { id: "account.profile", label: "View profile", href: "/profile/{username}" },
          { id: "account.notifications", label: "Notifications", href: "/notifications" },
          { id: "account.messages", label: "Messages", href: "/messages", when: "messages" },
          { id: "account.settings", label: "Settings", href: "/settings" },
          { id: "account.billing", label: "Billing & plan", href: "/dashboard/billing", when: "billing" },
          { id: "feedback", label: "Feedback", href: "/feedback" },
        ],
      },
    ] as ReadonlyArray<{ id: string; items: readonly AccountNavLink[] }>,
  },

  // Dashboard left-rail nav (rendered inside DashboardShell). Feed lives
  // here instead of the global header so the top nav stays lean.
  // Order: the user's own library (cards → decks) first, then Feed.
  // "Messages" (/messages) is NOT listed: DashboardNav inserts it after
  // Notifications only for users who have a support thread.
  dashboardNav: [
    { label: "Overview", href: "/dashboard" },
    { label: "My Cards", href: "/dashboard/cards" },
    { label: "My Decks", href: "/dashboard/decks" },
    { label: "Feed", href: "/feed" },
    { label: "AI Usage", href: "/dashboard/usage" },
    { label: "Billing", href: "/dashboard/billing" },
    { label: "Notifications", href: "/notifications" },
    { label: "Feedback", href: "/feedback" },
    { label: "Settings", href: "/settings" },
  ] as readonly NavItem[],

  // Admin-only rail section (rendered under dashboardNav for is_admin
  // profiles). Mirrors the avatar-dropdown admin entries.
  adminNav: [
    { label: "Users", href: "/admin/users" },
    { label: "Messages", href: "/admin/messages" },
    { label: "Moderation", href: "/admin/moderation" },
    { label: "Feedback", href: "/admin/feedback" },
    { label: "Featured", href: "/admin/featured" },
    { label: "Challenges", href: "/admin/challenges" },
    { label: "Updates", href: "/admin/updates" },
    { label: "Scryfall usage", href: "/admin/scryfall" },
    { label: "Frame compare", href: "/admin/frame-compare" },
    { label: "Frame requests", href: "/admin/frame-requests" },
    { label: "Re-bakes", href: "/admin/renders" },
    { label: "Creator lab", href: "/admin/creator-lab" },
  ] as readonly NavItem[],

  // Four even columns (TODO NV2). The tool landing pages are under Create
  // (the old "Guides" column held them); Learn mirrors the header's Learn
  // panel, so a link moves in both or neither. Pricing is dropped with
  // billing off (site-footer.tsx).
  footerNav: [
    {
      title: "Create",
      links: [
        { id: "create.card-maker", label: "Card maker", href: "/mtg-card-maker" },
        { id: "create.ai-generator", label: "AI card generator", href: "/ai-mtg-card-generator" },
        { id: "create.pip-editor", label: "Mana pip editor", href: "/mana-pip-editor" },
        // Public: the decks landing ("Build a deck" there). Never an auth-only
        // route on every page (/dashboard is disallowed in robots.txt).
        { id: "create.deck-builder", label: "Deck builder", href: "/decks" },
        { id: "create.print-proxies", label: "Print proxies", href: "/articles/how-to-print-proxy-mtg-cards" },
        { id: "pricing", label: "Pricing", href: "/pricing" },
      ],
    },
    {
      title: "Community",
      links: [
        { id: "community.gallery", label: "Card gallery", href: "/gallery" },
        { id: "community.decks", label: "Community decks", href: "/decks" },
        { id: "community.challenges", label: "Design challenges", href: "/challenges" },
        { id: "community.creators", label: "Creators", href: "/creators" },
        { id: "community.roadmap", label: "Roadmap", href: "/roadmap" },
      ],
    },
    {
      title: "Learn",
      links: [
        { id: "learn.design", label: "Design guides", href: "/learn/design" },
        { id: "learn.reference", label: "Rules & reference", href: "/learn/reference" },
        { id: "learn.comparisons", label: "Reviews & comparisons", href: "/learn/comparisons" },
        { id: "learn.articles", label: "All articles", href: "/articles" },
        { id: "learn.help", label: "Help & FAQ", href: "/help" },
        { id: "learn.whats-new", label: "What's new", href: "/news" },
        { id: "learn.tools", label: "Tools", href: "/tools" },
        { id: "learn.frames", label: "Frames", href: "/frames" },
      ],
    },
    {
      title: "Company",
      links: [
        { id: "company.about", label: "About", href: "/about" },
        { id: "company.press", label: "Press kit", href: "/press" },
        { id: "feedback", label: "Feedback", href: "/feedback" },
        { id: "company.disclaimer", label: "Disclaimer", href: "/disclaimer" },
        { id: "company.terms", label: "Terms", href: "/terms" },
        { id: "company.privacy", label: "Privacy", href: "/privacy" },
      ],
    },
  ] as ReadonlyArray<{ title: string; links: readonly NavLink[] }>,
} as const;

/** Every link of a group, in order. */
export function groupLinks(group: NavGroup): NavLink[] {
  return group.sections.flatMap((section) => [...section.items]);
}

/** The Account menu's profile link: the viewer's page, or Settings (where a
 *  handle is set) while there is none. */
export function accountLinkHref(link: NavLink, username: string | null): string {
  if (!link.href.includes("{username}")) return link.href;
  return username ? link.href.replace("{username}", encodeURIComponent(username)) : "/settings";
}
