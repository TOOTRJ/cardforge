"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
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
  mergeProfile,
  resolveFrameProfile,
  type FrameProfileOverride,
  type SlotPath,
} from "@/lib/cards/profile-override";
import {
  resetFrameProfileOverrideAction,
  saveFrameProfileOverrideAction,
} from "@/lib/cards/frame-profile-override-actions";

// ---------------------------------------------------------------------------
// FrameCompare — overlays a real Scryfall scan on our rendered frame so
// alignment/typography drift is visible at a glance, with an "Edit layout"
// mode: click an element, nudge with arrow keys or key exact numbers, and
// the draft merges into the live preview (overlay/difference keep working
// while editing). Save persists to frame_profile_overrides — instantly
// live for every render path, marking baked cards stale for the rebake
// sweep.
//
// Workflow (difference mode is the sharp tool): open a combo → difference
// → edit layout → nudge until aligned pixels go dark → Save → verify box.
//
// The scan comes as a 745×1040 PNG (5:7, same aspect as our card box), so
// stretching it over the preview container lines the two up 1:1.
// ---------------------------------------------------------------------------

type Mode = "overlay" | "side-by-side" | "difference";

type FrameCompareProps = {
  preview: CardPreviewData;
  /** 745×1040 PNG url from Scryfall for the reference printing; null when
   *  the combo has no real printing (sample content, no overlay). */
  scanUrl: string | null;
  scanAlt: string;
  /** The template under test — enables the layout editor when set. */
  template?: string | null;
  /** The saved DB override for this template ({} when none). */
  savedOverride?: FrameProfileOverride | null;
};

const CARD_WIDTH_PX = 372.5; // half of 745 — fits two side by side on laptops
const ZOOMED_WIDTH_PX = 745;

export function FrameCompare({
  preview,
  scanUrl,
  scanAlt,
  template,
  savedOverride,
}: FrameCompareProps) {
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

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedOverride ?? {}),
    [draft, savedOverride],
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

  const width = zoomed ? ZOOMED_WIDTH_PX : CARD_WIDTH_PX;

  const onField = (path: SlotPath, field: EditorField, value: number) =>
    setDraft((d) => writeSlotField(d, path, field, value));

  const onScalar = (
    name: (typeof SCALAR_FIELDS)[number],
    value: number,
  ) => setDraft((d) => ({ ...d, [name]: Math.round(value * 10000) / 10000 }));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editing || !selected || !resolvedProfile) return;
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const step = event.shiftKey ? 0.5 : 0.1;
    const nudge = (field: string, delta: number) =>
      onField(
        selected,
        { field, kind: "rect", step: 0.1 },
        (readRect(resolvedProfile, selected, field) ?? 0) + delta,
      );
    switch (event.key) {
      case "ArrowUp": nudge("topPct", -step); break;
      case "ArrowDown": nudge("topPct", step); break;
      case "ArrowLeft": nudge("leftPct", -step); break;
      case "ArrowRight": nudge("leftPct", step); break;
      case "[": nudge("widthPct", -step); break;
      case "]": nudge("widthPct", step); break;
      case "{": nudge("heightPct", -step); break;
      case "}": nudge("heightPct", step); break;
      default: return;
    }
    event.preventDefault();
  };

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
      toast.success(
        `Layout saved — live everywhere now. ${result.staleCount} baked card${result.staleCount === 1 ? "" : "s"} marked stale (run the rebake sweep).`,
      );
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
      toast.success(
        `Reset to code defaults. ${result.staleCount} baked card${result.staleCount === 1 ? "" : "s"} marked stale.`,
      );
    });

  // `isolate` caps CardPreview's internal z-indexed layers inside their own
  // stacking context — without it the card's text layers paint ABOVE the
  // scan overlay regardless of DOM order.
  const ourCard = (
    <div style={{ width }} className="isolate relative shrink-0">
      <CardPreview {...editedPreview} staticInEditor />
      {editing && resolvedProfile ? (
        <SlotOverlay
          profile={resolvedProfile}
          selected={selected}
          showAll={false}
          onSelect={setSelected}
        />
      ) : null}
    </div>
  );

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
          <label className="flex items-center gap-2 text-sm text-muted">
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

        <label className="flex items-center gap-2 text-sm text-muted">
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

        {!scanUrl ? (
          <span className="text-xs text-subtle">
            No real printing exists for this combination — eyeball the sample
            render.
          </span>
        ) : null}
      </SurfaceCard>

      {/* Canvas (focusable for editor keyboard nudges) + editor panel */}
      <div
        className="flex flex-wrap items-start gap-6 overflow-x-auto pb-4 focus:outline-none"
        tabIndex={editing ? 0 : -1}
        onKeyDown={onKeyDown}
      >
        {mode === "side-by-side" || !scanUrl ? (
          <>
            <figure className="flex flex-col gap-2">
              <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                Our render
              </figcaption>
              {ourCard}
            </figure>
            {scanUrl ? (
              <figure className="flex flex-col gap-2">
                <figcaption className="text-[11px] uppercase tracking-wider text-subtle">
                  Scryfall scan
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scanUrl}
                  alt={scanAlt}
                  style={{ width }}
                  className="shrink-0 rounded-[4.5%]"
                />
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scanUrl ?? undefined}
                alt={scanAlt}
                className={cn(
                  "pointer-events-none absolute inset-0 h-full w-full rounded-[4.5%]",
                  // Keep the overlay UNDER the editor hit-test layer (z-20).
                  "z-10",
                )}
                style={
                  mode === "difference"
                    ? { mixBlendMode: "difference" }
                    : { opacity: opacity / 100 }
                }
              />
            </div>
          </figure>
        )}

        {editing && resolvedProfile && template ? (
          <EditorPanel
            profile={resolvedProfile}
            draft={draft}
            selected={selected}
            dirty={dirty}
            saving={saving}
            hasSavedOverride={Boolean(
              savedOverride && Object.keys(savedOverride).length > 0,
            )}
            onSelect={setSelected}
            onField={onField}
            onScalar={onScalar}
            onSave={save}
            onRevert={() => setDraft(savedOverride ?? {})}
            onReset={reset}
          />
        ) : null}
      </div>
    </div>
  );
}

// Local rect reader (the panel has its own richer one) — used by the
// keyboard nudges, which only touch rect position/size fields.
function readRect(
  profile: ReturnType<typeof resolveFrameProfile>,
  path: SlotPath,
  field: string,
): number | null {
  const parts = path.split(".");
  let node: unknown = profile;
  for (const part of parts) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (!node || typeof node !== "object") return null;
  const slot = node as { rect?: Record<string, unknown> } & Record<string, unknown>;
  const holder = typeof slot.topPct === "number" ? slot : slot.rect;
  const value = holder?.[field];
  return typeof value === "number" ? value : null;
}
