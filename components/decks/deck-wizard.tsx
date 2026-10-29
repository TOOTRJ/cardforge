"use client";

// ---------------------------------------------------------------------------
// DeckWizard — the one way to start a deck (/dashboard/decks/new). Four
// steps on the same Stepper the card creator uses:
//
//   1 Basics   title, format, visibility, description
//   2 Build    how the cards arrive: Import a decklist (the default) or
//              Start empty — "Generate with AI" is "Coming soon"
//   3 Cover    upload with a focal point
//   4 Review   summary → Create deck
//
// AI deck building is paused while decks are rebuilt (owner 2026-10-28,
// TODO DK1, lib/ai/deck-ai-pause.ts): the AI build tile is greyed and its
// builder (deck type, bracket, theme ideas, style, size) was removed; the
// jobs route refuses a new deck build as well. `initialFormat` is the
// format hub's "Build a <format> deck" (`?format=` on the page).
// ---------------------------------------------------------------------------

import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FileText, Loader2, Plus, Sparkles, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { FieldGroup, inputClass, textareaClass } from "@/components/creator/field-group";
import { CoverField } from "@/components/decks/deck-creator-form";
import { ComingSoonBadge, ComingSoonSuffix } from "@/components/decks/deck-ai-coming-soon";
import { createDeckAction } from "@/lib/decks/actions";
import { DECK_AI_PAUSED_MESSAGE } from "@/lib/ai/deck-ai-pause";
import { cn } from "@/lib/utils";
import {
  DECK_FORMAT_LABELS,
  DECK_FORMAT_VALUES,
  type DeckCoverPosition,
  type DeckFormat,
} from "@/types/deck";
import type { Visibility } from "@/types/card";

type BuildMode = "import" | "empty";

const STEPS: StepperStep[] = [
  { key: "basics", label: "Basics", description: "Name and format" },
  { key: "build", label: "Build", description: "Import or start empty" },
  { key: "cover", label: "Cover", description: "Optional artwork" },
  { key: "review", label: "Review", description: "Create the deck" },
];

export function DeckWizard({
  userId,
  initialFormat = "commander",
}: {
  userId: string;
  /** The format picked on arrival (the format hub's link). */
  initialFormat?: DeckFormat;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Basics
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<DeckFormat>(initialFormat);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [description, setDescription] = useState("");

  // Build
  const [mode, setMode] = useState<BuildMode>("import");

  // Cover
  const [coverUrl, setCoverUrl] = useState("");
  const [coverPosition, setCoverPosition] = useState<DeckCoverPosition | null>(null);

  // Create
  const [creating, startCreate] = useTransition();
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);

  const titleError = title.trim().length < 3 ? "Give the deck a name (3+ characters)." : null;
  const stepHasError = (i: number) => i === 0 && step > 0 && Boolean(titleError);

  const goNext = () => {
    if (step === 0 && titleError) {
      toast.error(titleError);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
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
        },
        { redirectAfterCreate: false, surface: "wizard" },
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
      toast.success("Deck created.");
      router.push(`/deck/${result.slug}`);
    });
  };

  const summary = useMemo(
    () => [
      { label: "Name", value: title.trim() || "—" },
      { label: "Format", value: DECK_FORMAT_LABELS[format] },
      { label: "Visibility", value: visibility },
      { label: "Build", value: mode === "import" ? "Import a decklist after creating" : "Start empty" },
      { label: "Cover", value: coverUrl ? "Uploaded" : "None yet" },
    ],
    [title, format, visibility, mode, coverUrl],
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
        isStepEnabled={() => !creating}
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
            <FieldGroup label="Format" helper="Sets the deck size and copy limits.">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as DeckFormat)}
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
        <div className="grid gap-3 sm:grid-cols-3">
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
          <BuildTile
            active={false}
            comingSoon
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="Generate with AI"
            body={DECK_AI_PAUSED_MESSAGE}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <SurfaceCard className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Cover art</h2>
            <p className="text-sm leading-6 text-muted">
              Optional — drag the image to set its focal point. Every deck surface shows the cover at 16:9.
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {createdSlug ? (
              <Button asChild variant="outline">
                <Link href={`/deck/${createdSlug}`}>
                  Open deck
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button type="button" onClick={create} disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" aria-hidden />
                    Create deck
                  </>
                )}
              </Button>
            )}
          </div>
        </SurfaceCard>
      ) : null}

      {!createdSlug ? (
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || creating}>
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

/** One build choice. A `comingSoon` tile is greyed: `aria-disabled`, still
 *  reachable, no click handler (TODO DK1.1); its name is its title "— coming
 *  soon" and its visible body (the reason) is its description. */
function BuildTile({
  active,
  comingSoon = false,
  icon,
  title,
  body,
  onClick,
}: {
  active: boolean;
  comingSoon?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick?: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={comingSoon || undefined}
      aria-labelledby={comingSoon ? `${id}-title` : undefined}
      aria-describedby={comingSoon ? `${id}-body` : undefined}
      onClick={comingSoon ? undefined : onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        active ? "border-primary-bright/60 bg-primary/10" : "border-border/60 bg-surface hover:border-border-strong",
        comingSoon && "cursor-not-allowed border-dashed opacity-70 hover:border-border/60",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-lg",
            active ? "bg-primary/20 text-primary-bright" : "bg-elevated text-muted",
          )}
        >
          {icon}
        </span>
        {comingSoon ? <ComingSoonBadge /> : null}
      </span>
      <span id={`${id}-title`} className="font-display text-base font-semibold text-foreground">
        {title}
        {comingSoon ? <ComingSoonSuffix /> : null}
      </span>
      <span id={`${id}-body`} className="text-xs leading-5 text-muted">
        {body}
      </span>
    </button>
  );
}
