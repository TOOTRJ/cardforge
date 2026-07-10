"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { useGenerationJob } from "@/components/ai/use-generation-job";
import { GenerationProgress } from "@/components/ai/generation-progress";
import { StylePicker } from "@/components/ai/style-picker";

// ---------------------------------------------------------------------------
// AiSetGenerator — "Generate a set with AI" panel. Two homes:
//   - /dashboard/sets (no setId): plans a brand-new private set
//   - /set/[slug]/edit (setId): generates cards INTO that set
//
// Drives the client-stepped job pipeline (components/ai/use-generation-job):
// one plan request designs the whole set's text cohesively, then one step
// per request paints each card (and the set icon) with live progress.
// Card count is capped server-side (3/generation until subscriptions;
// admins exempt) — maxCards mirrors that cap in the UI.
// ---------------------------------------------------------------------------

export function AiSetGenerator({
  aiConfigured,
  maxCards,
  setId,
}: {
  aiConfigured: boolean;
  /** Per-generation card cap for this user (3, or higher for admins). */
  maxCards: number;
  /** Present on a set's edit page — generate into that set. */
  setId?: string;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [size, setSize] = useState(Math.min(3, maxCards));
  const { phase, steps, busy, run } = useGenerationJob();

  const handleGenerate = async () => {
    const outcome = await run({
      kind: "set",
      theme: theme.trim() || undefined,
      style: style.trim() || undefined,
      size,
      set_id: setId,
    });
    if (!outcome.ok) {
      if (outcome.failures > 0) {
        toast.error("Generation didn't produce any cards. Try again.");
      }
      return;
    }
    toast.success(
      outcome.failures > 0
        ? `Set generated with ${outcome.failures} failed step${outcome.failures === 1 ? "" : "s"}.`
        : "Set generated — every card is a private draft you can polish and publish.",
    );
    if (setId) {
      router.refresh();
    } else if (outcome.slug) {
      router.push(`/set/${outcome.slug}/edit`);
    }
  };

  if (!aiConfigured) return null;

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {setId ? "Generate cards into this set" : "Generate a set with AI"}
        </h2>
        <p className="text-sm leading-6 text-muted">
          AI plans a cohesive mini-set — balanced rarities, matching art
          {setId ? "" : ", a set icon,"} and one shared world — as private
          drafts you can edit before publishing.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup label="Theme" helper="The set's world or story.">
          <input
            type="text"
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            maxLength={300}
            placeholder="e.g. deep-sea clockwork empire"
            className={inputClass(false)}
            disabled={busy}
          />
        </FieldGroup>
        <FieldGroup label="Cards" helper={`Up to ${maxCards} per generation.`}>
          <select
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className={inputClass(false)}
            disabled={busy}
          >
            {Array.from({ length: maxCards }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} card{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </FieldGroup>
      </div>

      <FieldGroup label="Art style" helper="Applied to every card's art.">
        <StylePicker value={style} onChange={setStyle} disabled={busy} />
      </FieldGroup>

      <GenerationProgress steps={steps} phase={phase} />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted">
          1 credit per card · cards land as private drafts
        </span>
        <Button type="button" onClick={handleGenerate} disabled={busy}>
          {phase === "planning" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Designing set…
            </>
          ) : phase === "stepping" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Painting cards…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate set
            </>
          )}
        </Button>
      </div>
    </SurfaceCard>
  );
}
