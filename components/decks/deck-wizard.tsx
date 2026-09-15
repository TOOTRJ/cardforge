"use client";

// ---------------------------------------------------------------------------
// DeckWizard — the one way to start a deck (/dashboard/decks/new). Four
// steps on the same Stepper the card creator uses:
//
//   1 Basics   title, format, visibility, description
//   2 Build    how the cards arrive: Generate with AI (deck type, power
//              bracket, theme ideas for a credit, surprise-me, style,
//              size), Import a decklist, or Start empty
//   3 Cover    upload with a focal point — AI builds paint one for free
//   4 Review   summary → Create deck (and kick off the AI job)
//
// The deck row is created at the end; an AI build then runs the jobs
// pipeline INTO that deck (add-mode), so the title, format, type and
// bracket the user chose are the deck's from the first second.
// ---------------------------------------------------------------------------

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  Dices,
  FileText,
  Lightbulb,
  Loader2,
  Lock,
  Sparkles,
  SquarePen,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
import { BatchSizeField } from "@/components/ai/batch-size-field";
import { StylePicker } from "@/components/ai/style-picker";
import { GenerationProgress } from "@/components/ai/generation-progress";
import { useGenerationJob, type GenerationJobOutcome } from "@/components/ai/use-generation-job";
import { CoverField } from "@/components/decks/deck-creator-form";
import { createDeckAction } from "@/lib/decks/actions";
import { publishCredits } from "@/components/billing/credits-bus";
import {
  COMMANDER_BRACKETS,
  DECK_TYPES,
  deckTypeByKey,
  describeColors,
  randomDeckSeed,
} from "@/lib/decks/deck-types";
import { cn } from "@/lib/utils";
import {
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  type DeckCoverPosition,
  type DeckFormat,
} from "@/types/deck";
import type { Visibility } from "@/types/card";

type BuildMode = "ai" | "import" | "empty";

const STEPS: StepperStep[] = [
  { key: "basics", label: "Basics", description: "Name and format" },
  { key: "build", label: "Build", description: "AI, import or empty" },
  { key: "cover", label: "Cover", description: "Optional artwork" },
  { key: "review", label: "Review", description: "Create the deck" },
];

/** Formats the AI can plan from scratch; other formats can still be
 *  generated into as add-mode, but the wizard keeps it simple. */
const AI_FULL_SIZE: Record<string, number> = { commander: 100, standard: 60, limited: 40 };

type DeckIdea = { title: string; theme: string; style: string; pitch: string };

export function DeckWizard({
  userId,
  aiConfigured,
  maxCards,
}: {
  userId: string;
  aiConfigured: boolean;
  maxCards: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Basics
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<DeckFormat>("commander");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [description, setDescription] = useState("");

  // Build
  const [mode, setMode] = useState<BuildMode>(aiConfigured ? "ai" : "empty");
  const [deckType, setDeckType] = useState<string>("");
  const [bracket, setBracket] = useState<number>(2);
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [size, setSize] = useState(Math.min(10, maxCards));
  const [ideas, setIdeas] = useState<DeckIdea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);

  // Cover
  const [coverUrl, setCoverUrl] = useState("");
  const [coverPosition, setCoverPosition] = useState<DeckCoverPosition | null>(null);

  // Create + generate
  const [creating, startCreate] = useTransition();
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const { phase, steps, busy, hasFailures, run, retryStep, retryFailed } = useGenerationJob();

  const isCommander = format === "commander";
  const chosenType = deckTypeByKey(deckType);
  const fullSize = AI_FULL_SIZE[format] ?? 60;
  const titleError = title.trim().length < 3 ? "Give the deck a name (3+ characters)." : null;
  const stepHasError = (i: number) => i === 0 && step > 0 && Boolean(titleError);

  const goNext = () => {
    if (step === 0 && titleError) {
      toast.error(titleError);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const surprise = () => {
    const seed = randomDeckSeed();
    setMode("ai");
    setDeckType(seed.deckType.key);
    setTheme(seed.theme);
    setStyle(seed.style);
    if (isCommander) setBracket(seed.bracket.level);
    toast.message(`Rolled ${seed.deckType.label}: “${seed.theme}” in ${seed.style}.`, {
      description: "Tweak anything, or generate as-is.",
    });
  };

  const getIdeas = async () => {
    setIdeasBusy(true);
    try {
      const res = await fetch("/api/ai/deck-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          deck_type: deckType || undefined,
          bracket: isCommander ? bracket : undefined,
          hint: theme || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        ideas?: DeckIdea[];
        error?: string;
        code?: string;
        credits?: number | null;
      };
      if (!res.ok || !data.ok || !data.ideas) {
        toast.error(data.error ?? "Couldn't get ideas right now.");
        return;
      }
      if (typeof data.credits === "number") publishCredits(data.credits);
      setIdeas(data.ideas);
    } catch {
      toast.error("Couldn't reach the AI. Try again in a moment.");
    } finally {
      setIdeasBusy(false);
    }
  };

  const applyIdea = (idea: DeckIdea) => {
    setTheme(idea.theme);
    setStyle(idea.style);
    if (!title.trim()) setTitle(idea.title);
    toast.success(`Using “${idea.title}”.`);
  };

  const settle = (outcome: GenerationJobOutcome, slug: string) => {
    if (!outcome.ok || outcome.failures > 0) {
      toast.message(
        outcome.successes > 0
          ? `${outcome.successes} card${outcome.successes === 1 ? "" : "s"} done, ${outcome.failures} failed.`
          : "Generation didn't finish.",
        { description: "Retry the failed steps below — nothing gets generated twice." },
      );
      return;
    }
    toast.success("Deck generated — every card is yours to edit.");
    router.push(`/deck/${slug}`);
  };

  const create = () => {
    if (titleError) {
      setStep(0);
      toast.error(titleError);
      return;
    }
    startCreate(async () => {
      const result = await createDeckAction(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          format,
          visibility,
          cover_url: coverUrl || undefined,
          cover_position: coverUrl ? coverPosition : null,
          deck_type: mode === "ai" && deckType ? deckType : null,
          bracket: mode === "ai" && isCommander ? bracket : null,
        },
        { redirectAfterCreate: false },
      );
      if (!result.ok) {
        const message =
          ("formError" in result && result.formError) ||
          ("fieldErrors" in result && Object.values(result.fieldErrors ?? {})[0]) ||
          "Couldn't create the deck.";
        toast.error(String(message));
        return;
      }
      setCreatedSlug(result.slug);
      if (mode === "import") {
        toast.success("Deck created — paste your decklist to fill it.");
        router.push(`/deck/${result.slug}?import=1`);
        return;
      }
      if (mode === "empty") {
        toast.success("Deck created.");
        router.push(`/deck/${result.slug}`);
        return;
      }
      // AI build: generate INTO the new deck (add-mode) so the user's title,
      // format, type and bracket stick. The runner is DETACHED: as soon as
      // the AI has designed the deck we move to the deck page, which fills
      // in card by card while the global runner keeps painting — a 100-card
      // build no longer parks the user on this screen for ten minutes.
      const outcome = await run(
        {
          kind: "deck",
          deck_id: result.deckId,
          theme: theme.trim() || undefined,
          style: style.trim() || undefined,
          size,
          deck_type: deckType || undefined,
          bracket: isCommander ? bracket : undefined,
        },
        { detach: true },
      );
      if (!outcome.ok) {
        // Planning failed (toast already shown) — the empty deck exists;
        // let the user retry from its page or fix the prompt here.
        return;
      }
      toast.success(`Designed — painting ${size} card${size === 1 ? "" : "s"} in the background.`, {
        description: "They appear on the deck page as they finish. Safe to keep browsing.",
      });
      router.push(`/deck/${result.slug}`);
    });
  };

  const summary = useMemo(
    () => [
      { label: "Name", value: title.trim() || "—" },
      { label: "Format", value: DECK_FORMAT_LABELS[format] },
      { label: "Visibility", value: visibility },
      {
        label: "Build",
        value:
          mode === "ai"
            ? `AI · ${size} card${size === 1 ? "" : "s"}${chosenType ? ` · ${chosenType.label}` : ""}${
                isCommander ? ` · Bracket ${bracket}` : ""
              }${theme ? ` · “${theme}”` : ""}${style ? ` · ${style}` : ""}`
            : mode === "import"
              ? "Import a decklist after creating"
              : "Start empty",
      },
      { label: "Cover", value: coverUrl ? "Uploaded" : mode === "ai" ? "AI paints one (free)" : "None yet" },
    ],
    [title, format, visibility, mode, size, chosenType, isCommander, bracket, theme, style, coverUrl],
  );

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        steps={STEPS.map((s, i) => ({ ...s, hasError: stepHasError(i) }))}
        current={step}
        onStepSelect={(i) => {
          if (i > 0 && titleError) {
            setStep(0);
            toast.error(titleError);
            return;
          }
          setStep(i);
        }}
        isStepEnabled={() => !busy && !creating}
      />

      {step === 0 ? (
        <SurfaceCard className="flex flex-col gap-5 p-6">
          <FieldGroup label="Deck name" error={step > 0 ? titleError ?? undefined : undefined}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g. Gorgon Gaze"
              className={inputClass(false)}
              autoFocus
            />
          </FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Format" helper="Sets the deck size, copy limits and what the AI designs for.">
              <select
                value={format}
                onChange={(e) => {
                  const next = e.target.value as DeckFormat;
                  setFormat(next);
                  setSize((s) => Math.min(s, maxCards));
                }}
                className={inputClass(false)}
              >
                {DECK_FORMAT_VALUES.map((f) => (
                  <option key={f} value={f}>
                    {DECK_FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Visibility">
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Visibility)}
                className={inputClass(false)}
              >
                <option value="public">Public — listed in community decks</option>
                <option value="unlisted">Unlisted — anyone with the link</option>
                <option value="private">Private — only you</option>
              </select>
            </FieldGroup>
          </div>
          <FieldGroup label="Description" helper="Optional — a sentence on what the deck is about.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Petrify everything, then swing with what's left."
              className={textareaClass(false)}
            />
          </FieldGroup>
        </SurfaceCard>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <BuildTile
              active={mode === "ai"}
              disabled={!aiConfigured}
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
              title="Generate with AI"
              body="Pick a deck type and power level; the AI designs and paints every card, plus a free cover."
              onClick={() => setMode("ai")}
            />
            <BuildTile
              active={mode === "import"}
              icon={<FileText className="h-5 w-5" aria-hidden />}
              title="Import a decklist"
              body="Paste from Arena, Moxfield, Archidekt, ManaBox or MTGO after the deck is created."
              onClick={() => setMode("import")}
            />
            <BuildTile
              active={mode === "empty"}
              icon={<SquarePen className="h-5 w-5" aria-hidden />}
              title="Start empty"
              body="Add real cards and your own creations one by one."
              onClick={() => setMode("empty")}
            />
          </div>

          {mode === "ai" ? (
            <SurfaceCard className="flex flex-col gap-5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                  <Wand2 className="h-4 w-4 text-accent" aria-hidden />
                  AI deck builder
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={surprise} disabled={busy}>
                    <Dices className="h-4 w-4" aria-hidden />
                    Surprise me
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void getIdeas()} disabled={busy || ideasBusy}>
                    {ideasBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lightbulb className="h-4 w-4" aria-hidden />}
                    Get theme ideas · 1 credit
                  </Button>
                </div>
              </div>

              {ideas ? (
                <div className="grid gap-2 sm:grid-cols-3" role="list" aria-label="Deck ideas">
                  {ideas.map((idea) => (
                    <button
                      key={idea.title}
                      type="button"
                      role="listitem"
                      onClick={() => applyIdea(idea)}
                      className="flex flex-col gap-1 rounded-lg border border-border/60 bg-elevated/40 p-3 text-left text-xs transition-colors hover:border-primary-bright/60"
                    >
                      <span className="font-display text-sm font-semibold text-foreground">{idea.title}</span>
                      <span className="text-muted">{idea.theme}</span>
                      <span className="italic text-subtle">{idea.pitch}</span>
                      <span className="text-[11px] uppercase tracking-wider text-primary-bright">{idea.style}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldGroup
                  label="Deck type"
                  helper={chosenType ? `Colour identity: ${describeColors(chosenType.colors)}.` : "A tribe or archetype the AI builds around — it sets the colours."}
                >
                  <select value={deckType} onChange={(e) => setDeckType(e.target.value)} className={inputClass(false)} disabled={busy}>
                    <option value="">Let the AI decide</option>
                    <optgroup label="Tribes">
                      {DECK_TYPES.filter((t) => t.kind === "tribe").map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label} · {t.colors.length ? t.colors.join("") : "C"}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Archetypes">
                      {DECK_TYPES.filter((t) => t.kind === "archetype").map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label} · {t.colors.join("")}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </FieldGroup>
                {isCommander ? (
                  <FieldGroup
                    label="Power bracket"
                    helper={COMMANDER_BRACKETS.find((b) => b.level === bracket)?.blurb}
                  >
                    <select value={bracket} onChange={(e) => setBracket(Number(e.target.value))} className={inputClass(false)} disabled={busy}>
                      {COMMANDER_BRACKETS.map((b) => (
                        <option key={b.level} value={b.level}>
                          {b.level} · {b.name}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                ) : (
                  <FieldGroup label="Power bracket" helper="Brackets are a Commander system; other formats are built to their usual competitive level.">
                    <input value="Commander only" readOnly className={cn(inputClass(false), "text-subtle")} />
                  </FieldGroup>
                )}
              </div>

              <FieldGroup label="Theme" helper="What the deck is about — a world, a faction, a vibe. Leave empty to let the type lead.">
                <input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. a petrified garden tended by the last Gorgon queen"
                  className={inputClass(false)}
                  disabled={busy}
                />
              </FieldGroup>
              <FieldGroup label="Art style" helper="Applied to every card's art and the cover.">
                <StylePicker value={style} onChange={setStyle} disabled={busy} />
              </FieldGroup>
              <BatchSizeField
                value={size}
                onChange={setSize}
                max={maxCards}
                disabled={busy}
                presets={[
                  { label: "10", value: 10 },
                  { label: "25", value: 25 },
                  { label: `Full deck (${fullSize})`, value: Math.min(fullSize, maxCards) },
                ]}
              />

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border/60 bg-elevated/30 px-4 py-3">
                <Lock className="h-4 w-4 text-subtle" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">Creativity</span>
                  <span className="text-xs text-muted">
                    How far the AI strays from the usual — new mechanics, unusual angles.
                  </span>
                </div>
                <Badge variant="gold">Coming soon</Badge>
              </div>

              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Coins className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
                <span className="font-medium text-gold-strong">
                  Uses {size} credit{size === 1 ? "" : "s"}
                </span>
                (1 per card · cover art is free) · cards publish with the deck&apos;s visibility
              </p>
            </SurfaceCard>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <SurfaceCard className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Cover art</h2>
            <p className="text-sm leading-6 text-muted">
              {mode === "ai"
                ? "Optional — leave it empty and the AI paints a matching cover for free. Upload one to use your own."
                : "Optional — drag the image to set its focal point. Every deck surface shows the cover at 16:9."}
            </p>
          </div>
          <CoverField
            userId={userId}
            value={coverUrl}
            onChange={(next) => {
              setCoverUrl(next);
              setCoverPosition(null);
            }}
            position={coverPosition}
            onPositionChange={setCoverPosition}
          />
        </SurfaceCard>
      ) : null}

      {step === 3 ? (
        <SurfaceCard className="flex flex-col gap-5 p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Ready to forge</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {summary.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{row.label}</dt>
                <dd className={cn("text-sm text-foreground", row.label === "Visibility" && "capitalize")}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {mode === "ai" && (busy || phase === "done") ? (
            <GenerationProgress
              steps={steps}
              phase={phase}
              onRetryStep={(key) => void retryStep(key).then((o) => createdSlug && settle(o, createdSlug))}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!busy && hasFailures && createdSlug ? (
              <Button type="button" variant="secondary" onClick={() => void retryFailed().then((o) => settle(o, createdSlug))}>
                Retry failed cards
              </Button>
            ) : null}
            {createdSlug && !busy ? (
              <Button asChild variant="outline">
                <Link href={`/deck/${createdSlug}`}>
                  Open deck
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            ) : null}
            {!createdSlug ? (
              <Button type="button" onClick={create} disabled={creating || busy}>
                {creating || busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {phase === "planning" ? "Designing deck…" : phase === "stepping" ? "Painting cards…" : "Creating…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden />
                    {mode === "ai" ? "Create & generate" : "Create deck"}
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </SurfaceCard>
      ) : null}

      {!createdSlug ? (
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy || creating}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Next
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BuildTile({
  active,
  disabled = false,
  icon,
  title,
  body,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "AI generation isn't configured on this deployment" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        active ? "border-primary-bright/60 bg-primary/10" : "border-border/60 bg-surface hover:border-border-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg", active ? "bg-primary/20 text-primary-bright" : "bg-elevated text-muted")}>
        {icon}
      </span>
      <span className="font-display text-base font-semibold text-foreground">{title}</span>
      <span className="text-xs leading-5 text-muted">{body}</span>
    </button>
  );
}
