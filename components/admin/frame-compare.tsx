"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import {
  EditorPanel,
  SlotOverlay,
  writeSlotField,
  type EditorField,
  type SCALAR_FIELDS,
} from "@/components/admin/frame-profile-editor";
import {
  defaultCostRect,
  defaultSymbolRect,
  mergeProfile,
  resolveFrameProfile,
  slotRect,
  type FrameProfileOverride,
  type SlotPath,
} from "@/lib/cards/profile-override";
import {
  resetFrameProfileOverrideAction,
  saveFrameProfileOverrideAction,
} from "@/lib/cards/frame-profile-override-actions";
import { scanPlacement, type CardOrientation } from "@/lib/frames/scan-geometry";
import type { SlotScore } from "@/lib/frames/align";
import { startMarkedRebake } from "@/components/admin/rebake-marked-store";

/** Cards left alone because their owner hasn't accepted a pending opt-in
 *  look (lib/cards/frame-profile-override-actions.ts) — say so. */
function keptNote(kept: number): string {
  return kept > 0
    ? ` ${kept} card${kept === 1 ? " keeps its" : "s keep their"} owner's older look until the owner updates.`
    : "";
}

// ---------------------------------------------------------------------------
// FrameCompare — overlays a real Scryfall scan on our rendered frame so
// alignment/typography drift is visible at a glance, with an "Edit layout"
// mode: click an element, nudge with arrow keys or key exact numbers, and
// the draft merges into the live preview (overlay/difference keep working
// while editing). Save persists to frame_profile_overrides — instantly
// live for every render path — and re-bakes the template's published cards
// straight away (MarkedRendersPanel shows the progress; owners never get a
// "newer look" badge for a geometry change, TODO 0.20).
//
// Workflow (difference mode is the sharp tool): open a combo → difference
// → edit layout → nudge until aligned pixels go dark → Save → verify box.
//
// The scan is Scryfall's 745×1040 PNG. That is 0.3% off the 5:7 card box,
// which the overlay stretches away; the objective score does the same.
// Landscape frames (battle, split) get the scan turned 90° — the file is
// portrait with the card content on its side (lib/frames/scan-geometry.ts).
//
// State survives a save: the page keys this component on template/colour
// only, and the draft re-syncs from the saved override when THAT changes
// (a verify click or a reference pin never touches an in-progress draft).
// ---------------------------------------------------------------------------

type Mode = "overlay" | "side-by-side" | "difference";

const MODE_HINTS: Record<Mode, string> = {
  overlay:
    "The real scan sits on top of our render — slide the opacity to blend between them.",
  "side-by-side": "Our render on the left, the real printing on the right.",
  difference:
    "Precision mode: pixels that match go dark, misalignment glows bright. Nudge until the glow dies.",
};

type FrameCompareProps = {
  preview: CardPreviewData;
  /** 745×1040 PNG url from Scryfall for the reference printing; null when
   *  the combo has no real printing (sample content, no overlay). */
  scanUrl: string | null;
  scanAlt: string;
  /** The template under test — enables the layout editor when set. */
  template?: string | null;
  /** The color key under test — enables the alignment score. */
  colorKey?: string | null;
  /** A registry printing chosen via ?ref= (null = pinned/default) — the
   *  score must measure the same printing the page shows. */
  referenceId?: string | null;
  /** The saved DB override for this template (null when none). */
  savedOverride?: FrameProfileOverride | null;
};

const CARD_WIDTH_PX = 372.5; // half of 745 — fits two side by side on laptops
const ZOOMED_WIDTH_PX = 745;

/** Rect fields the keyboard nudges touch. */
type RectField = "topPct" | "leftPct" | "widthPct" | "heightPct";

/** The scan, placed over (or beside) a card box of the given orientation:
 *  a portrait file for portrait cards, turned 90° clockwise and re-centred
 *  for landscape ones. */
function ScanImage({
  src,
  alt,
  width,
  orientation,
  mode,
  opacity,
}: {
  src: string;
  alt: string;
  width: number;
  orientation: CardOrientation;
  mode: Mode;
  /** 0–100, overlay mode only. */
  opacity: number;
}) {
  const place = scanPlacement(width, orientation);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      data-testid="scan-image"
      data-rotate={place.rotateDeg}
      // Keep the overlay UNDER the editor hit-test layer (z-20) but above
      // the isolated card.
      className="pointer-events-none absolute z-10 rounded-[4.5%]"
      style={{
        width: place.imgWidth,
        height: place.imgHeight,
        left: place.imgLeft,
        top: place.imgTop,
        transform: place.rotateDeg ? `rotate(${place.rotateDeg}deg)` : undefined,
        transformOrigin: "50% 50%",
        ...(mode === "difference"
          ? { mixBlendMode: "difference" as const }
          : mode === "overlay"
            ? { opacity: opacity / 100 }
            : {}),
      }}
    />
  );
}

export function FrameCompare({
  preview,
  scanUrl,
  scanAlt,
  template,
  colorKey,
  referenceId = null,
  savedOverride,
}: FrameCompareProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("overlay");
  const [opacity, setOpacity] = useState(50);
  const [zoomed, setZoomed] = useState(false);

  // ----- layout editor state -----
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FrameProfileOverride>(
    () => savedOverride ?? {},
  );
  const [selected, setSelected] = useState<SlotPath | null>(null);
  const [saving, startSaving] = useTransition();
  const [score, setScore] = useState<{
    overall: number;
    global: { dxPct: number; dyPct: number; confidence: number };
    slots: Partial<Record<SlotPath, SlotScore>>;
  } | null>(null);
  const [scoreStale, setScoreStale] = useState(false);
  const [scoring, setScoring] = useState(false);

  // Re-sync the draft when the SAVED override changes (our own Save/Reset
  // landing, or another admin's) — derived during render, so an unrelated
  // refresh (verify click, reference pin) leaves an in-progress draft alone.
  const savedKey = JSON.stringify(savedOverride ?? {});
  const [prevSavedKey, setPrevSavedKey] = useState(savedKey);
  if (savedKey !== prevSavedKey) {
    setPrevSavedKey(savedKey);
    setDraft(savedOverride ?? {});
  }

  const runScore = async () => {
    if (!template || !colorKey) return;
    setScoring(true);
    try {
      const response = await fetch("/api/admin/frame-align-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, color: colorKey, ref: referenceId ?? undefined }),
      });
      const body = await response.json().catch(() => null);
      if (body?.ok) {
        setScore({ overall: body.overall, global: body.global, slots: body.slots ?? {} });
        setScoreStale(false);
      } else toast.error(body?.error ?? "Scoring failed.");
    } catch {
      toast.error("Scoring failed.");
    } finally {
      setScoring(false);
    }
  };

  const dirty = useMemo(
    () => JSON.stringify(draft) !== savedKey,
    [draft, savedKey],
  );

  // What's on screen: code profile + draft (draft starts as the saved
  // override, so saved values are always reflected).
  const editedPreview: CardPreviewData =
    editing && template
      ? { ...preview, profileOverrides: { [template]: draft } }
      : preview;
  const resolvedProfile = useMemo(
    () =>
      template
        ? mergeProfile(resolveFrameProfile(template, null), draft)
        : null,
    [template, draft],
  );
  // Orientation is code-owned (never overridden), so the base profile is
  // the right source even while editing.
  const orientation: CardOrientation =
    (template ? resolveFrameProfile(template, null).orientation : undefined) ??
    "portrait";

  const width = zoomed ? ZOOMED_WIDTH_PX : CARD_WIDTH_PX;

  // The cost pips and set symbol have no rect of their own until the admin
  // moves them — they sit inline in the title/type band. The FIRST EDIT
  // seeds the draft with the region they currently occupy so the write
  // lands on a complete rect (a bare `{ topPct }` would break the renderer)
  // and both renderers switch to the absolute box. Merely selecting the
  // slot leaves the draft untouched — nothing to save, nothing to score.
  const seedDetachedSlot = (
    current: FrameProfileOverride,
    path: SlotPath,
  ): FrameProfileOverride => {
    if (!resolvedProfile) return current;
    if (path === "costRect" && !current.costRect && !resolvedProfile.costRect) {
      return { ...current, costRect: defaultCostRect(resolvedProfile) };
    }
    if (
      path === "symbolRect" &&
      !current.symbolRect &&
      !resolvedProfile.symbolRect
    ) {
      return { ...current, symbolRect: defaultSymbolRect(resolvedProfile) };
    }
    return current;
  };

  const onField = (path: SlotPath, field: EditorField, value: number) =>
    setDraft((d) => writeSlotField(seedDetachedSlot(d, path), path, field, value));

  const selectSlot = (path: SlotPath) => setSelected(path);

  // The score's suggested nudge, applied to the slot rect (turns editing on
  // so the change is visible and saveable).
  const applyNudge = (path: SlotPath, nudge: SlotScore) => {
    if (!resolvedProfile) return;
    const rect = slotRect(resolvedProfile, path);
    if (!rect) return;
    setEditing(true);
    setSelected(path);
    setDraft((d) => {
      let next = seedDetachedSlot(d, path);
      if (nudge.dxPct !== 0) {
        next = writeSlotField(next, path, { field: "leftPct", kind: "rect", step: 0.1 }, rect.leftPct + nudge.dxPct);
      }
      if (nudge.dyPct !== 0) {
        next = writeSlotField(next, path, { field: "topPct", kind: "rect", step: 0.1 }, rect.topPct + nudge.dyPct);
      }
      return next;
    });
  };

  const onScalar = (
    name: (typeof SCALAR_FIELDS)[number],
    value: number,
  ) => setDraft((d) => ({ ...d, [name]: Math.round(value * 10000) / 10000 }));

  // Global keyboard nudges while editing — a window listener so arrows work
  // no matter what was last clicked (typing in inputs is exempt, and so are
  // browser/OS shortcuts carrying Cmd/Ctrl — Cmd+[ is "back").
  useEffect(() => {
    if (!editing || !selected || !resolvedProfile) return;
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.metaKey || event.ctrlKey) return;
      // Alt / Option = coarse. Physical keys (event.code) so Option+[ on
      // macOS — which types a curly quote — still resizes.
      const step = event.altKey ? 0.5 : 0.1;
      const rect = slotRect(resolvedProfile, selected);
      if (!rect) return;
      const nudge = (field: RectField, delta: number) =>
        onField(
          selected,
          { field, kind: "rect", step: 0.1 },
          rect[field] + delta,
        );
      switch (event.code) {
        case "ArrowUp": nudge("topPct", -step); break;
        case "ArrowDown": nudge("topPct", step); break;
        case "ArrowLeft": nudge("leftPct", -step); break;
        case "ArrowRight": nudge("leftPct", step); break;
        case "BracketLeft":
          nudge(event.shiftKey ? "heightPct" : "widthPct", -step);
          break;
        case "BracketRight":
          nudge(event.shiftKey ? "heightPct" : "widthPct", step);
          break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // onField is recreated every render but only closes over setDraft +
    // resolvedProfile, which are in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selected, resolvedProfile]);

  const save = () =>
    startSaving(async () => {
      if (!template) return;
      const result = await saveFrameProfileOverrideAction({
        template,
        overrides: draft,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setScoreStale(true);
      toast.success(
        result.changed
          ? `${result.staleCount > 0
              ? `Layout saved — live everywhere now. Re-baking ${result.staleCount} published card${result.staleCount === 1 ? "" : "s"}…`
              : "Layout saved — live everywhere now."}${keptNote(result.keptForOwner)}`
          : "Nothing to save — this template already uses the code defaults.",
      );
      router.refresh();
      if (result.changed && result.staleCount > 0) void startMarkedRebake();
    });

  const reset = () =>
    startSaving(async () => {
      if (!template) return;
      const result = await resetFrameProfileOverrideAction({ template });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft({});
      setSelected(null);
      if (result.changed) {
        setScoreStale(true);
        toast.success(
          `${result.staleCount > 0
            ? `Reset to code defaults. Re-baking ${result.staleCount} published card${result.staleCount === 1 ? "" : "s"}…`
            : "Reset to code defaults."}${keptNote(result.keptForOwner)}`,
        );
      } else {
        toast.message("Draft discarded — no saved layout existed for this template.");
      }
      router.refresh();
      if (result.changed && result.staleCount > 0) void startMarkedRebake();
    });

  // `isolate` caps CardPreview's internal z-indexed layers inside their own
  // stacking context — without it the card's text layers paint ABOVE the
  // scan overlay regardless of DOM order. The scan and the editor overlay
  // are SIBLINGS of the isolated card (not children), so the selected-slot
  // outline paints above the scan instead of being dimmed or inverted by it.
  const ourCard = (
    <div style={{ width }} className="isolate relative shrink-0">
      <CardPreview {...editedPreview} staticInEditor />
    </div>
  );
  const editorOverlay =
    editing && resolvedProfile ? (
      <SlotOverlay
        profile={resolvedProfile}
        selected={selected}
        showAll={false}
        onSelect={selectSlot}
      />
    ) : null;

  const scanBox = scanPlacement(width, orientation);

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <SurfaceCard className="flex flex-wrap items-center gap-4 p-4">
        <div
          role="radiogroup"
          aria-label="Comparison mode"
          className="flex overflow-hidden rounded-md border border-border/50"
        >
          {(["overlay", "side-by-side", "difference"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              title={MODE_HINTS[m]}
              disabled={!scanUrl && m !== "side-by-side"}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                mode === m
                  ? "bg-primary/20 text-foreground"
                  : "text-muted hover:text-foreground",
                !scanUrl && m !== "side-by-side" && "opacity-40",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "overlay" && scanUrl ? (
          <label
            className="flex items-center gap-2 text-sm text-muted"
            title="0% = only our render, 100% = only the real scan."
          >
            Scan opacity
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="w-36 accent-primary"
            />
            <span className="w-10 text-right text-xs tabular-nums">
              {opacity}%
            </span>
          </label>
        ) : null}

        <label
          className="flex items-center gap-2 text-sm text-muted"
          title="Render the card at full scan resolution (745px wide) for close inspection."
        >
          <input
            type="checkbox"
            checked={zoomed}
            onChange={(event) => setZoomed(event.target.checked)}
            className="accent-primary"
          />
          2× zoom
        </label>

        {template ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            title="Adjust this frame's layout: click an element on the card, nudge with arrow keys or type exact numbers. Saving goes live for everyone instantly."
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              editing
                ? "border-sky-400/70 bg-sky-400/15 text-foreground"
                : "border-border/50 text-muted hover:text-foreground",
            )}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit layout
          </button>
        ) : null}

        {template && colorKey && scanUrl ? (
          <button
            type="button"
            onClick={runScore}
            title={
              dirty
                ? "Save your layout edits first — the score always measures the SAVED layout, not the on-screen draft."
                : "Lines the scan up with our render, masks the art and the text, then scores the frame and each element (edge difference, lower is better) and suggests a nudge per element. Fonts differ, so text never reaches 0."
            }
            disabled={scoring || dirty}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            {scoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Gauge className="h-3.5 w-3.5" aria-hidden />
            )}
            Score alignment
          </button>
        ) : null}

        {!scanUrl ? (
          <span className="text-xs text-subtle">
            No real printing exists for this combination — eyeball the sample
            render.
          </span>
        ) : null}
        {orientation === "landscape" && scanUrl ? (
          <span className="text-xs text-subtle">
            Landscape frame — the scan is shown turned 90° to match.
          </span>
        ) : null}
      </SurfaceCard>

      <p className="text-xs leading-5 text-subtle">
        {editing
          ? "Editing: click an element on the card (or a chip in the panel) to select it, then nudge with the arrow keys — 0.1% per press, Alt / Option for 0.5%, [ ] adjusts width, { } height. Or type exact values in the panel."
          : MODE_HINTS[mode]}
      </p>

      {score ? (
        <SurfaceCard className="flex flex-col gap-2 p-4" data-testid="score-panel">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-border/60 bg-elevated px-2 py-0.5 text-xs font-semibold text-foreground"
              title="Edge difference over the frame after lining the scan up — art, text and stat interiors are masked. Lower is better."
            >
              frame {score.overall}%
            </span>
            <span
              className="rounded-full border border-border/40 px-2 py-0.5 text-[11px] text-subtle"
              title="How far the scan sat from our render before registration (already compensated in every number here). Confidence is the projection correlation, 1 = same structure."
            >
              scan offset {formatPct(score.global.dxPct)} / {formatPct(score.global.dyPct)} · confidence {score.global.confidence}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {Object.entries(score.slots)
              .sort(([, a], [, b]) => (b?.score ?? 0) - (a?.score ?? 0))
              .map(([path, slot]) => {
                if (!slot) return null;
                const isArt = path === "artSlot" || path.endsWith(".artSlot");
                const hasNudge = !isArt && (slot.dxPct !== 0 || slot.dyPct !== 0) && slot.best < slot.score;
                return (
                  <li
                    key={path}
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-[11px]",
                      isArt ? "text-subtle" : "text-muted",
                    )}
                  >
                    <span className="w-36 truncate font-medium">{path}</span>
                    <span className="tabular-nums">{slot.score}%</span>
                    {isArt ? <span>(art differs)</span> : null}
                    {hasNudge ? (
                      <>
                        <span className="tabular-nums text-subtle">
                          → {formatPct(slot.dxPct)} / {formatPct(slot.dyPct)} would score {slot.best}%
                        </span>
                        {template ? (
                          <button
                            type="button"
                            onClick={() => applyNudge(path as SlotPath, slot)}
                            className="rounded-md border border-sky-400/50 px-1.5 py-0.5 text-[10px] font-medium text-sky-200 transition-colors hover:bg-sky-400/15"
                            title="Move this element by the suggested amount (turns on Edit layout; Save to publish)."
                          >
                            Apply nudge
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          <p className="text-[10px] leading-4 text-subtle">
            {scoreStale
              ? "Scored BEFORE your last save — run it again to see the after."
              : "Numbers are edge differences after the scan is lined up (lower is better). Text slots never reach 0 — fonts differ — so trust the nudge, not the absolute value."}
          </p>
        </SurfaceCard>
      ) : null}

      {/* Canvas (focusable for editor keyboard nudges) + editor panel */}
      <div
        className={cn(
          "items-start gap-6 pb-4",
          editing
            ? "grid lg:grid-cols-[minmax(0,1fr)_320px]"
            : "flex flex-wrap overflow-x-auto",
        )}
      >
        <div className="flex flex-wrap items-start gap-6 overflow-x-auto">
        {mode === "side-by-side" || !scanUrl ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                Our render
              </figcaption>
              <div className="relative" style={{ width }}>
                {ourCard}
                {editorOverlay}
              </div>
            </figure>
            {scanUrl ? (
              <figure className="flex flex-col gap-2">
                <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                  Scryfall scan
                </figcaption>
                <div
                  className="relative shrink-0 overflow-hidden"
                  style={{ width: scanBox.boxWidth, height: scanBox.boxHeight }}
                >
                  <ScanImage
                    src={scanUrl}
                    alt={scanAlt}
                    width={width}
                    orientation={orientation}
                    mode="side-by-side"
                    opacity={100}
                  />
                </div>
              </figure>
            ) : null}
          </>
        ) : (
          <figure className="flex flex-col gap-2">
            <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
              {mode === "difference"
                ? "Difference — aligned pixels go dark; drift glows"
                : `Scan over our render at ${opacity}%`}
            </figcaption>
            {/* isolation: isolate scopes the difference blend to THIS box —
                without it the scan blends against the page background
                instead of our render. */}
            <div
              className="relative"
              style={{ width, isolation: "isolate" }}
            >
              {ourCard}
              <ScanImage
                src={scanUrl}
                alt={scanAlt}
                width={width}
                orientation={orientation}
                mode={mode}
                opacity={opacity}
              />
              {editorOverlay}
            </div>
          </figure>
        )}

        </div>

        {editing && resolvedProfile && template ? (
          <div className="lg:sticky lg:top-20 lg:max-h-[85vh] lg:overflow-y-auto">
          <EditorPanel
            profile={resolvedProfile}
            draft={draft}
            selected={selected}
            dirty={dirty}
            saving={saving}
            hasSavedOverride={Boolean(
              savedOverride && Object.keys(savedOverride).length > 0,
            )}
            onSelect={selectSlot}
            onField={onField}
            onScalar={onScalar}
            onSave={save}
            onRevert={() => setDraft(savedOverride ?? {})}
            onReset={reset}
          />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "+0.3%" / "−0.2%" / "0%" for offsets in card percent. */
function formatPct(value: number): string {
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;
}
