"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import {
  useGenerationJob,
  type GenerationJobOutcome,
} from "@/components/ai/use-generation-job";
import { GenerationProgress } from "@/components/ai/generation-progress";
import { StylePicker } from "@/components/ai/style-picker";

// ---------------------------------------------------------------------------
// AiSetGenerator — "Generate a set with AI" panel. Two homes:
//   - /dashboard/sets (no setId): plans a brand-new set
//   - /set/[slug]/edit (setId): generates cards INTO that set
//
// Drives the client-stepped job pipeline (components/ai/use-generation-job):
// one plan request designs the whole set's text cohesively, then one step
// per request paints each card, the set icon, and the set cover. Generated
// sets and cards publish PUBLICLY by default; failed steps (usually an
// image) can be retried per-step without regenerating the batch.
// ---------------------------------------------------------------------------

// Temporarily disabled (owner decision, 2026-07-10) — the server rejects
// kind "set" too (SET_GENERATION_ENABLED in lib/ai/generation-jobs.ts).
// Flip both together to re-launch.
const SET_GENERATION_UI_ENABLED = false;

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
  const [resultSlug, setResultSlug] = useState<string | undefined>(undefined);
  const { phase, steps, busy, hasFailures, run, retryStep, retryFailed } =
    useGenerationJob();

  const settle = (outcome: GenerationJobOutcome) => {
    setResultSlug(outcome.slug);
    if (!outcome.ok) {
      if (outcome.failures > 0) {
        toast.error(
          "Generation didn't finish — retry the failed steps below.",
        );
      }
      return;
    }
    if (outcome.failures > 0) {
      toast.message(
        `${outcome.successes} step${outcome.successes === 1 ? "" : "s"} done, ${outcome.failures} failed.`,
        { description: "Retry the failed steps below — nothing gets regenerated twice." },
      );
      if (setId) router.refresh();
      return;
    }
    toast.success("Set generated and published — every card is yours to edit.");
    if (setId) {
      router.refresh();
    } else if (outcome.slug) {
      router.push(`/set/${outcome.slug}/edit`);
    }
  };

  const handleGenerate = async () =>
    settle(
      await run({
        kind: "set",
        theme: theme.trim() || undefined,
        style: style.trim() || undefined,
        size,
        set_id: setId,
      }),
    );

  if (!aiConfigured) return null;

  if (!SET_GENERATION_UI_ENABLED) {
    return (
      <SurfaceCard className="flex flex-col gap-2 p-6 opacity-80">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            Generate a set with AI
          </h2>
          <span className="rounded-full border border-border/70 bg-elevated px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
            Coming soon
          </span>
        </div>
        <p className="text-sm leading-6 text-muted">
          Whole-set generation — balanced rarities, matching art, a set icon,
          and a cover in one go — is getting a polish pass and will be back
          shortly. Deck generation is live in the meantime.
        </p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {setId ? "Generate cards into this set" : "Generate a set with AI"}
        </h2>
        <p className="text-sm leading-6 text-muted">
          AI plans a cohesive mini-set — balanced rarities, matching art, a
          set icon, and a cover — published publicly and fully editable. You
          can make anything private afterward.
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

      <FieldGroup label="Art style" helper="Applied to every card's art, the icon, and the cover.">
        <StylePicker value={style} onChange={setStyle} disabled={busy} />
      </FieldGroup>

      <GenerationProgress
        steps={steps}
        phase={phase}
        onRetryStep={(key) => void retryStep(key).then(settle)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-muted">
          1 credit per card · publishes publicly
        </span>
        <div className="flex items-center gap-2">
          {!busy && hasFailures ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void retryFailed().then(settle)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retry failed steps
            </Button>
          ) : null}
          {!busy && !setId && resultSlug && phase === "done" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/set/${resultSlug}/edit`)}
            >
              Open set
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <Button type="button" onClick={handleGenerate} disabled={busy}>
            {phase === "planning" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Designing set…
              </>
            ) : phase === "stepping" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Painting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Generate set
              </>
            )}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
