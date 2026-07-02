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
  colorKey,
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
    perSlot: Partial<Record<SlotPath, number>>;
  } | null>(null);
  const [scoring, setScoring] = useState(false);

  const runScore = async () => {
    if (!template || !colorKey) return;
    setScoring(true);
    try {
      const response = await fetch("/api/admin/frame-align-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, color: colorKey }),
      });
      const body = await response.json().catch(() => null);
      if (body?.ok) setScore({ overall: body.overall, perSlot: body.perSlot });
      else toast.error(body?.error ?? "Scoring failed.");
    } catch {
      toast.error("Scoring failed.");
    } finally {
      setScoring(false);
    }
  };

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

  // Global keyboard nudges while editing — a window listener so arrows work
  // no matter what was last clicked (typing in inputs is exempt).
  useEffect(() => {
    if (!editing || !selected || !resolvedProfile) return;
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
      toast.success(
        `Layout saved — live everywhere now. ${result.staleCount} baked card${result.staleCount === 1 ? "" : "s"} marked stale (run the rebake sweep).`,
      );
      router.refresh();
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
      router.refresh();
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
            title="Pixel-diff our render against the real scan, per element. Run before and after an edit — the number should drop. Fonts/art always differ, so never expect 0."
            disabled={scoring}
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
      </SurfaceCard>

      <p className="text-xs leading-5 text-subtle">
        {editing
          ? "Editing: click an element on the card (or a chip in the panel) to select it, then nudge with the arrow keys — 0.1% per press, Shift for 0.5%, [ ] adjusts width, { } height. Or type exact values in the panel."
          : MODE_HINTS[mode]}
      </p>

      {score ? (
        <SurfaceCard className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-border/60 bg-elevated px-2 py-0.5 text-xs font-semibold text-foreground"
              title="Mean pixel difference over the whole card"
            >
              overall {score.overall}%
            </span>
            {Object.entries(score.perSlot)
              .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
              .map(([path, value]) => (
                <span
                  key={path}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    path === "artSlot"
                      ? "border-border/40 text-subtle"
                      : "border-border/60 text-muted",
                  )}
                >
                  {path} {value}%{path === "artSlot" ? " (art differs)" : ""}
                </span>
              ))}
          </div>
          <p className="text-[10px] leading-4 text-subtle">
            Relative/regression signal — fonts and art legitimately differ, so
            compare before/after a nudge, not against 0.
          </p>
        </SurfaceCard>
      ) : null}

      {/* Canvas (focusable for editor keyboard nudges) + editor panel */}
      <div className="flex flex-wrap items-start gap-6 overflow-x-auto pb-4">
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
