"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Paintbrush, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { BulkProgress } from "@/components/tools/bulk-customize/bulk-progress";
import { useBulkRunner } from "@/components/tools/bulk-customize/use-bulk-runner";
import { remainingCapacity, type CardCapacity } from "@/lib/billing/capacity-copy";
import type { GenerationJobView } from "@/lib/ai/generation-jobs";
import {
  EMPTY_REART_STYLE,
  REART_SAMPLE_MAX,
  REART_SCOPE_HINTS,
  REART_SCOPE_LABELS,
  REART_SCOPE_VALUES,
  REART_VISIBILITY_VALUES,
  normalizeReartStyle,
  reartStyleProblem,
  sameReartStyle,
  scopeTakes,
  suggestReartSample,
  type ReartRunInput,
  type ReartScope,
  type ReartStudioEntry,
  type ReartStyle,
  type ReartVisibility,
} from "@/lib/tools/re-art/model";
import { restoreReartArtAction, saveReartStyleAction, startReartAction } from "@/lib/tools/re-art/actions";
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
// ---------------------------------------------------------------------------

const VISIBILITY_LABELS: Record<ReartVisibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

/** How often the cards behind a running batch are re-read. */
const REFRESH_EVERY_MS = 8_000;

type Confirm = { title: string; description: string; input: ReartRunInput };

export function ReartStudio({
  deck,
  storedStyle,
  entries,
  username,
  capacity,
  balance,
  aiAvailable,
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
  pausedRunId: string | null;
  runs: ReartRun[];
}) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [savedStyle, setSavedStyle] = useState<StoredReartStyle | null>(storedStyle);
  const [style, setStyle] = useState<ReartStyle>(storedStyle ? { preset: storedStyle.preset, theme: storedStyle.theme } : EMPTY_REART_STYLE);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = !savedStyle || !sameReartStyle(savedStyle, style);
  const problem = reartStyleProblem(style);

  const paintable = useMemo(() => entries.filter((entry) => entry.kind !== "skip"), [entries]);
  const [sample, setSample] = useState<Set<string>>(
    () =>
      new Set(
        suggestReartSample(
          paintable.map((entry) => ({ id: entry.id, board: entry.board, bucket: entry.bucket, inStyle: entry.state === "in_style" })),
        ),
      ),
  );
  const [scope, setScope] = useState<ReartScope>("all");
  const [visibility, setVisibility] = useState<ReartVisibility>("public");
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

  const inStyle = paintable.filter((entry) => entry.state === "in_style" || entry.state === "kept").length;
  const paintedInSaved = paintable.filter((entry) => entry.state === "in_style").length;
  const toPaint = dirty
    ? paintable.filter((entry) => scopeTakes(scope, entry.kind)).length
    : paintable.filter((entry) => scopeTakes(scope, entry.kind) && entry.state !== "in_style" && entry.state !== "kept").length;
  const slots = capacity ? remainingCapacity(capacity) : null;

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

  const begin = (next: GenerationJobView, left: Array<{ name: string; reason: string }>) => {
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
  const deckBlocked = problem ?? (toPaint === 0 ? "Every card here is in the deck's style already." : null);
  const lockedReason = running ? "Wait for the run to finish." : null;

  const paintOne = (entry: ReartStudioEntry) => {
    if (running || busy) return;
    if (!savedStyle) {
      toast.error("Save the deck's style first.");
      return;
    }
    // A real card's price (and its card slot) is only known once its
    // printing is read: it goes through the confirm, which prices it.
    if (entry.kind === "printing") {
      openConfirm({
        title: `Paint ${entry.name}`,
        description: "It becomes your own card, painted in the deck's saved style. Nothing is charged until you press Paint.",
        input: { deckId: deck.id, entryIds: [entry.id], scope: "all", visibility },
      });
      return;
    }
    setBusy(entry.id);
    void startReartAction({ deckId: deck.id, entryIds: [entry.id], scope: "all", visibility })
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error);
          if (result.code === "CARD_CAPACITY") upgrade.open("capacity", "reart_deck");
          if (result.code === "INSUFFICIENT_CREDITS") upgrade.open("credits", "reart_deck");
          return;
        }
        begin(result.job, result.skipped);
      })
      .catch(() => toast.error("We couldn't reach PipGlyph — try again."))
      .finally(() => setBusy(null));
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
    begin(body.job, []);
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
            {inStyle} of {paintable.length} card{paintable.length === 1 ? "" : "s"} in the deck&apos;s style
            {entries.length > paintable.length ? ` · ${entries.length - paintable.length} left as they are` : ""}
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
            problem={problem}
            saveError={saveError}
            paintedInSaved={paintedInSaved}
          />

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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="reart-paint-sample"
                variant="secondary"
                onClick={() => {
                  if (sampleBlocked || lockedReason) return;
                  openConfirm({
                    title: `Paint ${sampleIds.length} sample card${sampleIds.length === 1 ? "" : "s"}`,
                    description: "The deck's style is saved as it is now. Nothing is charged until you press Paint.",
                    input: { deckId: deck.id, style, entryIds: sampleIds, sample: true, scope: "all", visibility },
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
            {scope !== "own" ? (
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
              {!dirty && inStyle > 0 ? ` · ${inStyle} in this style already` : ""}
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
                    input: { deckId: deck.id, style, scope, visibility },
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
                runner={runner}
                total={total}
                doneCount={doneCount}
                failedCount={failedCount}
                settled={settled}
                paused={paused}
                skipped={skipped}
                noun="painted"
                doing="Painting"
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
          onPaintOne={paintOne}
          onRestore={restore}
        />
      </div>

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
