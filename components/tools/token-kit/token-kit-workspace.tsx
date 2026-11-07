"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Check, CloudOff, Copy, Info, Loader2, Printer, SlidersHorizontal } from "lucide-react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { CardGrid } from "@/components/cards/card-grid";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { KitPrintDialog } from "@/components/tools/token-kit/kit-print-dialog";
import { KitSettingsPanel } from "@/components/tools/token-kit/kit-settings-panel";
import { KitSourcePicker, type KitDeckOption } from "@/components/tools/token-kit/kit-source-picker";
import { KitTokenTile } from "@/components/tools/token-kit/kit-token-tile";
import { useKitArt } from "@/components/tools/token-kit/use-kit-art";
import {
  buildTokenKitAction,
  saveKitTokenToCardsAction,
  saveTokenKitAction,
  type BuiltKitResult,
  type KitSource,
} from "@/lib/tools/token-kit/actions";
import type { RecentTokenKit } from "@/lib/tools/token-kit/queries";
import { DEFAULT_KIT_SETTINGS, type KitItemKind, type KitItemState, type KitSettings } from "@/lib/tools/token-kit/model";
import { initialItemStates, kitCountsLine, kitFrames, kitSummary } from "@/lib/tools/token-kit/workspace";

// ---------------------------------------------------------------------------
// The Token Kit's page (beta tool `token-kit`): pick a source, then the kit —
// its one look on the left (a disclosure above the tokens on a phone), every
// token drawn live on the right, grouped Tokens / Emblems / Helper cards,
// each with its copies and picture. Every change is kept (a debounced
// saveTokenKitAction) so the kit reopens as it was left.
// ---------------------------------------------------------------------------

type Kit = Extract<BuiltKitResult, { ok: true }>["kit"];

const SAVE_DELAY_MS = 900;

const GROUPS: Array<{ kind: KitItemKind; title: string; blurb: string }> = [
  { kind: "token", title: "Tokens", blurb: "Creature and artifact tokens, the copies suggested from how often they are made." },
  { kind: "emblem", title: "Emblems", blurb: "One each — an emblem stays for the rest of the game." },
  {
    kind: "helper",
    title: "Helper cards",
    blurb: "The game pieces a card brings in: the Monarch, the Initiative, Day // Night, the Ring. Drawn on the emblem frame.",
  },
];

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function TokenKitWorkspace({
  decks,
  recent,
  verifiedKeys,
  cleanDownloads,
}: {
  decks: KitDeckOption[];
  recent: RecentTokenKit[];
  verifiedKeys: string[];
  cleanDownloads: boolean;
}) {
  const verified = useMemo(() => new Set(verifiedKeys), [verifiedKeys]);
  const upgrade = useUpgradeModal();
  const art = useKitArt();
  const [kit, setKit] = useState<Kit | null>(null);
  const [settings, setSettings] = useState<KitSettings>(DEFAULT_KIT_SETTINGS);
  const [states, setStates] = useState<Record<string, KitItemState>>({});
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [saving, setSaving] = useState<Record<string, true>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  /** Bumped by every change the maker makes (never by opening a kit), so
   *  the autosave runs only for a real change. */
  const [revision, setRevision] = useState(0);

  const build = useCallback((source: KitSource, label: string) => {
    setError(null);
    setPendingLabel(label);
    startTransition(async () => {
      const result = await buildTokenKitAction(source);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKit(result.kit);
      setSettings(result.kit.saved?.settings ?? DEFAULT_KIT_SETTINGS);
      setStates(initialItemStates(result.kit.items, result.kit.saved?.items));
      setRevision(0);
      setSaveStatus(result.kit.saved ? "saved" : "idle");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const changeSettings = useCallback((patch: Partial<KitSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setRevision((n) => n + 1);
  }, []);
  const changeItem = useCallback((key: string, patch: Partial<KitItemState>) => {
    setStates((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
    setRevision((n) => n + 1);
  }, []);

  // The autosave: the latest kit, a moment after the last change.
  const latest = useRef({ kit, settings, states });
  useEffect(() => {
    latest.current = { kit, settings, states };
  }, [kit, settings, states]);
  /** The save waiting for its moment, if any. */
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSnapshot = useCallback(async (current: typeof latest.current) => {
    if (!current.kit) return;
    const result = await saveTokenKitAction({
      sourceKey: current.kit.sourceKey,
      deckId: current.kit.deckId,
      title: current.kit.title,
      sourceText: current.kit.sourceText,
      settings: current.settings,
      items: current.states,
    }).catch(() => ({ ok: false as const, error: "The kit didn't save." }));
    // Only the kit on screen reports its save (a flushed one has left).
    if (latest.current.kit?.sourceKey === current.kit.sourceKey) setSaveStatus(result.ok ? "saved" : "error");
  }, []);
  useEffect(() => {
    if (revision === 0 || !latest.current.kit) return;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      pendingSave.current = null;
      void saveSnapshot(latest.current);
    }, SAVE_DELAY_MS);
    pendingSave.current = timer;
    return () => {
      clearTimeout(timer);
      if (pendingSave.current === timer) pendingSave.current = null;
    };
  }, [revision, saveSnapshot]);

  /** Leave the kit for the source picker — a change still waiting for its
   *  autosave is saved now, never dropped. */
  const leaveKit = useCallback(() => {
    if (pendingSave.current) {
      clearTimeout(pendingSave.current);
      pendingSave.current = null;
      void saveSnapshot(latest.current);
    }
    setKit(null);
  }, [saveSnapshot]);

  const items = useMemo(() => kit?.items ?? [], [kit]);
  const frameSettings = useMemo(() => ({ design: settings.design, nyx: settings.nyx }), [settings.design, settings.nyx]);
  const frames = useMemo(
    () => kitFrames(items, { ...DEFAULT_KIT_SETTINGS, ...frameSettings }, verified),
    [items, frameSettings, verified],
  );
  const summary = useMemo(() => kitSummary(items, states, frames), [items, states, frames]);

  const onUpload = useCallback(
    async (key: string, file: File) => {
      const picture = await art.upload(key, file);
      if (picture) changeItem(key, { ...picture, artPosition: null });
    },
    [art, changeItem],
  );
  const onPaint = useCallback(
    async (key: string) => {
      const item = items.find((candidate) => candidate.key === key);
      const frame = frames[key];
      if (!item || !frame?.ok) return;
      const picture = await art.paint(key, item.face, frame.template, settings);
      if (picture) {
        changeItem(key, { ...picture, artPosition: null });
        toast.success(`${item.face.title} is painted.`);
      }
    },
    [art, changeItem, frames, items, settings],
  );
  const onSave = useCallback(
    async (key: string) => {
      const item = items.find((candidate) => candidate.key === key);
      const state = states[key];
      if (!item || !state) return;
      setSaving((prev) => ({ ...prev, [key]: true }));
      try {
        const result = await saveKitTokenToCardsAction({ face: item.face, settings, state });
        if (!result.ok) {
          if (result.capacity) upgrade.open("capacity", "token_kit");
          toast.error(result.error);
          return;
        }
        toast.success(`${item.face.title} is in My Cards${result.forcedPrivate ? " (kept private: its text has strong language)" : ""}.`, {
          description: "Saved as a private card — it counts toward your card limit.",
          action: { label: "Open", onClick: () => window.location.assign(`/card/${result.slug}/edit`) },
        });
      } finally {
        setSaving((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [items, settings, states, upgrade],
  );

  if (!kit) {
    return (
      <KitSourcePicker decks={decks} recent={recent} pending={pending} pendingLabel={pendingLabel} error={error} onBuild={build} />
    );
  }

  const countsLine = kitCountsLine(summary);
  /** A picture still being made would land on the next kit's token. */
  const artBusy = Object.keys(art.busy).length > 0;
  const busyOf = (key: string) => (saving[key] ? ("save" as const) : (art.busy[key] ?? null));

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="token-kit">
      <SurfaceCard className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate font-display text-xl font-semibold text-foreground">{kit.title}</h2>
          <p className="text-sm text-muted">
            {countsLine || "Nothing to make"}
            {summary.cards > 0 ? ` · ${summary.cards} card${summary.cards === 1 ? "" : "s"} to print` : ""}
          </p>
          <SaveLine status={saveStatus} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={leaveKit} disabled={pending || artBusy}>
            <ArrowLeftRight aria-hidden /> Another deck
          </Button>
          <Button type="button" onClick={() => setPrintOpen(true)} disabled={summary.included === 0}>
            <Printer aria-hidden /> Print or download
          </Button>
        </div>
      </SurfaceCard>

      <KitNotices kit={kit} undrawable={summary.undrawable} />

      {items.length === 0 ? (
        <SurfaceCard className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Copy className="h-6 w-6 text-gold" aria-hidden />
          <p className="font-display text-lg font-semibold text-foreground">This deck makes no tokens</p>
          <p className="max-w-md text-sm leading-6 text-muted">
            None of its cards create a token, an emblem or a helper card. Try another deck, or paste a list.
          </p>
        </SurfaceCard>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <details className="group rounded-card border border-border/70 bg-surface/80 lg:hidden" data-testid="kit-settings-mobile">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-gold" aria-hidden /> Kit look
                <span className="ml-auto text-xs text-subtle group-open:hidden">Design, set symbol, watermark</span>
              </summary>
              <div className="border-t border-border/60 p-4">
                <KitSettingsPanel settings={settings} onChange={changeSettings} />
              </div>
            </details>
            <SurfaceCard className="hidden p-5 lg:block">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-gold" aria-hidden /> Kit look
              </h2>
              <KitSettingsPanel settings={settings} onChange={changeSettings} />
            </SurfaceCard>
          </aside>

          <div className="flex min-w-0 flex-col gap-8">
            {GROUPS.map((group) => {
              // Drawn tokens first; what can't be drawn (a dungeon) after them.
              const groupItems = items
                .filter((item) => item.face.kind === group.kind)
                .sort((a, b) => Number(!frames[a.key]?.ok) - Number(!frames[b.key]?.ok));
              if (groupItems.length === 0) return null;
              return (
                <section key={group.kind} aria-labelledby={`kit-group-${group.kind}`} className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h3 id={`kit-group-${group.kind}`} className="font-display text-base font-semibold text-foreground">
                      {group.title} <span className="text-sm font-normal text-subtle">({groupItems.length})</span>
                    </h3>
                    <p className="text-xs leading-5 text-muted">{group.blurb}</p>
                  </div>
                  <CardGrid>
                    {groupItems.map((item) => (
                      <KitTokenTile
                        key={item.key}
                        item={item}
                        state={states[item.key]}
                        frame={frames[item.key]}
                        settings={settings}
                        verifiedKeys={verified}
                        busy={busyOf(item.key)}
                        onChange={changeItem}
                        onUpload={onUpload}
                        onPaint={onPaint}
                        onSave={onSave}
                      />
                    ))}
                  </CardGrid>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <KitPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={kit.title}
        items={items}
        states={states}
        frames={frames}
        settings={settings}
        cleanDownloads={cleanDownloads}
      />
    </div>
  );
}

function SaveLine({ status }: { status: SaveStatus }) {
  if (status === "idle") return <p className="text-xs text-subtle">Your changes are kept as you go.</p>;
  return (
    <p className="flex items-center gap-1.5 text-xs text-subtle" role="status">
      {status === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
        </>
      ) : status === "saved" ? (
        <>
          <Check className="h-3.5 w-3.5 text-gold" aria-hidden /> Kit saved
        </>
      ) : (
        <>
          <CloudOff className="h-3.5 w-3.5 text-danger" aria-hidden /> Not saved — your next change tries again
        </>
      )}
    </p>
  );
}

function KitNotices({ kit, undrawable }: { kit: Kit; undrawable: number }) {
  const notes: Array<{ tone: "info" | "warn"; text: React.ReactNode }> = [];
  if (kit.realCardsFailed) {
    notes.push({ tone: "warn", text: "Scryfall didn't answer for some cards — the kit may be missing tokens. Try again in a few minutes." });
  }
  if (kit.doublers.length > 0) {
    notes.push({
      tone: "info",
      text: `${kit.doublers.join(", ")} ${kit.doublers.length === 1 ? "doubles" : "double"} what you make, so the suggested copies are doubled too.`,
    });
  }
  if (kit.notFound.length > 0) {
    notes.push({
      tone: "warn",
      text: `Scryfall didn't recognise ${kit.notFound.length === 1 ? "one line" : `${kit.notFound.length} lines`}: ${kit.notFound.slice(0, 6).join(", ")}${kit.notFound.length > 6 ? "…" : ""}.`,
    });
  }
  if (kit.missing > 0) {
    notes.push({ tone: "warn", text: `${kit.missing} token printing${kit.missing === 1 ? "" : "s"} didn't come back from Scryfall.` });
  }
  if (undrawable > 0) {
    notes.push({
      tone: "info",
      text: (
        <>
          {undrawable === 1 ? "One item isn't" : `${undrawable} items aren't`}{" "}drawn: a dungeon, or a colour whose token frame
          isn&apos;t verified yet. <Link href="/feedback" className="underline underline-offset-2">Tell us</Link> which you need.
        </>
      ),
    });
  }
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="About this kit">
      {notes.map((note, index) => (
        <li
          key={index}
          className={
            note.tone === "warn"
              ? "flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm leading-6 text-foreground"
              : "flex items-start gap-2 rounded-lg border border-border/70 bg-elevated/40 px-4 py-2.5 text-sm leading-6 text-foreground"
          }
        >
          {note.tone === "warn" ? (
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
          ) : (
            <Info className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden />
          )}
          <span>{note.text}</span>
        </li>
      ))}
    </ul>
  );
}
