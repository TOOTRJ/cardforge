import {
  GalleryHorizontalEnd,
  GitFork,
  Layers,
  Palette,
  Sparkles,
  Wand2,
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
    icon: Wand2,
    title: "Create cards fast",
    description:
      "A simple, focused editor with a live preview. Type a name, drop in art, and the card forms in real time.",
  },
  {
    icon: Layers,
    title: "Build custom sets",
    description:
      "Group cards into sets and worlds. Track rarities, color identity, and themes from a single workspace.",
  },
  {
    icon: GalleryHorizontalEnd,
    title: "Share and remix",
    description:
      "Publish cards to a public gallery or keep them private. Fork any community card to riff on it.",
  },
  {
    icon: Sparkles,
    title: "AI-assisted design",
    description:
      "Soon: smart prompts for rules text, balancing, and flavor. Phase 1 ships the foundation it sits on.",
  },
  {
    icon: Palette,
    title: "Original frames",
    description:
      "Premium, generic fantasy frames. No copyrighted symbols, fonts, or set marks — your art, your IP.",
  },
  {
    icon: GitFork,
    title: "Structured by default",
    description:
      "Every card is structured data first. Export PNG, JSON, or remix into a new card without losing fidelity.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mb-12 flex flex-col gap-4 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          What you can build today
        </span>
        <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          A creator-first card platform
        </h2>
        <p className="mx-auto max-w-2xl text-base leading-7 text-muted">
          The MVP launches with a polished fantasy-card creator, but the
          architecture is universal — built to grow into any custom card game.
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
