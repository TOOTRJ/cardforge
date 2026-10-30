// ---------------------------------------------------------------------------
// Content clusters — the "hub" half of the hub-and-spoke model.
//
// A cluster is a tag with editorial framing: a title and an intro paragraph so
// the tag hub at /articles/tag/[slug] reads as a real topic landing page, not
// a bare list (thin hub pages don't earn topical authority). Tags that aren't
// listed here still get a generic hub — this map only adds the pillar copy and
// a CTA to the matching tool for the clusters we're actively building.
//
// The four broad topics that used to be clusters here (card design,
// reference, card makers, lore) are /learn CATEGORIES now, with their copy in
// lib/content/article-categories.ts — their tag hubs 308 to /learn/<slug>
// (proxy.ts), so a cluster entry for one of those tags would never be read.
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

const CLUSTERS: Record<string, Cluster> = {
  playtesting: {
    slug: "playtesting",
    title: "Playtesting & Printing",
    intro:
      "A custom card isn't finished when the art lands — it's finished when it survives a real game. These guides cover playtesting your designs, printing clean proxies at home, and running community design challenges that sharpen your whole playgroup.",
    blurb:
      "Guides on playtesting custom MTG cards, printing proxies at home, and running community design challenges.",
    toolHref: "/create",
    toolLabel: "Open the card creator",
  },
  // The evergreen series (TODO NV13): lore behind a mechanic or a flavor
  // archetype, and design studies of classic sets. Never news (owner D10).
  "behind-the-cards": {
    slug: "behind-the-cards",
    title: "Behind the Cards",
    intro:
      "Every Magic mechanic began as an idea about a world: that the dead don't stay buried, that power has a price, that the ground beneath an explorer's feet is alive. Behind the Cards follows those ideas from story to rules text in two kinds of guide — lore pieces on a mechanic or flavor archetype, and spotlights that study a classic set the way a designer would. Each ends with original example cards and how to build your own in PipGlyph.",
    blurb:
      "The ideas behind MTG's mechanics and classic sets, studied for custom card designers, with original example cards.",
    toolHref: "/create",
    toolLabel: "Open the card creator",
  },
};

export function getCluster(slug: string): Cluster | null {
  return CLUSTERS[slug] ?? null;
}
