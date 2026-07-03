"use client";

import { useMemo } from "react";
import { Copy, RotateCcw, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listSlotPaths,
  slotRect,
  type FrameProfileOverride,
  type SlotPath,
} from "@/lib/cards/profile-override";
import type { FrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Frame profile editor building blocks, embedded by FrameCompare's "Edit
// layout" mode:
//   * SlotOverlay  — outlines over the card + click-to-select hit testing
//   * EditorPanel  — slot list, numeric field inputs, save/reset actions
//   * draft helpers — immutable nested writes into a FrameProfileOverride
//
// All values are card-relative percents (rects) or fractions of card width
// (sizes) — identical semantics to lib/cards/template-layout.ts. The draft
// only ever contains fields the admin touched; merging over the code
// profile happens via the same resolveFrameProfile the renderers use.
// ---------------------------------------------------------------------------

/** Slot paths whose profile value is a bare Rect (no `.rect` wrapper). */
const BARE_RECT_PATHS: ReadonlySet<string> = new Set([
  "artSlot",
  "costRect",
  "secondFace.artSlot",
]);

/** Friendly display names for slot paths (chips + outline tags). */
export const SLOT_LABELS: Partial<Record<SlotPath, string>> = {
  artSlot: "art window",
  costRect: "cost (pips)",
  title: "title (name)",
  type: "type line",
  rules: "rules box",
  footer: "footer",
  pt: "P/T",
  chapters: "saga chapters",
};

export function slotLabel(path: SlotPath): string {
  return SLOT_LABELS[path] ?? path;
}

type FieldKind = "rect" | "scalar";

export type EditorField = {
  /** Field name within the slot ("topPct", "sizePct", "valueDyEm", …). */
  field: string;
  kind: FieldKind;
  step: number;
};

const RECT_FIELDS: EditorField[] = [
  { field: "topPct", kind: "rect", step: 0.1 },
  { field: "leftPct", kind: "rect", step: 0.1 },
  { field: "widthPct", kind: "rect", step: 0.1 },
  { field: "heightPct", kind: "rect", step: 0.1 },
];

const TEXT_FIELDS: EditorField[] = [
  { field: "sizePct", kind: "scalar", step: 0.001 },
  { field: "lineHeight", kind: "scalar", step: 0.02 },
  { field: "letterSpacingEm", kind: "scalar", step: 0.01 },
];

const STAT_FIELDS: EditorField[] = [
  { field: "sizePct", kind: "scalar", step: 0.001 },
  { field: "valueDxEm", kind: "scalar", step: 0.02 },
  { field: "valueDyEm", kind: "scalar", step: 0.02 },
];

/** The editable fields for a slot path on this profile. */
export function fieldsForSlot(
  profile: FrameProfile,
  path: SlotPath,
): EditorField[] {
  if (BARE_RECT_PATHS.has(path)) return RECT_FIELDS;
  const node = getNodeAtPath(profile, path);
  if (!node || typeof node !== "object") return RECT_FIELDS;
  const slot = node as Record<string, unknown>;
  const extra =
    "valueDyEm" in slot || "plateAssetPathTemplate" in slot || "badgeColorHex" in slot
      ? STAT_FIELDS
      : "sizePct" in slot
        ? TEXT_FIELDS
        : [];
  return [...RECT_FIELDS, ...extra];
}

function getNodeAtPath(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node;
}

/** Resolved (base + draft) value for a slot field. */
export function readSlotField(
  profile: FrameProfile,
  path: SlotPath,
  field: EditorField,
): number | null {
  const node = getNodeAtPath(profile, path);
  if (!node || typeof node !== "object") return null;
  const slot = node as Record<string, unknown>;
  const holder =
    field.kind === "rect" && !BARE_RECT_PATHS.has(path)
      ? (slot.rect as Record<string, unknown> | undefined)
      : slot;
  const value = holder?.[field.field];
  return typeof value === "number" ? value : null;
}

/** Immutable nested write of one slot field into the draft override. */
export function writeSlotField(
  draft: FrameProfileOverride,
  path: SlotPath,
  field: EditorField,
  value: number,
): FrameProfileOverride {
  const parts = path.split(".");
  const fieldPath =
    field.kind === "rect" && !BARE_RECT_PATHS.has(path)
      ? [...parts, "rect", field.field]
      : [...parts, field.field];

  const next = structuredClone(draft) as Record<string, unknown>;
  let node: Record<string, unknown> = next;
  for (const part of fieldPath.slice(0, -1)) {
    const child = node[part];
    node[part] =
      child && typeof child === "object" ? { ...(child as object) } : {};
    node = node[part] as Record<string, unknown>;
  }
  node[fieldPath[fieldPath.length - 1]] = Math.round(value * 10000) / 10000;
  return next as FrameProfileOverride;
}

/** Top-level scalar overrides (not tied to a slot). */
export const SCALAR_FIELDS = ["costSizePct", "symbolSizePct"] as const;

// ---------------------------------------------------------------------------
// SlotOverlay — outlines + hit testing over the rendered card.
// ---------------------------------------------------------------------------

export function SlotOverlay({
  profile,
  selected,
  showAll,
  onSelect,
}: {
  profile: FrameProfile;
  selected: SlotPath | null;
  showAll: boolean;
  onSelect: (path: SlotPath) => void;
}) {
  const paths = useMemo(() => listSlotPaths(profile), [profile]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const xPct = ((event.clientX - box.left) / box.width) * 100;
    const yPct = ((event.clientY - box.top) / box.height) * 100;
    let best: { path: SlotPath; area: number } | null = null;
    for (const path of paths) {
      const rect = slotRect(profile, path);
      if (!rect) continue;
      const inside =
        xPct >= rect.leftPct &&
        xPct <= rect.leftPct + rect.widthPct &&
        yPct >= rect.topPct &&
        yPct <= rect.topPct + rect.heightPct;
      if (!inside) continue;
      const area = rect.widthPct * rect.heightPct;
      if (!best || area < best.area) best = { path, area };
    }
    if (best) onSelect(best.path);
  };

  return (
    <div
      className="absolute inset-0 z-20 cursor-crosshair"
      onClick={handleClick}
      role="presentation"
      data-testid="slot-overlay"
    >
      {paths.map((path) => {
        const rect = slotRect(profile, path);
        if (!rect) return null;
        const isSelected = path === selected;
        if (!isSelected && !showAll) return null;
        return (
          <div
            key={path}
            data-slot-outline={path}
            className={cn(
              "pointer-events-none absolute rounded-sm border",
              isSelected
                ? "border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                : "border border-sky-300/40",
            )}
            style={{
              top: `${rect.topPct}%`,
              left: `${rect.leftPct}%`,
              width: `${rect.widthPct}%`,
              height: `${rect.heightPct}%`,
            }}
          >
            {isSelected ? (
              <span className="absolute -top-4 left-0 rounded bg-sky-400 px-1 text-[9px] font-semibold uppercase text-black">
                {slotLabel(path)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorPanel — slot list + fields + actions.
// ---------------------------------------------------------------------------

export function EditorPanel({
  profile,
  draft,
  selected,
  dirty,
  saving,
  hasSavedOverride,
  onSelect,
  onField,
  onScalar,
  onSave,
  onRevert,
  onReset,
}: {
  /** Base + saved + draft resolved profile (what's on screen). */
  profile: FrameProfile;
  draft: FrameProfileOverride;
  selected: SlotPath | null;
  dirty: boolean;
  saving: boolean;
  hasSavedOverride: boolean;
  onSelect: (path: SlotPath) => void;
  onField: (path: SlotPath, field: EditorField, value: number) => void;
  onScalar: (name: (typeof SCALAR_FIELDS)[number], value: number) => void;
  onSave: () => void;
  onRevert: () => void;
  onReset: () => void;
}) {
  const paths = listSlotPaths(profile);

  const copyAsTs = async () => {
    // Serialize the draft (the changed fields) as a TS-ish object literal
    // for folding back into lib/cards/template-layout.ts.
    const ts = JSON.stringify(draft, null, 2).replace(/"([a-zA-Z_]\w*)":/g, "$1:");
    await navigator.clipboard.writeText(ts);
    toast.success("Override copied as a TS object literal.");
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border/50 bg-elevated/40 p-3 text-sm">
      <div className="flex flex-wrap gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/25 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" aria-hidden /> Save
        </button>
        <button
          type="button"
          onClick={onRevert}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden /> Revert draft
        </button>
        <button
          type="button"
          onClick={copyAsTs}
          disabled={Object.keys(draft).length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy as TS
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={saving || (!hasSavedOverride && Object.keys(draft).length === 0)}
          className="inline-flex items-center gap-1 rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset to code defaults
        </button>
      </div>
      {dirty ? (
        <p className="text-[10px] font-medium text-gold-strong">
          Unsaved changes — Save publishes this layout everywhere.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => onSelect(path)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              path === selected
                ? "border-sky-400/70 bg-sky-400/15 text-foreground"
                : "border-border/50 text-muted hover:text-foreground",
            )}
          >
            {slotLabel(path)}
          </button>
        ))}
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle">
            {slotLabel(selected)} — arrows nudge position (Shift ×5), [ ] width, {"{ }"} height
          </span>
          {fieldsForSlot(profile, selected).map((field) => {
            const value = readSlotField(profile, selected, field);
            if (value === null) return null;
            return (
              <label
                key={field.field}
                className="flex items-center justify-between gap-2 text-xs text-muted"
              >
                {field.field}
                <input
                  type="number"
                  step={field.step}
                  value={value}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) onField(selected, field, next);
                  }}
                  className="h-7 w-24 rounded-md border border-border/40 bg-background/80 px-2 text-right text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary-bright/40"
                  aria-label={`${selected} ${field.field}`}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-subtle">
          Click an element on the card (or a chip above) to edit it.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-border/40 pt-2">
        <span className="text-[11px] uppercase tracking-wider text-subtle">
          Scalars
        </span>
        {SCALAR_FIELDS.map((name) => {
          const value = profile[name];
          if (typeof value !== "number") return null;
          return (
            <label
              key={name}
              className="flex items-center justify-between gap-2 text-xs text-muted"
            >
              {name}
              <input
                type="number"
                step={0.001}
                value={value}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) onScalar(name, next);
                }}
                className="h-7 w-24 rounded-md border border-border/40 bg-background/80 px-2 text-right text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary-bright/40"
                aria-label={name}
              />
            </label>
          );
        })}
      </div>

      <p className="text-[10px] leading-4 text-subtle">
        Note: type/rules text auto-shrinks to fit — a size change may not show
        until it passes the fit threshold.
      </p>

    </div>
  );
}
