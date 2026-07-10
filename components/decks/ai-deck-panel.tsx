"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { useGenerationJob } from "@/components/ai/use-generation-job";
import { GenerationProgress } from "@/components/ai/generation-progress";
import { StylePicker } from "@/components/ai/style-picker";

// ---------------------------------------------------------------------------
// AiDeckPanel — deck-side AI generation. Two modes on the jobs pipeline:
//
//   mode="new"   (/dashboard/decks): theme + style + format → AI plans an
//                original deck (commander slot, land share, real mana
//                curve) and paints every card. Lands in a new private deck.
//   mode="remix" (/deck/[slug]/edit): style (+ theme twist) → a NEW COPY of
//                the deck where every resolved card keeps its rules
//                byte-identical but gets an AI name + art in the chosen
//                style. The original deck is untouched.
//
// Card count per generation is capped server-side (3 until subscriptions;
// admins exempt) — remixes beyond the cap are skipped and reported.
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS = [
  { value: "commander", label: "Commander" },
  { value: "standard", label: "Standard" },
  { value: "limited", label: "Limited" },
] as const;

type Mode = "new" | "remix";

export function AiDeckPanel({
  mode,
  aiConfigured,
  maxCards,
  deckId,
}: {
  mode: Mode;
  aiConfigured: boolean;
  maxCards: number;
  /** Required for mode="remix": the source deck. */
  deckId?: string;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [format, setFormat] =
    useState<(typeof FORMAT_OPTIONS)[number]["value"]>("commander");
  const [size, setSize] = useState(Math.min(3, maxCards));
  const { phase, steps, busy, run } = useGenerationJob();

  const handleGenerate = async () => {
    if (mode === "remix" && !style.trim()) {
      toast.error("Pick or type a style first — that's what the remix is.");
      return;
    }
    const outcome = await run(
      mode === "new"
        ? {
            kind: "deck",
            theme: theme.trim() || undefined,
            style: style.trim() || undefined,
            format,
            size,
          }
        : {
            kind: "deck_remix",
            deck_id: deckId,
            style: style.trim(),
            theme: theme.trim() || undefined,
          },
    );
    if (!outcome.ok) return;
    toast.success(
      outcome.failures > 0
        ? `Deck ${mode === "remix" ? "remixed" : "generated"} with ${outcome.failures} failed step${outcome.failures === 1 ? "" : "s"}.`
        : mode === "remix"
          ? "Deck remixed — a new private copy with restyled cards is ready."
          : "Deck generated — every card is a private draft you can polish.",
    );
    if (outcome.slug) router.push(`/deck/${outcome.slug}/edit`);
  };

  if (!aiConfigured) return null;

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
          {mode === "new" ? (
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          ) : (
            <Wand2 className="h-4 w-4 text-accent" aria-hidden />
          )}
          {mode === "new" ? "Generate a deck with AI" : "Remix this deck with AI"}
        </h2>
        <p className="text-sm leading-6 text-muted">
          {mode === "new"
            ? "AI drafts an original deck for your format — commander, curve, and matching art — as private drafts."
            : "A new copy of this deck where each card keeps its exact rules but gets a fresh AI name and art in your style. The original stays untouched."}
        </p>
      </header>

      {mode === "new" ? (
        <div className="grid gap-4 sm:grid-cols-2">
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
            mode === "new"
              ? "e.g. graveyard mushroom druids"
              : "e.g. set it in a frozen wasteland"
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
            : "Applied to every card's art."
        }
      >
        <StylePicker value={style} onChange={setStyle} disabled={busy} />
      </FieldGroup>

      <GenerationProgress steps={steps} phase={phase} />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted">
          1 credit per card · {mode === "remix" ? `first ${maxCards} cards this generation` : "cards land as private drafts"}
        </span>
        <Button type="button" onClick={handleGenerate} disabled={busy}>
          {phase === "planning" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {mode === "remix" ? "Reading deck…" : "Designing deck…"}
            </>
          ) : phase === "stepping" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Painting cards…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              {mode === "remix" ? "Remix deck" : "Generate deck"}
            </>
          )}
        </Button>
      </div>
    </SurfaceCard>
  );
}
