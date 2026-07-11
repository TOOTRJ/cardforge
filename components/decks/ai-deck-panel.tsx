"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
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
// AiDeckPanel — deck-side AI generation. Two modes on the jobs pipeline:
//
//   mode="new"   (/dashboard/decks): theme + style + format → AI plans an
//                original deck (commander slot, land share, real mana
//                curve), paints every card, and generates a deck cover.
//   mode="remix" (/deck/[slug]/edit): style (+ theme twist) → a NEW COPY of
//                the deck where every resolved card keeps its rules
//                byte-identical but gets an AI name + art in the chosen
//                style, plus a matching cover. The original is untouched.
//
// Generated decks and cards publish PUBLICLY by default; failed steps
// (usually an image) retry individually without regenerating the batch.
// Card count per generation is capped server-side (3 until subscriptions;
// admins exempt).
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS = [
  { value: "commander", label: "Commander" },
  { value: "standard", label: "Standard" },
  { value: "limited", label: "Limited" },
] as const;

type Mode = "new" | "remix" | "add";

export function AiDeckPanel({
  mode,
  aiConfigured,
  maxCards,
  deckId,
  initialTheme,
  initialStyle,
}: {
  mode: Mode;
  aiConfigured: boolean;
  maxCards: number;
  /** Required for mode="remix" and mode="add": the target deck. */
  deckId?: string;
  /** Prefill (mode="add"): the theme/style the deck was originally
   *  generated with, so additions stay stylistically consistent. */
  initialTheme?: string | null;
  initialStyle?: string | null;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState(initialTheme ?? "");
  const [style, setStyle] = useState(initialStyle ?? "");
  const [format, setFormat] =
    useState<(typeof FORMAT_OPTIONS)[number]["value"]>("commander");
  const [size, setSize] = useState(Math.min(3, maxCards));
  const [resultSlug, setResultSlug] = useState<string | undefined>(undefined);
  const { phase, steps, busy, hasFailures, run, retryStep, retryFailed } =
    useGenerationJob();

  const settle = (outcome: GenerationJobOutcome) => {
    setResultSlug(outcome.slug);
    if (!outcome.ok) {
      if (outcome.failures > 0) {
        toast.error("Generation didn't finish — retry the failed steps below.");
      }
      return;
    }
    if (outcome.failures > 0) {
      toast.message(
        `${outcome.successes} step${outcome.successes === 1 ? "" : "s"} done, ${outcome.failures} failed.`,
        { description: "Retry the failed steps below — nothing gets regenerated twice." },
      );
      return;
    }
    toast.success(
      mode === "remix"
        ? "Deck remixed and published — the original is untouched."
        : mode === "add"
          ? "New cards added to the deck — designed to synergize with what's already there."
          : "Deck generated and published — every card is yours to edit.",
    );
    if (mode === "add") {
      router.refresh();
    } else if (outcome.slug) {
      router.push(`/deck/${outcome.slug}/edit`);
    }
  };

  const handleGenerate = async () => {
    if (mode === "remix" && !style.trim()) {
      toast.error("Pick or type a style first — that's what the remix is.");
      return;
    }
    settle(
      await run(
        mode === "remix"
          ? {
              kind: "deck_remix",
              deck_id: deckId,
              style: style.trim(),
              theme: theme.trim() || undefined,
            }
          : {
              kind: "deck",
              theme: theme.trim() || undefined,
              style: style.trim() || undefined,
              // Add-mode decks keep their own format; the server reads it
              // off the deck row.
              format,
              size,
              ...(mode === "add" ? { deck_id: deckId } : {}),
            },
      ),
    );
  };

  if (!aiConfigured) return null;

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
          {mode === "remix" ? (
            <Wand2 className="h-4 w-4 text-accent" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          )}
          {mode === "new"
            ? "Generate a deck with AI"
            : mode === "add"
              ? "Generate more cards for this deck"
              : "Remix this deck with AI"}
        </h2>
        <p className="text-sm leading-6 text-muted">
          {mode === "new"
            ? "AI drafts an original deck for your format — commander, curve, matching art, and a cover — published publicly and fully editable."
            : mode === "add"
              ? "AI reads the deck's current cards and designs new ones that synergize — same colors, mechanics, and art style. Theme and style prefill from the original generation."
              : "A new public copy of this deck where each card keeps its exact rules but gets a fresh AI name, art, and cover in your style. The original stays untouched."}
        </p>
      </header>

      {mode !== "remix" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "new" ? (
            <FieldGroup label="Format">
              <select
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as typeof format)
                }
                className={inputClass(false)}
                disabled={busy}
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FieldGroup>
          ) : null}
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
      ) : null}

      <FieldGroup
        label="Theme"
        helper={
          mode === "new"
            ? "What the deck is about — strategy, world, or vibe."
            : "Optional extra direction for the new names and flavor."
        }
      >
        <input
          type="text"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
          maxLength={300}
          placeholder={
            mode === "remix"
              ? "e.g. set it in a frozen wasteland"
              : "e.g. graveyard mushroom druids"
          }
          className={inputClass(false)}
          disabled={busy}
        />
      </FieldGroup>

      <FieldGroup
        label="Art style"
        helper={
          mode === "remix"
            ? "Required — how the remixed cards should look."
            : "Applied to every card's art and the cover."
        }
      >
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
          {mode === "remix" ? ` · first ${maxCards} cards this generation` : ""}
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
          {!busy && resultSlug && phase === "done" && hasFailures ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/deck/${resultSlug}/edit`)}
            >
              Open deck
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <Button type="button" onClick={handleGenerate} disabled={busy}>
            {phase === "planning" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {mode === "new" ? "Designing deck…" : "Reading deck…"}
              </>
            ) : phase === "stepping" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Painting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                {mode === "remix"
                  ? "Remix deck"
                  : mode === "add"
                    ? "Add cards"
                    : "Generate deck"}
              </>
            )}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
