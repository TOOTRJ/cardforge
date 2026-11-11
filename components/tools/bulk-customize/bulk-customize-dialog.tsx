"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { PrintingPicture } from "@/components/tools/collection/printing-tile";
import { describeCapacity, remainingCapacity } from "@/lib/billing/capacity-copy";
import { STYLE_PRESETS, SURPRISE_PRESET_ID, TWIST_MAX } from "@/lib/ai/presets";
import type { GenerationJobView } from "@/lib/ai/generation-jobs";
import { cn } from "@/lib/utils";
import {
  BULK_ART_HINTS,
  BULK_ART_LABELS,
  BULK_ART_VALUES,
  BULK_BORDER_LABELS,
  BULK_BORDER_VALUES,
  BULK_EXACT_COPY_REASON,
  BULK_LOOK_HINTS,
  BULK_LOOK_LABELS,
  BULK_LOOK_VALUES,
  BULK_SET_SYMBOL_LABELS,
  BULK_SET_SYMBOL_VALUES,
  BULK_VISIBILITY_VALUES,
  BULK_WATERMARK_VALUES,
  BULK_CUSTOMIZE_TOOL_SLUG,
  DEFAULT_BULK_CHOICES,
  bulkCostLine,
  bulkRunSummary,
  bulkWatermarkLabel,
  choicesChangeSomething,
  type BulkArt,
  type BulkBorder,
  type BulkChoices,
  type BulkLook,
  type BulkSetSymbol,
  type BulkSource,
  type BulkVisibility,
  type BulkWatermark,
} from "@/lib/tools/bulk-customize/model";
import { planCustomizedCard, type BulkPlannedCard } from "@/lib/tools/bulk-customize/planner";
import { trackToolEvent } from "@/lib/tools/track-client";
import {
  prepareBulkCustomizeAction,
  startBulkCustomizeAction,
  type BulkPrepared,
} from "@/lib/tools/bulk-customize/actions";
import { useBulkRunner } from "./use-bulk-runner";
import { BulkProgress } from "./bulk-progress";

// ---------------------------------------------------------------------------
// The Bulk Customize dialog — ONE door for every surface that ticks real
// cards (the collection, a deck's selection, the tool page's search). It
// reads the selection once (prepare), lets the maker pick ONE look and ONE
// art choice for every card, plans and prices every change in the browser
// with the server's own pure planner, and says what the batch costs BEFORE
// anything is made ("Creates 24 cards · 31 slots left · 0 credits"). Create
// starts the job (the server plans and prices it again — it decides), then
// the dialog runs its steps and shows each card land.
// ---------------------------------------------------------------------------

const LOOK_OPTIONS: ChipOption<BulkLook>[] = BULK_LOOK_VALUES.map((value) => ({
  value,
  label: BULK_LOOK_LABELS[value],
  description: BULK_LOOK_HINTS[value],
}));
const BORDER_OPTIONS: ChipOption<BulkBorder>[] = BULK_BORDER_VALUES.map((value) => ({
  value,
  label: BULK_BORDER_LABELS[value],
}));
const SET_SYMBOL_OPTIONS: ChipOption<BulkSetSymbol>[] = BULK_SET_SYMBOL_VALUES.map((value) => ({
  value,
  label: BULK_SET_SYMBOL_LABELS[value],
}));
const WATERMARK_OPTIONS: ChipOption<BulkWatermark>[] = BULK_WATERMARK_VALUES.map((value) => ({
  value,
  label: bulkWatermarkLabel(value),
}));
const STYLE_OPTIONS: ChipOption<string>[] = [
  { value: SURPRISE_PRESET_ID, label: "Painterly (default)" },
  ...STYLE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];
const VISIBILITY_LABELS: Record<BulkVisibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

type Phase = "loading" | "choose" | "running" | "failed";

export type BulkCustomizeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ticked real cards (≤ 100). */
  sources: BulkSource[];
  /** The surface that opened it, for the upgrade prompt's funnel row. */
  surface: "collection" | "deck" | "search";
  /** Called once the batch has run (the opener refreshes its view). */
  onFinished?: () => void;
};

export function BulkCustomizeDialog({ open, onOpenChange, sources, surface, onFinished }: BulkCustomizeDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [prepared, setPrepared] = useState<BulkPrepared | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<BulkChoices>(DEFAULT_BULK_CHOICES);
  const [job, setJob] = useState<GenerationJobView | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [serverSkipped, setServerSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [starting, startTransition] = useTransition();
  const upgrade = useUpgradeModal();
  const upgradeSurface = `bulk_customize_${surface}`;
  const runner = useBulkRunner(job);
  const sourcesKey = sources.map((s) => `${s.kind}:${s.id}`).join(",");

  // Read the selection each time the dialog opens on a new selection (the
  // reset happens during render; the effect only fetches).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const wantKey = open && !job ? sourcesKey : loadedKey;
  if (wantKey !== loadedKey) {
    setLoadedKey(wantKey);
    setPhase("loading");
    setLoadError(null);
    setPrepared(null);
  }
  // One request per selection read: StrictMode runs the effect twice in
  // dev, and each read spends the maker's Scryfall quota.
  const preparing = useRef<{ key: string; request: ReturnType<typeof prepareBulkCustomizeAction> } | null>(null);
  useEffect(() => {
    // Only a reset selection is read (a reopen keeps what it has: no second
    // Scryfall run for the same cards).
    if (!open || job || loadedKey === null || phase !== "loading") return;
    let cancelled = false;
    if (preparing.current?.key !== loadedKey) {
      const request = prepareBulkCustomizeAction(sources);
      preparing.current = { key: loadedKey, request };
      // A finished read is dropped, so a reset of the same selection (a
      // failed read retried) asks again.
      void request
        .finally(() => {
          if (preparing.current?.request === request) preparing.current = null;
        })
        .catch(() => undefined); // the effect below says why
    }
    void preparing.current!.request.then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setPhase("failed");
        return;
      }
      setPrepared(result);
      if (typeof result.credits === "number") publishCredits(result.credits);
      setPhase("choose");
    }, () => {
      // The request itself failed (offline): said, and read again next open.
      if (cancelled) return;
      setLoadError("We couldn't read these cards — check your connection and try again.");
      setPhase("failed");
    });
    return () => {
      cancelled = true;
    };
    // The selection's identity, not the array's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadedKey, phase]);

  const verifiedKeys = useMemo(() => new Set(prepared?.verifiedKeys ?? []), [prepared]);
  const plans = useMemo(() => {
    if (!prepared) return [] as Array<{ key: string; card: BulkPrepared["cards"][number]; plan: BulkPlannedCard }>;
    return prepared.cards.map((card) => ({
      key: card.key,
      card,
      plan: planCustomizedCard({
        patch: card.patch,
        fallbackTitle: card.name,
        scryfallSet: card.scryfallSet,
        choices,
        verifiedKeys,
        removeWatermark: prepared.removeWatermark,
      }),
    }));
  }, [prepared, choices, verifiedKeys]);

  const creates = plans.filter((p) => p.plan.ok).length;
  const credits = plans.reduce((sum, p) => sum + (p.plan.ok ? p.plan.credits : 0), 0);
  const room = prepared?.capacity ? remainingCapacity(prepared.capacity) : null;
  const capacityMessage = prepared ? describeCapacity(prepared.capacity, creates) : null;
  const overCapacity = room !== null && creates > room;
  const shortOfCredits = prepared?.credits !== null && prepared?.credits !== undefined && credits > prepared.credits;
  const changes = choicesChangeSomething(choices);

  const blockReason = !changes
    ? BULK_EXACT_COPY_REASON
    : creates === 0
      ? "None of these cards changes with these choices — pick another look."
      : overCapacity
        ? capacityMessage?.message ?? "Not enough card slots left."
        : shortOfCredits
          ? `This batch costs ${credits} credits and you have ${prepared?.credits ?? 0}.`
          : null;

  const running = phase === "running" && runner.running;
  useLeaveWarning(running);

  const patch = <K extends keyof BulkChoices>(key: K, value: BulkChoices[K]) =>
    setChoices((prev) => ({ ...prev, [key]: value }));

  const start = () => {
    setStartError(null);
    startTransition(async () => {
      const result = await startBulkCustomizeAction({ sources, choices });
      if (!result.ok) {
        setStartError(result.error);
        if (result.code === "CARD_CAPACITY") upgrade.open("capacity", upgradeSurface);
        if (result.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", upgradeSurface);
        return;
      }
      setServerSkipped(result.skipped);
      setJob(result.job);
      setPhase("running");
    });
  };

  // A stop on a plan limit opens the matching prompt once.
  useEffect(() => {
    if (runner.stoppedBy === "CARD_CAPACITY") upgrade.open("capacity", upgradeSurface);
    if (runner.stoppedBy === "INSUFFICIENT_CREDITS") upgrade.open("credits", upgradeSurface);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.stoppedBy]);

  const doneCount = runner.steps.filter((s) => s.status === "done").length;
  const failedCount = runner.steps.filter((s) => s.status === "failed").length;
  const total = runner.steps.length;
  const settled = job !== null && !runner.running && doneCount + failedCount === total;
  // A run that ended with cards still to make (a stop, a limit, a door
  // error): nothing runs, the dialog offers to continue.
  const paused = job !== null && !runner.running && runner.paused && !settled;

  // Every run that ends refreshes the page behind (the cards made so far);
  // the opener's own "finished" waits for the dialog to close.
  useEffect(() => {
    if (runner.runsEnded > 0) onFinished?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.runsEnded]);

  // How each run ended, for the tool's analytics (`run_finished`): the
  // browser runs the steps, so only here is a run known to be over. Once a
  // run — the cards it made, the credits it really spent, why it stopped;
  // counts and codes, never a card's name. Best effort.
  const runTotals = useRef<{ jobId: string | null; made: number; credits: number }>({ jobId: null, made: 0, credits: 0 });
  useEffect(() => {
    if (runner.runsEnded === 0 || !job) return;
    const { props, totals } = bulkRunSummary(
      { steps: runner.steps, stoppedBy: runner.stoppedBy, error: runner.error, paused: runner.paused, run: runner.runsEnded },
      runTotals.current.jobId === job.id ? runTotals.current : undefined,
    );
    runTotals.current = { jobId: job.id, ...totals };
    trackToolEvent(BULK_CUSTOMIZE_TOOL_SLUG, "run_finished", { ...props, art: choices.art, surface });
    // Only a run's end records it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.runsEnded]);

  const close = (next: boolean) => {
    if (!next && running) return; // the leave warning's job; the X waits
    onOpenChange(next);
    // A selection that couldn't be read is read again on the next open.
    if (!next && phase === "failed") setLoadedKey(null);
    if (!next && (settled || paused)) {
      // A finished batch is gone; the next open starts fresh.
      setJob(null);
      setPrepared(null);
      setLoadedKey(null);
      setChoices(DEFAULT_BULK_CHOICES);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="xl" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {job ? (settled ? "Your cards are ready" : paused ? "The batch is paused" : "Making your cards") : `Customize ${sources.length} card${sources.length === 1 ? "" : "s"}`}
          </DialogTitle>
          <DialogDescription>
            {job
              ? settled || paused
                ? "Each card is saved as your own. Close this to get back to your cards."
                : "Each card is saved as your own as it is made. Keep this open until it's done."
              : "One look and one art choice for every card. Nothing is made until you press Create."}
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Reading the cards…
          </p>
        ) : phase === "failed" ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {loadError}
          </p>
        ) : job ? (
          <BulkProgress
            runner={runner}
            total={total}
            doneCount={doneCount}
            failedCount={failedCount}
            settled={settled}
            paused={paused}
            skipped={serverSkipped}
          />
        ) : prepared ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-labelledby="bulk-look" className="flex flex-col gap-4">
                <h3 id="bulk-look" className="text-sm font-semibold text-foreground">
                  1. One look for all
                </h3>
                <FieldGroup
                  kind="control"
                  label="Frame"
                  helper="A card that can't wear the frame (its colour isn't published yet, or a two-part or double-faced card) keeps its printing's."
                >
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Frame"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={LOOK_OPTIONS}
                      value={choices.look}
                      onChange={(next) => patch("look", next)}
                    />
                  )}
                </FieldGroup>
                <FieldGroup kind="control" label="Border" helper="Only the 1997 and 2003 frames draw a white border.">
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Border"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={BORDER_OPTIONS}
                      value={choices.border}
                      onChange={(next) => patch("border", next)}
                    />
                  )}
                </FieldGroup>
                <FieldGroup
                  kind="control"
                  label="Set symbol"
                  helper="The printing's own symbol where PipGlyph has it."
                >
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Set symbol"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={SET_SYMBOL_OPTIONS}
                      value={choices.setSymbol}
                      onChange={(next) => patch("setSymbol", next)}
                    />
                  )}
                </FieldGroup>
                <FieldGroup
                  kind="control"
                  label="Watermark"
                  helper={
                    prepared.removeWatermark
                      ? undefined
                      : "On your plan, creatures and spells always carry the PipGlyph Rose."
                  }
                >
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Watermark"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={WATERMARK_OPTIONS}
                      value={choices.watermark}
                      onChange={(next) => patch("watermark", next)}
                    />
                  )}
                </FieldGroup>
              </section>

              <section aria-labelledby="bulk-art" className="flex flex-col gap-4">
                <h3 id="bulk-art" className="text-sm font-semibold text-foreground">
                  2. Art
                </h3>
                <FieldGroup kind="control" label="Art" helper={BULK_ART_HINTS[choices.art]}>
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Art"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={BULK_ART_VALUES.map((value) => ({
                        value,
                        label: BULK_ART_LABELS[value as BulkArt],
                        disabled: value === "ai" && !prepared.aiAvailable,
                        description: value === "ai" && !prepared.aiAvailable ? "AI art isn't available right now." : undefined,
                      }))}
                      value={choices.art}
                      onChange={(next) => patch("art", next)}
                    />
                  )}
                </FieldGroup>
                {choices.art === "ai" ? (
                  <FieldGroup kind="group" label="Art style" helper="One credit per picture — two for a double-faced card.">
                    <ChipGroup
                      ariaLabel="Art style"
                      keepCase
                      options={STYLE_OPTIONS}
                      value={choices.artStyle}
                      onChange={(next) => patch("artStyle", next)}
                    />
                    <TwistInput value={choices.artTwist ?? ""} onChange={(next) => patch("artTwist", next || undefined)} />
                  </FieldGroup>
                ) : null}
                <FieldGroup
                  kind="control"
                  label="Show the new cards"
                  helper={
                    choices.art === "later"
                      ? "Cards with no picture are saved private until you add one."
                      : "Cards with strong language are saved private whatever you pick."
                  }
                >
                  {(aria) => (
                    <ChipGroup
                      ariaLabel="Show the new cards"
                      ariaDescribedBy={aria["aria-describedby"]}
                      keepCase
                      options={BULK_VISIBILITY_VALUES.map((value) => ({
                        value,
                        label: VISIBILITY_LABELS[value],
                        disabled: choices.art === "later" && value !== "private",
                      }))}
                      value={choices.art === "later" ? "private" : choices.visibility}
                      onChange={(next) => patch("visibility", next)}
                    />
                  )}
                </FieldGroup>
              </section>
            </div>

            <section aria-labelledby="bulk-cards" className="flex min-w-0 flex-col gap-2">
              <h3 id="bulk-cards" className="text-sm font-semibold text-foreground">
                The cards
              </h3>
              <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
                {plans.map(({ key, card, plan }) => (
                  <li key={key} className="flex items-start gap-3 rounded-md border border-border/50 bg-elevated/30 p-2">
                    <PrintingPicture imageUrl={card.thumbUrl} name={card.name} size="small" className="w-12 shrink-0" />
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="truncate text-sm font-medium text-foreground">{card.name}</p>
                      <p className="truncate text-subtle">
                        {[card.setName, card.collectorNumber ? `#${card.collectorNumber}` : null].filter(Boolean).join(" ")}
                      </p>
                      {plan.ok ? (
                        plan.notes.map((note) => (
                          <p key={note} className="mt-0.5 text-muted">
                            {note}
                          </p>
                        ))
                      ) : changes ? (
                        <p className="mt-0.5 text-warning">Skipped: {plan.message}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
                {prepared.skipped.map((skip) => (
                  <li key={skip.key} className="rounded-md border border-border/40 p-2 text-xs text-muted">
                    <span className="font-medium text-foreground">{skip.name}</span> — skipped: {skip.reason}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}

        {!job && prepared ? (
          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
            <p className="text-sm font-medium tabular-nums text-foreground" aria-live="polite">
              {bulkCostLine({
                creates,
                slotsLeftAfter: room === null ? null : room - creates,
                credits,
              })}
            </p>
            {capacityMessage ? (
              <p className={cn("text-xs", capacityMessage.tone === "danger" ? "text-danger" : "text-warning")}>
                {capacityMessage.message}
              </p>
            ) : null}
            {startError ? (
              <p role="alert" className="text-sm text-danger">
                {startError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {blockReason ? (
                <p id="bulk-create-blocked" className="mr-auto max-w-prose text-xs text-muted">
                  {blockReason}
                </p>
              ) : null}
              {overCapacity ? (
                <Button variant="outline" onClick={() => upgrade.open("capacity", upgradeSurface)}>
                  More card slots
                </Button>
              ) : shortOfCredits ? (
                <Button variant="outline" onClick={() => upgrade.open("credits", upgradeSurface)}>
                  Get credits
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!blockReason && !starting) start();
                }}
                aria-disabled={blockReason || starting ? true : undefined}
                aria-describedby={blockReason ? "bulk-create-blocked" : undefined}
                className={cn((blockReason || starting) && "cursor-not-allowed opacity-60")}
              >
                {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Create {creates} card{creates === 1 ? "" : "s"}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TwistInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        Your twist on the style <span className="text-subtle">(optional)</span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={TWIST_MAX}
        onChange={(event) => onChange(event.target.value.slice(0, TWIST_MAX))}
        placeholder="e.g. moody candlelight, muted greens"
        className={inputClass(false)}
      />
    </div>
  );
}
