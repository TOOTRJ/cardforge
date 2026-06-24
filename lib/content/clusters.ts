// ---------------------------------------------------------------------------
// Content clusters — the "hub" half of the hub-and-spoke model.
//
// A cluster is a tag with editorial framing: a title and an intro paragraph so
// the tag hub at /articles/tag/[slug] reads as a real topic landing page, not
// a bare list (thin hub pages don't earn topical authority). Tags that aren't
// listed here still get a generic hub — this map only adds the pillar copy and
// a CTA to the matching tool for the clusters we're actively building.
// ---------------------------------------------------------------------------

export type Cluster = {
  slug: string;
  /** Hub H1. */
  title: string;
  /** Pillar copy under the title — the substantive intro to the topic. */
  intro: string;
  /** Short (~120 char) meta description for the hub's <head>. */
  blurb: string;
  /** A tool/landing page this cluster naturally sends readers to. */
  toolHref?: string;
  toolLabel?: string;
};

export const CLUSTERS: Record<string, Cluster> = {
  "card-design": {
    slug: "card-design",
    title: "Custom Card Design",
    intro:
      "Designing a custom Magic: The Gathering card is part rules, part instinct. These guides cover the craft end to end — costing a card fairly against the color pie, writing oracle text that reads like the real thing, designing every card type from creatures to planeswalkers, and catching the mistakes that make a homebrew card feel off before your playgroup ever sleeves it up.",
    blurb:
      "Guides on designing custom MTG cards — costing, the color pie, oracle text, every card type, and the mistakes to avoid.",
    toolHref: "/mtg-card-maker",
    toolLabel: "Open the card maker",
  },
  reference: {
    slug: "reference",
    title: "MTG Card Reference",
    intro:
      "The building blocks of every Magic card, explained for the people who make their own. Mana symbols, keyword abilities, card frames, rarity, and the anatomy of the card itself — the reference you reach for while you design, written to be accurate and quick to scan.",
    blurb:
      "A reference for custom-card makers: MTG mana symbols, keyword abilities, frames, rarity, and card anatomy.",
    toolHref: "/mana-pip-editor",
    toolLabel: "Open the pip editor",
  },
  playtesting: {
    slug: "playtesting",
    title: "Playtesting & Printing",
    intro:
      "A custom card isn't finished when the art lands — it's finished when it survives a real game. These guides cover playtesting your designs, printing clean proxies at home, and running community design challenges that sharpen your whole playgroup.",
    blurb:
      "Guides on playtesting custom MTG cards, printing proxies at home, and running community design challenges.",
    toolHref: "/preview",
    toolLabel: "Open the card creator",
  },
};

export function getCluster(slug: string): Cluster | null {
  return CLUSTERS[slug] ?? null;
}
