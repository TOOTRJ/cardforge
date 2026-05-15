import {
  GitFork,
  Layers,
  Palette,
  Sparkles,
  Swords,
  FileDown,
  type LucideIcon,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    icon: Swords,
    title: "Every MTG card type",
    description:
      "Creatures, instants, sorceries, enchantments, artifacts, lands, planeswalkers, and battles. Set mana costs, power/toughness, loyalty counters, and oracle text exactly the way you want.",
  },
  {
    icon: Palette,
    title: "WUBRG color identity",
    description:
      "Full five-color support. Assign white, blue, black, red, green, or multicolor identity and watch the card's art well tint to match. Colorless builds included.",
  },
  {
    icon: Sparkles,
    title: "AI rules templating",
    description:
      "Stuck on wording? The built-in AI assistant suggests oracle text, tightens keyword templating, and writes flavor text in the voice you describe — without overwriting your work.",
  },
  {
    icon: Layers,
    title: "Full expansion sets",
    description:
      "Group cards into named sets. Track rarity distribution, color spread, and creature type themes across your whole set from a single workspace — like a one-person R&D team.",
  },
  {
    icon: GitFork,
    title: "Share and remix",
    description:
      "Publish cards to the community gallery or keep them private. Any public card can be remixed — fork it, tweak the cost, rewrite the ability, and publish your spin under your name.",
  },
  {
    icon: FileDown,
    title: "Export your cards",
    description:
      "Download any card as a high-resolution PNG or export your full set as structured JSON. Every card is data first, image second — so it stays editable forever.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mb-12 flex flex-col gap-4 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Built for Magic fans
        </span>
        <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Everything you need to design custom MTG cards
        </h2>
        <p className="mx-auto max-w-2xl text-base leading-7 text-muted">
          From a single homebrewed creature to a complete fan expansion —
          Spellwright handles the design work so you can focus on the game.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, description }) => (
          <SurfaceCard
            key={title}
            className="flex flex-col gap-3 p-6 transition-colors hover:border-border-strong"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-elevated text-primary">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="font-display text-lg font-semibold text-foreground">
              {title}
            </h3>
            <p className="text-sm leading-6 text-muted">{description}</p>
          </SurfaceCard>
        ))}
      </div>
    </section>
  );
}
