import { describe, expect, it } from "vitest";
import { accountLinkHref, groupLinks, siteConfig, type NavGroup, type NavLink } from "@/lib/site-config";
import { sanitizeFunnelProps } from "@/lib/analytics/funnel-events";

// ---------------------------------------------------------------------------
// The grouped header and the footer (TODO NV1 / NV2 / NV10), held to the plan
// the owner approved on 2026-10-28: Community · Learn · Pricing, then
// "Create a card" and Account; groups of six links or fewer (the drawer shows
// them as they are); one billing destination; four footer columns; every
// link with an id the nav_click event can carry.
// ---------------------------------------------------------------------------

const groups = siteConfig.primaryNav.filter((entry): entry is NavGroup => entry.kind === "group");
const accountLinks = [
  ...siteConfig.accountNav.signedOut,
  ...siteConfig.accountNav.signedIn.flatMap((section) => [...section.items]),
];
const everyLink: NavLink[] = [
  ...siteConfig.primaryNav.flatMap((entry) => (entry.kind === "group" ? groupLinks(entry) : [entry])),
  siteConfig.createCta,
  ...accountLinks,
  ...siteConfig.footerNav.flatMap((column) => [...column.links]),
];

describe("the header's top level", () => {
  it("is Community ▾ · Learn ▾ · Pricing, and Create a card goes straight to /create", () => {
    expect(siteConfig.primaryNav.map((entry) => `${entry.kind}:${entry.label}`)).toEqual([
      "group:Community",
      "group:Learn",
      "link:Pricing",
    ]);
    expect(siteConfig.createCta).toMatchObject({ label: "Create a card", href: "/create" });
  });

  it("Community holds the gallery, decks, challenges, creators and — signed in only — the feed", () => {
    const community = groups.find((group) => group.id === "community")!;
    expect(groupLinks(community).map((link) => [link.label, link.href, Boolean(link.authedOnly)])).toEqual([
      ["Card gallery", "/gallery", false],
      ["Community decks", "/decks", false],
      ["Design challenges", "/challenges", false],
      ["Creators", "/creators", false],
      ["Your feed", "/feed", true],
    ]);
    expect(groupLinks(community).find((link) => link.href === "/challenges")?.liveBadge).toBe("challenge");
  });

  it("Learn links the learn hub's pages, the articles, help, what's new and tools — no lore yet (D10)", () => {
    const learn = groups.find((group) => group.id === "learn")!;
    expect(groupLinks(learn).map((link) => link.href)).toEqual([
      "/learn/design",
      "/learn/reference",
      "/learn/comparisons",
      "/articles",
      "/help",
      "/news",
      "/tools",
    ]);
    expect(groupLinks(learn).some((link) => /lore/i.test(link.label) || link.href.includes("lore"))).toBe(false);
  });

  it("every panel link has its one-line description", () => {
    for (const group of groups) {
      for (const link of groupLinks(group)) {
        expect(link.description, link.id).toBeTruthy();
        expect(link.description!.length, link.id).toBeLessThanOrEqual(48);
      }
    }
  });

  it("every group's sections — the drawer's lists — hold six links or fewer", () => {
    for (const group of groups) {
      for (const section of group.sections) expect(section.items.length, `${group.id}/${section.id}`).toBeLessThanOrEqual(6);
    }
    for (const section of siteConfig.accountNav.signedIn) {
      expect(section.items.length, `account/${section.id}`).toBeLessThanOrEqual(6);
    }
  });

  it("says What's new, never News, and has no Guides entry", () => {
    for (const link of everyLink) {
      expect(link.label).not.toBe("News");
      expect(link.label).not.toBe("Guides");
    }
    expect(siteConfig.footerNav.map((column) => column.title)).not.toContain("Guides");
  });
});

describe("the Account menu", () => {
  it("signed out: Sign in and Create account", () => {
    expect(siteConfig.accountNav.signedOut.map((link) => [link.label, link.href])).toEqual([
      ["Sign in", "/login"],
      ["Create account", "/signup"],
    ]);
  });

  it("signed in: the viewer's pages, with My decks, New deck and ONE billing destination", () => {
    expect(siteConfig.accountNav.signedIn.flatMap((section) => section.items.map((link) => link.label))).toEqual([
      "Dashboard",
      "My cards",
      "My decks",
      "New deck",
      "View profile",
      "Notifications",
      "Messages",
      "Settings",
      "Billing & plan",
      "Feedback",
    ]);
    const billing = accountLinks.filter((link) => /billing/i.test(link.label));
    expect(billing.map((link) => link.href)).toEqual(["/dashboard/billing"]);
    expect(everyLink.some((link) => link.href.includes("#billing"))).toBe(false);
    expect(accountLinks.find((link) => link.label === "New deck")?.href).toBe("/dashboard/decks/new");
  });

  it("the profile link is the viewer's page, or Settings while there is no handle", () => {
    const profile = accountLinks.find((link) => link.id === "account.profile")!;
    expect(accountLinkHref(profile, "dev_free")).toBe("/profile/dev_free");
    expect(accountLinkHref(profile, null)).toBe("/settings");
  });
});

describe("the footer (NV2)", () => {
  it("is four columns — Create · Community · Learn · Company", () => {
    expect(siteConfig.footerNav.map((column) => column.title)).toEqual(["Create", "Community", "Learn", "Company"]);
  });

  it("Create holds the tool pages; Company the about, press, feedback and legal pages", () => {
    const hrefs = (title: string) => siteConfig.footerNav.find((column) => column.title === title)!.links.map((link) => link.href);
    expect(hrefs("Create")).toEqual(
      expect.arrayContaining(["/mtg-card-maker", "/ai-mtg-card-generator", "/mana-pip-editor", "/decks"]),
    );
    expect(hrefs("Company")).toEqual(["/about", "/press", "/feedback", "/disclaimer", "/terms", "/privacy"]);
  });

  it("Learn mirrors the header's Learn panel", () => {
    const learn = groups.find((group) => group.id === "learn")!;
    const footer = siteConfig.footerNav.find((column) => column.title === "Learn")!;
    expect(footer.links.map((link) => [link.id, link.href])).toEqual(groupLinks(learn).map((link) => [link.id, link.href]));
  });

  it("links only public pages — the footer is on every page, crawled (no /dashboard, robots.txt disallows it)", () => {
    for (const link of siteConfig.footerNav.flatMap((column) => [...column.links])) {
      expect(link.href, link.label).not.toMatch(/^\/(dashboard|settings|admin|notifications|messages|feed)(\/|$)/);
    }
  });
});

describe("nav_click ids (NV10)", () => {
  it("every link's id survives the funnel's prop filter", () => {
    for (const link of everyLink) {
      expect(sanitizeFunnelProps({ item: link.id }), link.id).toEqual({ item: link.id });
    }
  });

  it("one link, one id on every surface; an id names one destination", () => {
    // The same link (destination + words) keeps its id in the header, the
    // drawer and the footer, so a surface can be compared with another; two
    // different links to one page ("Deck builder", "Community decks") keep
    // their own ids.
    const idOf = new Map<string, string>();
    const hrefOf = new Map<string, string>();
    for (const link of everyLink) {
      const key = `${link.href} ${link.label}`;
      expect(idOf.get(key) ?? link.id, key).toBe(link.id);
      expect(hrefOf.get(link.id) ?? link.href, link.id).toBe(link.href);
      idOf.set(key, link.id);
      hrefOf.set(link.id, link.href);
    }
  });
});
