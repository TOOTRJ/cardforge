"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Paintbrush, Play, Sparkles } from "lucide-react";
import { ReartCardWordsDialog } from "./reart-card-words-dialog";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { BulkProgress } from "@/components/tools/bulk-customize/bulk-progress";
import { useBulkRunner } from "@/components/tools/bulk-customize/use-bulk-runner";
import { remainingCapacity, type CardCapacity } from "@/lib/billing/capacity-copy";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";
import { trackToolEvent } from "@/lib/tools/track-client";
import {
  EMPTY_REART_STYLE,
  REART_DEFAULT_MODEL,
  REART_DEFAULT_VISIBILITY,
  REART_MODELS,
  REART_SAMPLE_MAX,
  REART_SCOPE_HINTS,
  REART_SCOPE_LABELS,
  REART_SCOPE_VALUES,
  REART_TOOL_SLUG,
  REART_VISIBILITY_VALUES,
  buildReartPrompt,
  normalizeReartStyle,
  reartModelLabel,
  reartModelOf,
  reartRunMode,
  reartRunOutcome,
  reartStateCountsInStyle,
  reartStateIsSettled,
  reartStyleProblem,
  sameReartStyle,
  sameReartStyleFields,
  scopeTakes,
  suggestReartSample,
  type ReartRunInput,
  type ReartScope,
  type NormalReartStyle,
  type ReartModelId,
  type ReartStudioEntry,
  type ReartVisibility,
} from "@/lib/tools/re-art/model";
import { restoreReartArtAction, saveReartStyleAction } from "@/lib/tools/re-art/actions";
import type { ReartRun, StoredReartStyle } from "@/lib/tools/re-art/server";
import { ReartStylePanel } from "./reart-style-panel";
import { ReartConfirmDialog } from "./reart-confirm-dialog";
import { ReartCardGrid, type ReartGridFilter } from "./reart-card-grid";
import { ReartRunList } from "./reart-run-list";

// ---------------------------------------------------------------------------
// The Re-art studio for one deck: (1) the deck's style, (2) a sample of a
// few cards to judge it, (3) the whole deck — each priced in the confirm
// before anything is charged — then each card on its own (re-roll, paint
// one, put its old art back). A run goes through Bulk Customize's runner
// (the AI jobs' one step door) and its progress panel; the page behind is
// refreshed as cards land.
//
// The runner lives in the browser, so what a run came to is the studio's to
// say (the tool's log, lib/tools/track-client.ts trackToolEvent):
// `run_finished` each time the runner ends — painted, failed, credits
// really charged, why it stopped — and the maker's `stop`, `continue` and
// `retry`. Numbers and codes only.
// ---------------------------------------------------------------------------

const VISIBILITY_LABELS: Record<ReartVisibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

/** How often the cards behind a running batch are re-read. */
const REFRESH_EVERY_MS = 8_000;

type Confirm = { title: string; description: string; input: ReartRunInput };

/** A stored style as the form holds it (no version). */
const styleOf = (stored: StoredReartStyle): NormalReartStyle => ({
  preset: stored.preset,
  theme: stored.theme,
  mode: stored.mode,
  prompt: stored.prompt,
});

export function ReartStudio({
  deck,
  storedStyle,
  entries,
  username,
  capacity,
  balance,
  aiAvailable,
  canPickModel = false,
  pausedRunId,
  runs,
}: {
  deck: { id: string; slug: string; title: string };
  storedStyle: StoredReartStyle | null;
  entries: ReartStudioEntry[];
  username: string | null;
  capacity: CardCapacity | null;
  balance: number | null;
  aiAvailable: boolean;
  /** The viewer may name the model that paints (admins and testers —
   *  canPickReartModel; the server holds the same rule). Absent: the picker
   *  isn't shown and every run is Automatic. */
  canPickModel?: boolean;
  pausedRunId: string | null;
  runs: ReartRun[];
}) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [savedStyle, setSavedStyle] = useState<StoredReartStyle | null>(storedStyle);
  const [style, setStyle] = useState<NormalReartStyle>(storedStyle ? styleOf(storedStyle) : EMPTY_REART_STYLE);
  /** The card whose own words are being written (0209). */
  const [wordsEntry, setWordsEntry] = useState<ReartStudioEntry | null>(null);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The form paints another LOOK than the deck's saved one (or none is
   *  saved): a run in it starts a new version, and one card can't be
   *  painted until it is saved. */
  const lookChanged = !savedStyle || !sameReartStyle(savedStyle, style);
  /** The form holds something to save: another look, or the OTHER mode's
   *  draft (a prompt written and then left for the template — the same
   *  look, but it was dropped on a reload). */
  const dirty = !savedStyle || !sameReartStyleFields(savedStyle, style);
  const problem = reartStyleProblem(style);

  const paintable = useMemo(() => entries.filter((entry) => entry.kind !== "skip"), [entries]);
  const [sample, setSample] = useState<Set<string>>(
    () =>
      new Set(
        suggestReartSample(
          // Settled cards last: a sample is a named paint, and a card that
          // was given its own art back — or other art since — is someone's
          // choice, never a default pick.
          paintable.map((entry) => ({ id: entry.id, board: entry.board, bucket: entry.bucket, inStyle: reartStateIsSettled(entry.state) })),
        ),
      ),
  );
  const [scope, setScope] = useState<ReartScope>("all");
  const [visibility, setVisibility] = useState<ReartVisibility>(REART_DEFAULT_VISIBILITY);
  /** The model that paints the next run (for testing; 0211). Not part of
   *  the deck's style: cards painted by any model are in the same style. */
  const [pickedModel, setModel] = useState<ReartModelId>(REART_DEFAULT_MODEL);
  const model: ReartModelId = canPickModel ? pickedModel : REART_DEFAULT_MODEL;
  const picked = reartModelOf(model);
  const [filter, setFilter] = useState<ReartGridFilter>("all");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [job, setJob] = useState<GenerationJobView | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const runner = useBulkRunner(job);
  const progressRef = useRef<HTMLHeadingElement>(null);

  // A sample entry that left the deck drops out of the sample.
  const sampleIds = useMemo(() => [...sample].filter((id) => paintable.some((entry) => entry.id === id)), [sample, paintable]);
  /** A sample card that shows a picture Re-art painted: painting it again
   *  replaces that picture for good (the sample's confirm says so). */
  const sampleReplacesReart = useMemo(
    () => paintable.some((entry) => entry.artNow === "reart" && sampleIds.includes(entry.id)),
    [paintable, sampleIds],
  );
  /** A sample that holds a real card MAKES a card of the maker's own. */
  const sampleMakesCards = useMemo(
    () => paintable.some((entry) => entry.kind === "printing" && sampleIds.includes(entry.id)),
    [paintable, sampleIds],
  );

  const inStyle = paintable.filter((entry) => reartStateCountsInStyle(entry.state)).length;
  /** Painted in this style and showing other art now: a run over the deck
   *  leaves them as they are (a re-roll paints one). */
  const otherArtNow = paintable.filter((entry) => scopeTakes(scope, entry.kind) && entry.state === "changed").length;
  const paintedInSaved = paintable.filter((entry) => entry.state === "in_style").length;
  /** As the list's "Left as they are" filter counts them: the cards a run
   *  never paints, and the ones that show other art now. */
  const leftAsTheyAre = entries.length - paintable.length + paintable.filter((entry) => entry.state === "changed").length;
  const toPaint = lookChanged
    ? paintable.filter((entry) => scopeTakes(scope, entry.kind)).length
    : paintable.filter((entry) => scopeTakes(scope, entry.kind) && !reartStateIsSettled(entry.state)).length;
  const slots = capacity ? remainingCapacity(capacity) : null;

  // One card's whole prompt as the form's style would send it — the first
  // card a run would paint, built by the function the step paints with.
  const promptPreview = useMemo(() => {
    // A card painted from the DECK's prompt: one with no words of its own,
    // else one whose words stand in it — never one that uses only its own
    // words (its prompt shows nothing of the deck's) unless every card does.
    const card = paintable.find((entry) => !entry.words) ?? paintable.find((entry) => !entry.words?.only) ?? paintable[0];
    if (!card) return null;
    const built = buildReartPrompt(
      { title: card.name, typeLine: card.typeLine, rulesText: card.rulesText, flavorText: card.flavorText },
      style,
      card.words,
      // In the wording the picked model is sent.
      picked.framing,
    );
    return {
      name: card.name,
      prompt: built.prompt,
      // Longer than a picture's prompt can be: its end is left out.
      cut: built.cut,
      // A real card's text isn't known here: it is read when it is painted.
      partial: card.kind === "printing",
    };
  }, [paintable, style, picked.framing]);

  const doneCount = runner.steps.filter((s) => s.status === "done").length;
  const failedCount = runner.steps.filter((s) => s.status === "failed").length;
  const total = runner.steps.length;
  const settled = job !== null && !runner.running && doneCount + failedCount === total;
  const paused = job !== null && !runner.running && runner.paused && !settled;
  const running = job !== null && runner.running;
  useLeaveWarning(running);

  // The cards behind the run: re-read as they land (at most every few
  // seconds) and once more when a run ends.
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (!running || doneCount === 0) return;
    if (Date.now() - lastRefresh.current < REFRESH_EVERY_MS) return;
    lastRefresh.current = Date.now();
    router.refresh();
  }, [doneCount, running, router]);
  useEffect(() => {
    if (runner.runsEnded > 0) router.refresh();
  }, [runner.runsEnded, router]);
  useEffect(() => {
    if (runner.stoppedBy === "CARD_CAPACITY") upgrade.open("capacity", "reart_deck");
    if (runner.stoppedBy === "INSUFFICIENT_CREDITS") upgrade.open("credits", "reart_deck");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.stoppedBy]);

  // The run's outcome for the tool's log, once each time the runner ends
  // (after the refresh above, so the page's re-read never waits for it).
  // `passStart` is the job's steps as this pass began: a continued run
  // reports each pass's own cards and credits.
  const passStart = useRef<JobStep[]>([]);
  const reportedPass = useRef<string | null>(null);
  const resumedRun = useRef(false);
  useEffect(() => {
    if (!job || runner.runsEnded === 0) return;
    const pass = `${job.id}:${runner.runsEnded}`;
    if (reportedPass.current === pass) return;
    reportedPass.current = pass;
    const outcome = reartRunOutcome({
      before: passStart.current,
      after: runner.steps,
      retried: runner.runsEnded > 1,
      stoppedBy: runner.stoppedBy,
      error: runner.error !== null,
    });
    passStart.current = runner.steps;
    trackToolEvent(REART_TOOL_SLUG, "run_finished", {
      ...outcome,
      mode: reartRunMode(job.request),
      pass: runner.runsEnded,
      resumed: resumedRun.current,
      // The model the run named (a code from the tool's own list; 0211).
      ...(typeof job.request?.model === "string" ? { model: job.request.model } : {}),
    });
    // Only the end of a pass reports; the values are that render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.runsEnded]);

  const begin = (next: GenerationJobView, left: Array<{ name: string; reason: string }>, resumed = false) => {
    passStart.current = next.steps;
    reportedPass.current = null;
    resumedRun.current = resumed;
    setConfirmOpen(false);
    setSkipped(left);
    setJob(next);
    // The run's own heading takes the focus once it is on screen.
    requestAnimationFrame(() => progressRef.current?.focus());
  };

  const saveStyle = () => {
    setSaveError(null);
    startSaving(async () => {
      const result = await saveReartStyleAction(deck.id, style);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSavedStyle({ ...result.style, version: result.version });
      setStyle(result.style);
      toast.success("Style saved for this deck.");
      router.refresh();
    });
  };

  const openConfirm = (next: Confirm) => {
    setConfirm(next);
    setConfirmOpen(true);
  };

  const sampleBlocked = problem ?? (sampleIds.length === 0 ? "Tick “In the sample” on a card or two first." : null);
  const deckBlocked =
    problem ??
    (toPaint === 0
      ? otherArtNow > 0
        ? "No card is waiting to be painted. A card that has other art now is left as it is: re-roll it to paint it."
        : "Every card here is in the deck's style already."
      : null);
  const lockedReason = running ? "Wait for the run to finish." : null;

  // One card is painted in the deck's SAVED style (a one-card run names no
  // style: sending the form's would make it the deck's and put every other
  // card out of style). So while the form shows a style that isn't saved,
  // one-card paints wait — they used to paint in the saved one without a
  // word.
  const paintBlocked = !savedStyle
    ? "Save the deck's style first: one card is painted in the saved style."
    : lookChanged
      ? "You changed the style. Save it or undo your changes first: one card is painted in the deck's saved style."
      : null;

  const paintOne = (entry: ReartStudioEntry) => {
    if (running || busy) return;
    if (paintBlocked) {
      toast.error(paintBlocked);
      return;
    }
    // EVERY one-card paint goes through the confirm, which prices it and
    // charges nothing until Paint is pressed. A real card's price (and its
    // card slot) is only known once its printing is read; the maker's own
    // card used to be charged the moment its link was pressed — and a
    // re-roll replaces a picture that can't be brought back.
    const description =
      entry.kind === "printing"
        ? "It becomes your own card, painted in the deck's saved style."
        : entry.artNow === "reart"
          ? "This replaces the picture Re-art painted on it, and that picture can't be brought back."
          : entry.artNow === "own"
            ? "Your card gets new art in the deck's saved style. The art it has now can be put back from this page."
            : // No art, or not known (the other decks couldn't be asked):
              // nothing is promised either way.
              "Your card gets new art in the deck's saved style.";
    openConfirm({
      title: `${entry.state ? "Re-roll" : "Paint"} ${entry.name}`,
      description: `${description} Nothing is charged until you press Paint.`,
      input: { deckId: deck.id, entryIds: [entry.id], scope: "all", visibility, model },
    });
  };

  const restore = (entry: ReartStudioEntry) => {
    if (running || busy || !entry.card) return;
    setBusy(entry.id);
    void restoreReartArtAction(deck.id, entry.card.id)
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`${entry.name} has its old art back.`);
        router.refresh();
      })
      .catch(() => toast.error("We couldn't reach PipGlyph — try again."))
      .finally(() => setBusy(null));
  };

  const continuePaused = async () => {
    if (!pausedRunId || running) return;
    const response = await fetch(`/api/ai/jobs/${pausedRunId}`).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { ok?: boolean; job?: GenerationJobView } | null;
    if (!body?.ok || !body.job) {
      toast.error("That run can't be continued — start a new one.");
      return;
    }
    begin(body.job, [], true);
    trackToolEvent(REART_TOOL_SLUG, "continue", { earlier_visit: true });
  };

  // The progress panel's Stop and Continue / Try the failed ones again, said
  // to the tool's log as they are pressed; the runner does what it did.
  const waitingCount = total - doneCount - failedCount;
  const loggedRunner: typeof runner = {
    ...runner,
    stop: () => {
      trackToolEvent(REART_TOOL_SLUG, "stop", { painted: doneCount, failed: failedCount, waiting: waitingCount });
      runner.stop();
    },
    retryFailed: () => {
      trackToolEvent(REART_TOOL_SLUG, paused ? "continue" : "retry", {
        earlier_visit: false,
        failed: failedCount,
        waiting: waitingCount,
      });
      runner.retryFailed();
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/dashboard/tools/re-art-deck"
            className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Another deck
          </Link>
          <h2 className="truncate font-display text-xl font-semibold text-foreground sm:text-2xl">{deck.title}</h2>
          <p className="text-sm tabular-nums text-muted">
            {/* One string: the JSX text after the plural lost its leading
                space ("7 cardsin the deck's style"). */}
            {`${inStyle} of ${paintable.length} card${paintable.length === 1 ? "" : "s"} in the deck's style`}
            {leftAsTheyAre > 0 ? ` · ${leftAsTheyAre} left as ${leftAsTheyAre === 1 ? "it is" : "they are"}` : ""}
          </p>
        </div>
        <Link
          href={`/deck/${deck.slug}`}
          className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          Open the deck
        </Link>
      </div>

      {!aiAvailable ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          AI art isn&apos;t available right now — you can set the style, and paint once it&apos;s back.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ReartStylePanel
            style={style}
            onChange={setStyle}
            dirty={dirty}
            saved={Boolean(savedStyle)}
            saving={saving}
            onSave={saveStyle}
            onReset={
              savedStyle
                ? () => {
                    setStyle(styleOf(savedStyle));
                    setSaveError(null);
                  }
                : undefined
            }
            preview={promptPreview}
            framing={picked.framing}
            problem={problem}
            saveError={saveError}
            // Only another LOOK repaints the cards painted in the saved one.
            paintedInSaved={lookChanged ? paintedInSaved : 0}
          />

          {canPickModel ? (
          <section aria-labelledby="reart-model" className="flex flex-col gap-3 rounded-frame border border-border/60 bg-surface/50 p-4 sm:p-5">
            <h2 id="reart-model" className="font-display text-lg text-foreground">
              Model <span className="text-sm text-muted">(for testing)</span>
            </h2>
            <FieldGroup
              kind="control"
              label="Painted by"
              helper={`${picked.hint} One credit a picture, whichever model paints.`}
            >
              {(aria) => (
                <ChipGroup
                  ariaLabel="Painted by"
                  ariaDescribedBy={aria["aria-describedby"]}
                  keepCase
                  size="sm"
                  options={REART_MODELS.map((option) => ({ value: option.id, label: option.label, description: option.hint }))}
                  value={model}
                  onChange={setModel}
                />
              )}
            </FieldGroup>
            {picked.framing === "plain" ? (
              <p className="text-xs text-subtle">
                This model is sent the same prompt in plainer words: no quoted card name and a different closing line.
                The other wording made it paint a card frame with the title in it.
              </p>
            ) : null}
            <p className="text-xs text-subtle">
              The choice is for the next run, the sample and single cards alike. It is not part of the deck&apos;s
              style: each card says who painted it.
            </p>
          </section>
          ) : null}

          <section aria-labelledby="reart-sample" className="flex flex-col gap-3 rounded-frame border border-border/60 bg-surface/50 p-4 sm:p-5">
            <h2 id="reart-sample" className="font-display text-lg text-foreground">
              2. Try it on a few cards
            </h2>
            <p className="text-sm text-muted">
              Paint up to {REART_SAMPLE_MAX} cards first and judge the style before you pay for the whole deck. They are
              saved like any other: a real card becomes your own, your own card gets the new art.
            </p>
            {sampleIds.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {sampleIds.map((id) => {
                  const entry = paintable.find((e) => e.id === id)!;
                  return (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-foreground">{entry.name}</span>
                      <button
                        type="button"
                        data-sample-remove={id}
                        onClick={() => {
                          // The button removes itself: the focus goes to the
                          // next one, else the one before, else the paint button.
                          const at = sampleIds.indexOf(id);
                          const next = sampleIds[at + 1] ?? sampleIds[at - 1] ?? null;
                          setSample((prev) => new Set([...prev].filter((x) => x !== id)));
                          requestAnimationFrame(() => {
                            const target = next
                              ? document.querySelector<HTMLElement>(`[data-sample-remove="${next}"]`)
                              : document.getElementById("reart-paint-sample");
                            target?.focus();
                          });
                        }}
                        className="shrink-0 rounded-sm text-xs text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                      >
                        Remove<span className="sr-only"> {entry.name} from the sample</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p className="text-xs text-subtle">Tick “In the sample” on any card to change the picks.</p>
            {sampleMakesCards ? (
              // The sample is painted before step 3 is reached, and its real
              // cards are saved with the same choice: say which, and where.
              <p className="text-xs text-subtle">
                A real card in the sample becomes your own card, saved{" "}
                <span className="text-foreground">{VISIBILITY_LABELS[visibility].toLowerCase()}</span> — “Show the new
                cards” in step 3 decides it for the sample too, so set it first if you want another.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="reart-paint-sample"
                variant="secondary"
                onClick={() => {
                  if (sampleBlocked || lockedReason) return;
                  openConfirm({
                    title: `Paint ${sampleIds.length} sample card${sampleIds.length === 1 ? "" : "s"}`,
                    description: `The deck's style is saved as it is now.${
                      sampleReplacesReart ? " A picture Re-art painted on a sample card is replaced and can't be brought back." : ""
                    } Nothing is charged until you press Paint.`,
                    input: { deckId: deck.id, style, entryIds: sampleIds, sample: true, scope: "all", visibility, model },
                  });
                }}
                aria-disabled={sampleBlocked || lockedReason ? true : undefined}
                aria-describedby={sampleBlocked || lockedReason ? "reart-sample-blocked" : undefined}
                className={sampleBlocked || lockedReason ? "cursor-not-allowed opacity-60" : undefined}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Paint the sample…
              </Button>
              {sampleBlocked || lockedReason ? (
                <p id="reart-sample-blocked" className="text-xs text-muted">
                  {lockedReason ?? sampleBlocked}
                </p>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="reart-deck" className="flex flex-col gap-4 rounded-frame border border-border/60 bg-surface/50 p-4 sm:p-5">
            <h2 id="reart-deck" className="font-display text-lg text-foreground">
              3. Re-art the deck
            </h2>
            <FieldGroup kind="control" label="Cards" helper={REART_SCOPE_HINTS[scope]}>
              {(aria) => (
                <ChipGroup
                  ariaLabel="Cards"
                  ariaDescribedBy={aria["aria-describedby"]}
                  keepCase
                  size="sm"
                  options={REART_SCOPE_VALUES.map((value) => ({ value, label: REART_SCOPE_LABELS[value] }))}
                  value={scope}
                  onChange={setScope}
                />
              )}
            </FieldGroup>
            {scope !== "own" || sampleMakesCards ? (
              // Also while the sample holds a real card: it is saved with
              // this choice, whatever the full run's cards are set to.
              <FieldGroup
                kind="control"
                label="Show the new cards"
                helper="For the real cards that become yours. Cards with strong language are saved private whatever you pick."
              >
                {(aria) => (
                  <ChipGroup
                    ariaLabel="Show the new cards"
                    ariaDescribedBy={aria["aria-describedby"]}
                    keepCase
                    size="sm"
                    options={REART_VISIBILITY_VALUES.map((value) => ({ value, label: VISIBILITY_LABELS[value] }))}
                    value={visibility}
                    onChange={setVisibility}
                  />
                )}
              </FieldGroup>
            ) : null}
            <p className="text-sm tabular-nums text-foreground">
              {toPaint} card{toPaint === 1 ? "" : "s"} to paint
              {!lookChanged && inStyle > 0 ? ` · ${inStyle} in this style already` : ""}
              {!lookChanged && otherArtNow > 0 ? ` · ${otherArtNow} with other art now, left as ${otherArtNow === 1 ? "it is" : "they are"}` : ""}
              {slots !== null ? ` · ${slots} card slot${slots === 1 ? "" : "s"} left` : ""}
              {balance !== null ? ` · ${balance} credit${balance === 1 ? "" : "s"}` : ""}
            </p>
            <p className="text-xs text-muted">
              New art on your own cards shows in every deck that holds them. You can put a card&apos;s old art back from
              here.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  if (deckBlocked || lockedReason) return;
                  openConfirm({
                    title: `Re-art ${deck.title}`,
                    description: "The deck's style is saved as it is now. Nothing is charged until you press Paint.",
                    input: { deckId: deck.id, style, scope, visibility, model },
                  });
                }}
                aria-disabled={deckBlocked || lockedReason ? true : undefined}
                aria-describedby={deckBlocked || lockedReason ? "reart-deck-blocked" : undefined}
                className={deckBlocked || lockedReason ? "cursor-not-allowed opacity-60" : undefined}
              >
                <Paintbrush className="h-4 w-4" aria-hidden />
                Re-art the deck…
              </Button>
              {deckBlocked || lockedReason ? (
                <p id="reart-deck-blocked" className="text-xs text-muted">
                  {lockedReason ?? deckBlocked}
                </p>
              ) : null}
            </div>
            {pausedRunId && !job ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                <span className="mr-auto">A run of this deck stopped with cards still to paint.</span>
                <Button variant="outline" size="sm" onClick={() => void continuePaused()}>
                  <Play className="h-4 w-4" aria-hidden />
                  Continue it
                </Button>
              </div>
            ) : null}
          </section>

          {job ? (
            <section aria-labelledby="reart-progress" className="flex flex-col gap-3 rounded-frame border border-primary/40 bg-surface/60 p-4 sm:p-5">
              <h2 id="reart-progress" ref={progressRef} tabIndex={-1} className="flex items-center gap-2 font-display text-lg text-foreground focus:outline-none">
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {settled ? "The run is done" : paused ? "The run is paused" : "Painting…"}
              </h2>
              <BulkProgress
                runner={loggedRunner}
                total={total}
                doneCount={doneCount}
                failedCount={failedCount}
                settled={settled}
                paused={paused}
                skipped={skipped}
                noun="painted"
                doing="Painting"
                unit="run"
                modelLabel={canPickModel ? reartModelLabel : undefined}
                pausedNote="You can continue it later from this page; the cards painted so far are saved."
                finishedAction={
                  <Button variant="secondary" onClick={() => setJob(null)}>
                    Done
                  </Button>
                }
              />
            </section>
          ) : null}

          {runs.length > 0 ? <ReartRunList runs={runs} /> : null}
        </div>

        <ReartCardGrid
          entries={entries}
          username={username}
          filter={filter}
          onFilter={setFilter}
          sample={new Set(sampleIds)}
          onToggleSample={(id) =>
            setSample((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else if (next.size < REART_SAMPLE_MAX) next.add(id);
              return next;
            })
          }
          busy={busy}
          locked={running}
          paintBlocked={running ? null : paintBlocked}
          onPaintOne={paintOne}
          onEditWords={(entry) => {
            if (running) return;
            setWordsEntry(entry);
            setWordsOpen(true);
          }}
          onRestore={restore}
        />
      </div>

      {wordsEntry ? (
        <ReartCardWordsDialog
          open={wordsOpen}
          onOpenChange={setWordsOpen}
          framing={picked.framing}
          deckId={deck.id}
          entry={wordsEntry}
          style={style}
          onSaved={(words) => {
            setWordsOpen(false);
            // The dialog reopens on what was saved until the page's re-read
            // lands.
            setWordsEntry({ ...wordsEntry, words });
            toast.success(words ? `${wordsEntry.name} has its own words.` : `${wordsEntry.name} is painted from its name and type again.`);
            router.refresh();
          }}
        />
      ) : null}

      {confirm ? (
        <ReartConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          input={confirm.input}
          title={confirm.title}
          description={confirm.description}
          onStarted={(next, left, version) => {
            begin(next, left);
            // The style the run paints in is the deck's now.
            const runStyle = confirm.input.style ? normalizeReartStyle(confirm.input.style) : null;
            if (runStyle) {
              setSavedStyle({ ...runStyle, version });
              setStyle(runStyle);
            }
          }}
        />
      ) : null}
    </div>
  );
}
