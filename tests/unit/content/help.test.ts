import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_SECTION_ICONS } from "@/components/content/help-icons";
import { DECK_AI_PAUSED, DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";
import { CARD_CAPACITY, CARD_CAPACITY_UNLIMITED, SIGNUP_BANK_DAYS } from "@/lib/billing/plans";
import { REFERRAL_CLAIM_WINDOW_DAYS } from "@/lib/referrals/rules";
import { DEFAULT_REFERRAL_SETTINGS, rewardStepPhrase } from "@/lib/referrals/settings";
import { REFERRAL_CODE_KEEP_DAYS } from "@/lib/analytics/attribution";
import { siteConfig } from "@/lib/site-config";
import {
  AI_GENERATOR_FAQ,
  allFaqEntries,
  CARD_MAKER_FAQ,
  COMPARISON_FAQ,
  FAQ_TOPICS,
  MANA_PIP_FAQ,
  REFERRALS_FAQ,
} from "@/lib/content/faq";
import {
  faqEntryById,
  faqMarkupHomeOf,
  getHelpSection,
  HELP_SECTIONS,
  helpEntryHref,
  helpForwardTarget,
  helpForwardTargets,
  helpSearchItems,
  helpSectionAnchors,
  helpSectionEntries,
  helpSectionMarkupEntries,
  helpSectionOf,
  helpSectionPath,
  LANDING_PAGE_LABELS,
  landingPageOf,
  LEGACY_FAQ_ANCHORS,
} from "@/lib/content/help";

// ---------------------------------------------------------------------------
// The help centre's map (TODO NV6, lib/content/help.ts): every FAQ answer
// in exactly one section, every anchor unique and stable, ONE FAQPage home
// per answer across the whole site, and the old /faq#<topic> anchors still
// landing on the section that holds their answers.
// ---------------------------------------------------------------------------

const ANCHOR = /^[a-z][a-z0-9-]*$/;

/** The nine topics /faq carried — their anchors are inbound links now. */
const LEGACY_TOPICS = [
  "card-maker",
  "mana-pips",
  "ai-generation",
  "choosing",
  "sharing",
  "exports",
  "import-remix",
  "challenges",
  "accounts",
];

/** The landing pages' own FAQPage blocks: each renders one array, whole. */
const LANDING_FAQ: Record<string, readonly { id: string }[]> = {
  "/mtg-card-maker": CARD_MAKER_FAQ,
  "/mana-pip-editor": MANA_PIP_FAQ,
  "/ai-mtg-card-generator": AI_GENERATOR_FAQ,
  "/best-mtg-card-makers": COMPARISON_FAQ,
};

describe("the section map", () => {
  it("puts every FAQ answer in exactly one group of one section", () => {
    const placed = HELP_SECTIONS.flatMap((section) =>
      section.groups.flatMap((group) => group.entryIds),
    );
    const ids = allFaqEntries().map((entry) => entry.id);
    expect([...placed].sort()).toEqual([...ids].sort());
    expect(new Set(placed).size, "an answer listed twice").toBe(placed.length);
  });

  it("names only answers that exist", () => {
    for (const section of HELP_SECTIONS) {
      for (const group of section.groups) {
        for (const id of group.entryIds) expect(faqEntryById(id), `${group.id} → ${id}`).toBeDefined();
      }
    }
  });

  it("gives every answer a unique, URL-safe id", () => {
    const ids = allFaqEntries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(ANCHOR);
    // …and every question is distinct too (an id per question, never two).
    const questions = allFaqEntries().map((entry) => entry.q);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("keeps every anchor of the help centre unique: answers, how-tos, groups and sections", () => {
    const anchors = HELP_SECTIONS.flatMap((section) => [section.slug, ...helpSectionAnchors(section)]);
    expect(new Set(anchors).size, "an anchor used twice").toBe(anchors.length);
    for (const anchor of anchors) expect(anchor, anchor).toMatch(ANCHOR);
  });

  it("has the eight sections, each with answers and a description fit for a meta tag", () => {
    expect(HELP_SECTIONS.map((section) => section.slug)).toEqual([
      "getting-started",
      "card-creator",
      "importing",
      "decks",
      "printing",
      "ai-and-credits",
      "sharing-and-community",
      "account-and-privacy",
    ]);
    for (const section of HELP_SECTIONS) {
      expect(HELP_SECTION_ICONS[section.slug], `${section.slug} has an icon`).toBeDefined();
      expect(helpSectionEntries(section).length, section.slug).toBeGreaterThan(0);
      expect(section.description.length, section.slug).toBeGreaterThanOrEqual(70);
      expect(section.description.length, section.slug).toBeLessThanOrEqual(160);
      for (const group of section.groups) expect(group.entryIds.length, group.id).toBeGreaterThan(0);
    }
  });

  it("gives each how-to a handful of titled steps and a public call to action", () => {
    const howTos = HELP_SECTIONS.flatMap((section) => (section.howTo ? [section.howTo] : []));
    expect(howTos.length).toBeGreaterThanOrEqual(4);
    expect(howTos.length).toBeLessThanOrEqual(6);
    for (const howTo of howTos) {
      expect(howTo.steps.length, howTo.id).toBeGreaterThanOrEqual(3);
      expect(howTo.steps.length, howTo.id).toBeLessThanOrEqual(7);
      for (const step of howTo.steps) {
        expect(step.title.trim(), howTo.id).not.toBe("");
        expect(step.body.trim(), howTo.id).not.toBe("");
      }
      // A section page is indexed: its button never sends a visitor to an
      // account page that bounces them to /login.
      expect(howTo.cta.href, howTo.id).not.toMatch(/^\/(dashboard|settings|admin|feedback)/);
    }
  });
});

describe("one FAQPage home per answer", () => {
  it("is the landing page for a landing topic's answer, else its help section", () => {
    for (const topic of FAQ_TOPICS) {
      for (const entry of topic.entries) {
        const home = faqMarkupHomeOf(entry.id);
        if (topic.guideHref) expect(home, entry.id).toBe(topic.guideHref);
        else expect(home, entry.id).toMatch(/^\/help\/[a-z-]+$/);
      }
    }
  });

  it("never marks up the same answer on two pages — and marks up every answer once", () => {
    const marked = [
      ...Object.values(LANDING_FAQ).flatMap((entries) => entries.map((entry) => entry.id)),
      ...HELP_SECTIONS.flatMap((section) => helpSectionMarkupEntries(section).map((entry) => entry.id)),
    ];
    expect(new Set(marked).size, "an answer marked up twice").toBe(marked.length);
    expect([...marked].sort()).toEqual(allFaqEntries().map((entry) => entry.id).sort());
  });

  it("the landing topics are exactly the four landing pages' arrays", () => {
    for (const [href, entries] of Object.entries(LANDING_FAQ)) {
      const topic = FAQ_TOPICS.find((t) => t.guideHref === href);
      expect(topic?.entries, href).toBe(entries);
      expect(LANDING_PAGE_LABELS[href], href).toBeTruthy();
    }
    expect(FAQ_TOPICS.filter((t) => t.guideHref).length).toBe(Object.keys(LANDING_FAQ).length);
  });

  it("leaves every section page at least one answer of its own to mark up", () => {
    for (const section of HELP_SECTIONS) {
      expect(helpSectionMarkupEntries(section).length, section.slug).toBeGreaterThan(0);
    }
  });

  it("links a landing page's answer back to its page", () => {
    expect(landingPageOf("what-is-a-mana-pip-editor")).toEqual({
      href: "/mana-pip-editor",
      label: "Mana pip editor",
    });
    expect(landingPageOf("what-is-a-bleed")).toBeNull();
  });
});

describe("anchors and forwarding", () => {
  it("addresses an answer on its section page", () => {
    expect(helpEntryHref("decklist-formats")).toBe("/help/decks#decklist-formats");
    expect(helpEntryHref("what-is-a-bleed")).toBe("/help/printing#what-is-a-bleed");
    expect(helpEntryHref("no-such-answer")).toBeNull();
  });

  it("forwards every old /faq topic anchor to a section that holds that topic's answers", () => {
    expect(Object.keys(LEGACY_FAQ_ANCHORS).sort()).toEqual([...LEGACY_TOPICS].sort());
    for (const slug of LEGACY_TOPICS) {
      const target = helpForwardTarget(`#${slug}`);
      expect(target, slug).toBeTruthy();
      const [path, anchor] = target!.split("#");
      const section = HELP_SECTIONS.find((s) => helpSectionPath(s.slug) === path);
      expect(section, `${slug} → ${target}`).toBeDefined();
      if (anchor) expect(helpSectionAnchors(section!), `${slug} → ${target}`).toContain(anchor);
      const topic = FAQ_TOPICS.find((t) => t.slug === slug)!;
      const shown = helpSectionEntries(section!).map((entry) => entry.id);
      expect(
        topic.entries.some((entry) => shown.includes(entry.id)),
        `${slug} lands on a section without any of its answers`,
      ).toBe(true);
    }
    expect(helpForwardTarget("#exports")).toBe("/help/printing");
    expect(helpForwardTarget("#mana-pips")).toBe("/help/card-creator#mana-symbols");
  });

  it("forwards a short /help#<answer> to the answer, and a section slug to its page", () => {
    expect(helpForwardTarget("#what-is-a-bleed")).toBe("/help/printing#what-is-a-bleed");
    expect(helpForwardTarget("make-your-first-card")).toBe("/help/getting-started#make-your-first-card");
    expect(helpForwardTarget("#decks")).toBe("/help/decks");
    expect(helpForwardTarget("#nope")).toBeNull();
    expect(helpForwardTarget("")).toBeNull();
    expect(helpForwardTarget("#__proto__")).toBeNull();
  });

  it("never sends an old anchor somewhere a section anchor of the same name doesn't go", () => {
    const targets = helpForwardTargets();
    for (const section of HELP_SECTIONS) {
      for (const anchor of helpSectionAnchors(section)) {
        expect(targets[anchor], anchor).toBe(`${helpSectionPath(section.slug)}#${anchor}`);
      }
    }
  });
});

describe("the hub's search items", () => {
  it("cover every answer and how-to once, each linking to its anchor", () => {
    const items = helpSearchItems();
    const answers = items.filter((item) => item.kind === "answer");
    expect(answers.map((item) => item.id).sort()).toEqual(allFaqEntries().map((e) => e.id).sort());
    for (const item of answers) expect(item.href).toBe(helpEntryHref(item.id));
    const howTos = items.filter((item) => item.kind === "how-to");
    expect(howTos.length).toBe(HELP_SECTIONS.filter((s) => s.howTo).length);
    for (const item of howTos) expect(helpForwardTarget(item.id)).toBe(item.href);
  });
});

describe("answers that follow the product", () => {
  it("say AI deck building is paused only while it is (lib/ai/deck-ai-pause.ts)", () => {
    // Lifting the pause must rewrite the deck answer, the decks how-to's tip
    // and the AI how-to's tip — this fails until they are.
    expect(DECK_AI_PAUSED).toBe(true);
    expect(faqEntryById("ai-deck-building")?.a).toContain(DECK_AI_PAUSED_MESSAGE);
    expect(getHelpSection("decks")?.howTo?.tip).toContain(DECK_AI_PAUSED_MESSAGE);
    expect(getHelpSection("ai-and-credits")?.howTo?.tip).toContain(DECK_AI_PAUSED_MESSAGE);
  });

  it("speak the deck vocabulary (TODO DK2.2): Customize, Imported, Edited — never the retired proxy words", () => {
    const text = [
      ...allFaqEntries().flatMap((entry) => [entry.q, entry.a]),
      ...HELP_SECTIONS.flatMap((section) => [
        section.intro,
        ...(section.howTo
          ? [section.howTo.summary, section.howTo.tip ?? "", ...section.howTo.steps.map((step) => step.body)]
          : []),
      ]),
    ].join("\n");
    expect(text).not.toMatch(/custom proxy|needs proxy|unlink proxy|remix with ai|my proxies/i);
    const decks = getHelpSection("decks")!.howTo!.steps.map((step) => step.body).join("\n");
    expect(decks).toMatch(/choose Customize/);
    expect(faqEntryById("what-goes-in-a-deck")?.a).toMatch(/Imported.*Customize.*Edited/);
  });

  it("say what a signed-out visitor gets: the creator, read-only — designing needs an account", () => {
    expect(faqEntryById("do-i-need-an-account")?.a).toMatch(/read-only; designing, saving and publishing/);
    expect(getHelpSection("getting-started")!.howTo!.steps[0].body).toMatch(/signed out, the creator is read-only/);
  });

  it("say decks are unlimited on every plan — no plan names a deck number (owner 2026-10-29, 0147)", () => {
    // 0145 shipped a private-deck cap; the owner dropped it ("that is what
    // other sites do — paid conversion happens with card limits"). The answer
    // keeps its id (links point at it) and names the CARD caps instead.
    const answer = faqEntryById("how-many-decks")!.a;
    expect(answer).toMatch(/^As many as you like, on every plan — public, unlisted or private\./);
    expect(answer).toContain(`saved cards do (Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited)`);
    expect(CARD_CAPACITY.pro).toBe(CARD_CAPACITY_UNLIMITED);
    expect(helpSectionOf("how-many-decks")?.slug).toBe("decks");

    // No deck number and no deck limit anywhere the help centre speaks.
    const text = [
      ...allFaqEntries().flatMap((entry) => [entry.q, entry.a]),
      ...HELP_SECTIONS.flatMap((section) => [
        section.intro,
        section.description,
        ...(section.howTo
          ? [section.howTo.summary, section.howTo.tip ?? "", ...section.howTo.steps.map((step) => step.body)]
          : []),
      ]),
    ].join("\n");
    expect(text).not.toMatch(/\b\d+ (?:(?:private|unlisted|public)(?: or unlisted)? )?decks?\b/i);
    expect(text).not.toMatch(/private[- ]deck (limit|cap|slot)|deck (limit|cap)s? (per|on) (your )?plan/i);
    expect(getHelpSection("decks")!.howTo!.steps[0].body).toMatch(/choose who sees it: public, unlisted or private\.$/);
  });

  it("say an import uses no saved-card slots — customizing does (owner decision D2)", () => {
    const answer = faqEntryById("import-uses-slots")!.a;
    expect(answer).toMatch(/^No\./);
    expect(answer).toContain(`Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited`);
    expect(getHelpSection("decks")!.howTo!.steps.map((step) => step.body).join("\n")).toContain(
      "Importing uses none of your saved-card slots",
    );
  });

  describe("Refer a friend (owner 2026-11-11: the cards-only rule, the typed code)", () => {
    const answer = (id: string) => faqEntryById(id)!.a;
    const all = REFERRALS_FAQ.map((entry) => `${entry.q}\n${entry.a}`).join("\n");
    const settings = DEFAULT_REFERRAL_SETTINGS;
    const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

    it("is one group of six answers under Sharing & community", () => {
      const group = getHelpSection("sharing-and-community")!.groups.find((g) => g.id === "refer-a-friend")!;
      expect(group.title).toBe("Refer a friend");
      expect(group.entryIds).toEqual(REFERRALS_FAQ.map((entry) => entry.id));
      expect(group.entryIds).toEqual([
        "how-referrals-work",
        "referral-rewards",
        "when-a-referral-counts",
        "use-free-days",
        "referral-limits",
        "add-a-referral-code",
      ]);
      for (const entry of REFERRALS_FAQ) expect(helpSectionOf(entry.id)?.slug, entry.id).toBe("sharing-and-community");
    });

    it("names the program's own numbers (lib/referrals/settings.ts) — the bar, the friend's days, the cap", () => {
      const { cardsRequired, windowDays } = settings.activation;
      expect(answer("how-referrals-work")).toContain(`saves their first ${cardsRequired} cards, each with artwork of its own, within ${windowDays} days of signing up`);
      expect(answer("how-referrals-work")).toContain(`Your friend gets ${settings.friend.days} free days`);
      expect(answer("when-a-referral-counts")).toContain(`saved ${cardsRequired} cards with artwork within ${windowDays} days`);
      expect(answer("referral-limits")).toContain(`up to ${settings.caps.friendsPerMonth} friends can be rewarded in one calendar month`);
      // What production runs today (read 2026-11-11): the numbers as a reader sees them.
      expect([cardsRequired, windowDays, settings.friend.days, settings.caps.friendsPerMonth]).toEqual([5, 30, 7, 5]);
    });

    it("spells the ladder out step by step, with totals that add up", () => {
      const ladder = answer("referral-rewards");
      const steps = settings.ladder.map(rewardStepPhrase);
      expect(steps).toHaveLength(10);
      // Every step, in order.
      let from = 0;
      for (const phrase of steps) {
        const at = ladder.indexOf(phrase, from);
        expect(at, phrase).toBeGreaterThanOrEqual(from);
        from = at + phrase.length;
      }
      const days = settings.ladder.reduce((sum, step) => sum + (step.kind === "days" ? step.days : 0), 0);
      const credits = settings.ladder.reduce((sum, step) => sum + (step.kind === "credits" ? step.amount : 0), 0);
      expect([days, credits]).toEqual([100, 85]);
      expect(ladder).toContain(`That is ${days} free days and ${credits} AI credits over your first ${steps.length} friends`);
      expect(ladder).toContain(`every friend after that brings ${rewardStepPhrase(settings.tail)} more`);
      expect(ladder).toContain(`on top of the ${SIGNUP_BANK_DAYS} every new account starts with`);
    });

    it("says nobody needs a plan or a payment card to EARN a reward — only to use the free days", () => {
      expect(answer("how-referrals-work")).toContain("Nobody has to start a plan or add a payment card to earn a reward.");
      expect(answer("when-a-referral-counts")).toContain("Your friend never has to pay or add a payment card for it to count.");
      expect(answer("use-free-days")).toMatch(/start a Plus or Pro plan: checkout asks for a payment card/);
      expect(answer("use-free-days")).toContain("AI credits from the ladder need no plan");
      // The retired rule (a plan with a card on file before anyone was rewarded) is in none of them.
      expect(all).not.toMatch(/card on file|starts? a (paid )?plan (and|with)|once (they|your friend) subscribe/i);
    });

    it("says free DAYS, never a free month", () => {
      expect(all).not.toMatch(/free months?|a month free|months? of (Plus|Pro)/i);
    });

    it("names the typed code's window and the remembered link's days from their constants", () => {
      expect(answer("add-a-referral-code")).toContain(`For your first ${REFERRAL_CLAIM_WINDOW_DAYS} days`);
      expect(answer("add-a-referral-code")).toContain(`remembers a friend's link you opened for ${REFERRAL_CODE_KEEP_DAYS} days in the same browser`);
      expect([REFERRAL_CLAIM_WINDOW_DAYS, REFERRAL_CODE_KEEP_DAYS]).toEqual([14, 30]);
    });

    it("every one of them is found by the hub's search for \"referral\"", () => {
      const found = helpSearchItems().filter((item) => `${item.title} ${item.text}`.toLowerCase().includes("referral"));
      expect(found.map((item) => item.id)).toEqual(expect.arrayContaining(REFERRALS_FAQ.map((entry) => entry.id)));
    });

    it("is linked from the Refer a friend page — at an anchor that exists", () => {
      expect(helpEntryHref("how-referrals-work")).toBe("/help/sharing-and-community#how-referrals-work");
      const page = source("app/(app)/dashboard/referrals/page.tsx");
      expect(page).toContain('helpEntryHref("how-referrals-work")');
      expect(page).toContain("Questions and answers about referrals");
    });

    it("quotes the screen's own labels", () => {
      expect(siteConfig.dashboardNav.map((item) => item.label)).toEqual(expect.arrayContaining(["Refer a friend", "Billing"]));
      expect(all).toContain("Refer a friend page");
      expect(all).toContain("Billing page");
      expect(answer("add-a-referral-code")).toContain("“Joined because of a friend?”");
      expect(source("components/referrals/referral-code-entry.tsx")).toContain(">Joined because of a friend?<");
      expect(source("components/billing/apply-bank-button.tsx")).toMatch(/Apply \{days\} banked day/);
      expect(answer("use-free-days")).toContain("press Apply beside your banked days");
    });
  });
});
