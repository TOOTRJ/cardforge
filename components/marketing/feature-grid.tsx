import {
  Frame,
  GitFork,
  Layers,
  Sparkles,
  Swords,
  Type,
  type LucideIcon,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { IconTile } from "@/components/ui/icon-tile";
import { SectionHeading } from "@/components/ui/section-heading";

type Feature = {
  icon: LucideIcon;
  tone: "gold" | "purple" | "ember";
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    icon: Sparkles,
    tone: "gold",
    title: "Perfect pips",
    description:
      "Precision mana symbols that stay crisp at any size — generic, hybrid, twobrid, phyrexian, snow, energy, all of it. Upload your own custom pip icons and every card you own wears them, from the editor to the exported PNG.",
  },
  {
    icon: Frame,
    tone: "purple",
    title: "Beautiful frames",
    description:
      "Three decades of card design in one picker: 1993 classic, 1997 retro, 2003 modern, M15, and showcase styles. Frames tint to your color identity automatically, and the live preview matches the export pixel for pixel.",
  },
  {
    icon: Type,
    tone: "ember",
    title: "Smart text tools",
    description:
      "An oracle-text editor with a full symbol toolbar, reminder-text italics, ability templating, and auto-fit sizing — plus an AI assistant that tightens wording and writes flavor text without overwriting your work.",
  },
  {
    icon: Swords,
    tone: "purple",
    title: "Every MTG card type",
    description:
      "Creatures, instants, sorceries, enchantments, artifacts, lands, planeswalkers, battles, sagas, and double-faced cards. Set power and toughness, loyalty, defense, and chapter abilities exactly the way you want.",
  },
  {
    icon: Layers,
    tone: "gold",
    title: "Full expansion sets",
    description:
      "Group cards into named sets. Track rarity distribution, color spread, and creature-type themes across your whole set from a single workspace — like a one-person R&D team.",
  },
  {
    icon: GitFork,
    tone: "ember",
    title: "Share, remix, export",
    description:
      "Publish to the community gallery or keep cards private. Remix any public card under your own name, and export print-ready PNGs or PDF sheets whenever you're ready to play.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        align="center"
        eyebrow="Built for Magic fans"
        title="Everything you need to craft amazing cards"
        description="From a single homebrewed creature to a complete fan expansion — PipGlyph handles the precision work so you can focus on the game."
        className="mb-12"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, tone, title, description }) => (
          <SurfaceCard
            key={title}
            className="flex flex-col gap-3 p-6 transition-colors hover:border-gold/40"
          >
            <IconTile tone={tone}>
              <Icon aria-hidden />
            </IconTile>
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
