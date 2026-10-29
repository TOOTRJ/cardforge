import { describe, expect, it } from "vitest";
import { HELP_SECTION_ICONS } from "@/components/content/help-icons";
import { DECK_AI_PAUSED, DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";
import {
  CARD_CAPACITY,
  CARD_CAPACITY_UNLIMITED,
  DECK_CAPACITY,
  privateDecksByPlanSentence,
} from "@/lib/billing/plans";
import {
  AI_GENERATOR_FAQ,
  allFaqEntries,
  CARD_MAKER_FAQ,
  COMPARISON_FAQ,
  FAQ_TOPICS,
  MANA_PIP_FAQ,
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

  it("state the private-deck limits as DECK_CAPACITY sets them (TODO DK3, migration 0145)", () => {
    // Free 1 / Plus 3 / Pro unlimited — PRIVATE and UNLISTED decks only;
    // public decks are unlimited on every plan (owner decision D1).
    expect(DECK_CAPACITY).toEqual({ free: 1, plus: 3, pro: CARD_CAPACITY_UNLIMITED });
    const plans = `Free includes ${DECK_CAPACITY.free} private or unlisted deck, Plus ${DECK_CAPACITY.plus}, and Pro as many as you like.`;
    expect(privateDecksByPlanSentence()).toBe(plans);

    const answer = faqEntryById("how-many-decks")!.a;
    expect(answer).toContain("As many public decks as you like, on every plan.");
    expect(answer).toContain(`The limit is on private and unlisted decks: ${plans}`);
    expect(answer).toContain("never locks a deck");
    const start = getHelpSection("decks")!.howTo!.steps[0].body;
    expect(start).toContain(`Public decks are unlimited on every plan; ${plans}`);

    // No other number for a deck limit anywhere in the section.
    const decks = getHelpSection("decks")!;
    const text = [
      ...helpSectionEntries(decks).flatMap((entry) => [entry.q, entry.a]),
      ...(decks.howTo?.steps.map((step) => step.body) ?? []),
      decks.howTo?.tip ?? "",
    ].join("\n");
    for (const [, n] of text.matchAll(/\b(\d+) (?:private|unlisted)(?: or unlisted)? decks?\b/gi)) {
      expect([DECK_CAPACITY.free, DECK_CAPACITY.plus]).toContain(Number(n));
    }
    expect(text).not.toMatch(/\bup to \d+ decks\b/i);
  });

  it("say an import uses no saved-card slots — customizing does (owner decision D2)", () => {
    const answer = faqEntryById("import-uses-slots")!.a;
    expect(answer).toMatch(/^No\./);
    expect(answer).toContain(`Free holds ${CARD_CAPACITY.free}, Plus ${CARD_CAPACITY.plus}, Pro unlimited`);
    expect(getHelpSection("decks")!.howTo!.steps.map((step) => step.body).join("\n")).toContain(
      "Importing uses none of your saved-card slots",
    );
  });
});
