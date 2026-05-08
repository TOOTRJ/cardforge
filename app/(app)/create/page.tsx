import type { Metadata } from "next";
import Link from "next/link";
import { ImagePlus, Save, Wand2 } from "lucide-react";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Create",
  description:
    "Forge a new custom trading card. The full editor ships in the Creator MVP phase.",
};

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Creator"
        title="Forge a new card"
        description="The live editor lands in the Creator MVP phase. This screen previews the layout — fields on the left, live card preview on the right."
        actions={
          <>
            <Badge variant="outline">Phase 4 preview</Badge>
            <Button asChild variant="ghost">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </>
        }
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <SurfaceCard className="flex flex-col gap-6 p-6">
          <FieldGroup
            label="Title"
            helper="The card’s name. Defaults to ‘Untitled Card’."
            placeholder="Emberbound Wyrm"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Cost" helper="Generic fantasy cost." placeholder="{2}{R}{R}" />
            <FieldGroup label="Card type" helper="Creature, Spell, Artifact…" placeholder="Creature" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Subtypes" placeholder="Dragon, Elder" />
            <FieldGroup label="Rarity" placeholder="Mythic" />
          </div>
          <FieldGroup
            label="Rules text"
            helper="Plain text in the MVP. A structured rules editor arrives later."
            placeholder="Flying. Whenever Emberbound Wyrm enters the battlefield, draw a card."
            multiline
          />
          <FieldGroup
            label="Flavor text"
            placeholder="A coil of fire, bound by oath."
            multiline
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <FieldGroup label="Power" placeholder="4" />
            <FieldGroup label="Toughness" placeholder="4" />
            <FieldGroup label="Loyalty" placeholder="—" />
          </div>

          <SurfaceCard
            as="label"
            className="flex cursor-not-allowed items-center justify-between gap-4 border-dashed p-4 opacity-70"
          >
            <span className="flex items-center gap-3">
              <ImagePlus className="h-5 w-5 text-primary" aria-hidden />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Upload artwork</span>
                <span className="text-xs text-muted">Image upload ships with storage in Phase 2.</span>
              </span>
            </span>
            <Badge>Coming soon</Badge>
          </SurfaceCard>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-6">
            <Button variant="ghost" disabled>
              <Wand2 className="h-4 w-4" aria-hidden /> AI suggest
            </Button>
            <Button variant="outline" disabled>
              Save draft
            </Button>
            <Button disabled>
              <Save className="h-4 w-4" aria-hidden /> Save card
            </Button>
          </div>
        </SurfaceCard>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Live preview
            </p>
            <div className="mx-auto w-full max-w-sm">
              <CardPreviewPlaceholder
                card={{
                  title: "Emberbound Wyrm",
                  cost: "{2}{R}{R}",
                  cardType: "creature",
                  rarity: "mythic",
                  colorIdentity: "red",
                  artistCredit: "You",
                }}
              />
            </div>
            <p className="text-xs leading-5 text-muted">
              The live preview will reflect every field as you type once the
              editor wires up to local state in the Creator MVP phase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({
  label,
  helper,
  placeholder,
  multiline,
}: {
  label: string;
  helper?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      {multiline ? (
        <textarea
          rows={3}
          placeholder={placeholder}
          disabled
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
        />
      ) : (
        <input
          type="text"
          placeholder={placeholder}
          disabled
          className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
        />
      )}
      {helper ? <span className="text-xs text-muted">{helper}</span> : null}
    </label>
  );
}
