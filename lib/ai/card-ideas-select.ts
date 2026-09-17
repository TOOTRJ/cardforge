/** A partial set of creator form values an AI flow writes into the open
 *  form (only present keys are applied). Shared by the ideas dialog and the
 *  per-field fill flow. */
export type CardFieldPatch = {
  title?: string;
  cost?: string;
  card_type?: string;
  supertype?: string;
  subtypes_text?: string;
  rarity?: string;
  color_identity?: readonly string[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
};

// ---------------------------------------------------------------------------
// Card ideas → form patch. The ideas dialog shows N complete concepts and
// lets the user pick, PER FIELD GROUP, which concept's value to keep; this
// composes the chosen values into the same patch shape the AI assistant
// applies. Pure and client-safe — unit-tested.
// ---------------------------------------------------------------------------

/** The text-only slice of a designed card the ideas flow deals in. */
export type CardIdea = {
  title: string;
  cost: string;
  card_type: string;
  supertype: string | null;
  subtypes: string[];
  rarity: string;
  color_identity: string[];
  rules_text: string;
  flavor_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
};

/** Field groups the user picks between. Type line, cost/colors and stats
 *  travel together because splitting them produces nonsense cards. */
export const IDEA_FIELD_GROUPS = [
  "title",
  "typeLine",
  "costColors",
  "rarity",
  "rulesText",
  "flavorText",
  "stats",
] as const;

export type IdeaFieldGroup = (typeof IDEA_FIELD_GROUPS)[number];

export const IDEA_FIELD_LABELS: Record<IdeaFieldGroup, string> = {
  title: "Title",
  typeLine: "Type line",
  costColors: "Mana cost & colors",
  rarity: "Rarity",
  rulesText: "Rules text",
  flavorText: "Flavor text",
  stats: "Stats",
};

/** idea index per group */
export type IdeaSelection = Record<IdeaFieldGroup, number>;

export function wholeIdeaSelection(index: number): IdeaSelection {
  return Object.fromEntries(IDEA_FIELD_GROUPS.map((g) => [g, index])) as IdeaSelection;
}

/** Human summary of one group of one idea, for the option chips. */
export function ideaFieldSummary(idea: CardIdea, group: IdeaFieldGroup): string {
  switch (group) {
    case "title":
      return idea.title;
    case "typeLine":
      return [idea.supertype, idea.card_type, idea.subtypes.length ? `— ${idea.subtypes.join(" ")}` : null]
        .filter(Boolean)
        .join(" ");
    case "costColors":
      return `${idea.cost} · ${idea.color_identity.join(", ") || "colorless"}`;
    case "rarity":
      return idea.rarity;
    case "rulesText":
      return idea.rules_text;
    case "flavorText":
      return idea.flavor_text ?? "(none)";
    case "stats": {
      if (idea.power || idea.toughness) return `${idea.power ?? "—"} / ${idea.toughness ?? "—"}`;
      if (idea.loyalty) return `Loyalty ${idea.loyalty}`;
      if (idea.defense) return `Defense ${idea.defense}`;
      return "(none)";
    }
  }
}

/** Does this group carry anything for the idea (so the chip is worth showing)? */
export function ideaHasField(idea: CardIdea, group: IdeaFieldGroup): boolean {
  if (group === "flavorText") return Boolean(idea.flavor_text);
  if (group === "stats") return Boolean(idea.power || idea.toughness || idea.loyalty || idea.defense);
  return true;
}

export function composeIdeaPatch(ideas: CardIdea[], selection: IdeaSelection): CardFieldPatch {
  const pick = (group: IdeaFieldGroup): CardIdea | null =>
    ideas[selection[group]] ?? ideas[0] ?? null;
  const title = pick("title");
  const type = pick("typeLine");
  const cost = pick("costColors");
  const rarity = pick("rarity");
  const rules = pick("rulesText");
  const flavor = pick("flavorText");
  const stats = pick("stats");
  if (!title || !type || !cost || !rarity || !rules || !flavor || !stats) return {};
  return {
    title: title.title,
    card_type: type.card_type,
    supertype: type.supertype ?? "",
    subtypes_text: type.subtypes.join(", "),
    cost: cost.cost,
    color_identity: cost.color_identity,
    rarity: rarity.rarity,
    rules_text: rules.rules_text,
    flavor_text: flavor.flavor_text ?? "",
    power: stats.power ?? "",
    toughness: stats.toughness ?? "",
    loyalty: stats.loyalty ?? "",
    defense: stats.defense ?? "",
  };
}
