"use client";

import { ExternalLink, ImageDown, Info, Loader2, XCircle } from "lucide-react";
import { InlinePips } from "@/components/cards/inline-pips";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { Badge } from "@/components/ui/badge";
import {
  PrintingFilterChips,
  PrintingStatusBadge,
  PrintingsGrid,
} from "@/components/creator/import/printings-grid";
import { ImportFrameChooser } from "@/components/creator/import/frame-chooser";
import type { UsePrintingsResult } from "@/components/creator/import/use-printings";
import {
  onlyUndrawnDetailsMissing,
  type ImportFrameChoice,
  type ImportFramePlan,
} from "@/lib/creator/import-frame-choice";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  droppedFaceNotice,
  undrawableSymbolsNotice,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import type { PrintingSummary, PrintingView } from "@/lib/scryfall/printing-views";
import { buildTypeLine } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";

// ---------------------------------------------------------------------------
// The import dialog's detail pane (TODO 1.5): the selected printing, what the
// import will populate, every printing of the card (filterable, with the
// Exact / Nearest / Not available status), and — when the match isn't
// exact — the inline frame chooser before commit. Stays mounted while
// another printing loads (a busy overlay), so the grid keeps its scroll
// (TODO 1.9).
// ---------------------------------------------------------------------------

export type NamedResponse = {
  ok: true;
  card: {
    id: string;
    name: string;
    oracle_id: string | null;
    set: string | null;
    set_name: string | null;
    print_url: string | null;
    thumb_url: string | null;
    scryfall_uri: string | null;
    image_status: string | null;
    /** The second face has an image of its own (a DFC) — false for split,
     *  adventure, flip and Room cards, which share one image (TODO 1.8).
     *  Optional: an older cached response has no flag and imports no
     *  back-face art. */
    has_back_image?: boolean;
  };
  patch: ScryfallImportPatch;
};

/** "…and the frame (an exact match: M15 (2015) frame)" — the overwrite
 *  note names what the import does with the frame (TODO 1.5). Null when the
 *  chooser's "Keep my current frame" is picked: the frame isn't replaced.
 *  A printing short of only a detail no frame draws lands on its own frame
 *  without the chooser (owner decision C1): the note names the frame and
 *  the reason. */
export function frameOverwriteCopy(
  patch: Pick<ScryfallImportPatch, "frame_match" | "color_identity">,
  choice: ImportFrameChoice | null = null,
  planMode: ImportFramePlan["mode"] = "none",
): string | null {
  const match = patch.frame_match;
  if (choice && "keepCurrent" in choice) return null;
  if (!match || match.reject) return "the frame";
  if (match.status === "exact" && !match.landOn) {
    return `the frame (an exact match: ${match.exactLabel})`;
  }
  if (choice) {
    return `the frame (nearest to ${match.exactLabel}: ${describeFrame(choice.template)}, your pick above)`;
  }
  if (
    planMode === "none" &&
    match.reason &&
    onlyUndrawnDetailsMissing(match, pickFrameColorKey(patch.color_identity))
  ) {
    return `the frame (${describeFrame(match.template)} — ${match.reason})`;
  }
  return `the frame (nearest to ${match.exactLabel})`;
}

export function ImportDetail({
  data,
  busy,
  importArt,
  onImportArtChange,
  printings,
  view,
  onViewChange,
  onSelectPrinting,
  pendingPrintingId,
  plan,
  frameChoice,
  onFrameChoiceChange,
  locked,
}: {
  data: NamedResponse;
  /** Another printing is loading: overlay, keep everything mounted. */
  busy: boolean;
  importArt: boolean;
  onImportArtChange: (next: boolean) => void;
  /** Null when the card has no oracle id (Scryfall's reversible cards). */
  printings: UsePrintingsResult | null;
  view: PrintingView;
  onViewChange: (next: PrintingView) => void;
  onSelectPrinting: (printing: PrintingSummary) => void;
  pendingPrintingId: string | null;
  plan: ImportFramePlan;
  frameChoice: ImportFrameChoice | null;
  onFrameChoiceChange: (next: ImportFrameChoice) => void;
  /** The import is committing: nothing may change under it. */
  locked: boolean;
}) {
  const { card, patch } = data;
  const match = patch.frame_match;
  // A double-faced token or a Role card imports its front face only (TODO
  // 1.23): say so before the commit, as the creator's toast does after.
  const faceNote = droppedFaceNotice(patch, card.name);
  // A symbol the card can't draw (a hybrid Phyrexian cost) is left off it.
  const symbolNote = undrawableSymbolsNotice(patch, card.name);
  const frameCopy = frameOverwriteCopy(
    patch,
    plan.mode === "choose" ? frameChoice : null,
    plan.mode,
  );
  return (
    <div className="relative flex flex-col gap-4 p-5" aria-busy={busy}>
      {busy ? (
        <div
          className="absolute inset-x-0 top-0 z-10 flex h-40 items-start justify-center pt-16"
          role="status"
        >
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading printing…
          </span>
        </div>
      ) : null}
      <div className={`grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] ${busy ? "opacity-60" : ""}`}>
        <div className="flex flex-col gap-2">
          {card.print_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.print_url}
              alt={`Print of ${card.name}`}
              className="w-full rounded-lg border border-border/60 shadow-md"
            />
          ) : (
            <div className="aspect-[5/7] w-full rounded-lg bg-elevated" />
          )}
          {card.image_status === "lowres" ? (
            <p className="text-[11px] leading-4 text-subtle">
              Low-resolution scan — search for another printing for sharper
              art.
            </p>
          ) : card.image_status === "placeholder" ||
            card.image_status === "missing" ? (
            <p className="text-[11px] leading-4 text-subtle">
              Scryfall only has a placeholder image for this printing — art
              import is unavailable.
            </p>
          ) : null}
          {card.scryfall_uri ? (
            <a
              href={card.scryfall_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start text-[11px] uppercase tracking-wider text-primary-bright underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> View on Scryfall
            </a>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
              {card.name}
            </h3>
            <p className="text-xs uppercase tracking-wider text-subtle">
              {card.set_name ?? card.set ?? "Unknown set"}
            </p>
            {match ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <PrintingStatusBadge
                  match={{
                    status: match.status,
                    exactLabel: match.exactLabel,
                    template: match.template,
                    reason: match.reason,
                    landOn: match.landOn,
                    reject: match.reject,
                  }}
                />
                <span>{match.exactLabel}</span>
              </p>
            ) : null}
          </div>

          <PatchPreview patch={patch} />
          {faceNote ? (
            <p
              className="inline-flex items-start gap-2 text-[11px] leading-4 text-muted"
              data-testid="import-face-note"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary-bright" aria-hidden />
              <span>{faceNote}</span>
            </p>
          ) : null}
          {symbolNote ? (
            <p
              className="inline-flex items-start gap-2 text-[11px] leading-4 text-muted"
              data-testid="import-symbol-note"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary-bright" aria-hidden />
              <span>{symbolNote}</span>
            </p>
          ) : null}
        </div>
      </div>

      {printings ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            Printings · each sets the frame
          </span>
          <PrintingFilterChips value={view} onChange={onViewChange} disabled={locked} />
          <PrintingsGrid
            printings={printings.printings}
            activeId={card.id}
            onSelect={onSelectPrinting}
            loading={printings.loading}
            loadingMore={printings.loadingMore}
            hasMore={printings.hasMore}
            onLoadMore={printings.loadMore}
            total={printings.total}
            error={printings.error}
            pendingId={pendingPrintingId}
          />
        </div>
      ) : null}

      {plan.mode === "reject" ? (
        <p
          role="alert"
          className="inline-flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs leading-5 text-foreground"
        >
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          <span>
            <strong>Not available</strong> — {plan.reason} ({plan.exactLabel}). Pick another
            printing.
          </span>
        </p>
      ) : plan.mode === "choose" ? (
        <ImportFrameChooser
          key={card.id}
          plan={plan}
          value={frameChoice}
          onChange={onFrameChoiceChange}
          colorIdentity={patch.color_identity}
          type={{ cardType: patch.card_type, supertype: patch.supertype, cost: patch.cost }}
          printing={patch}
          disabled={locked || busy}
        />
      ) : null}

      <label className="inline-flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-elevated/40 p-3 text-xs leading-5 text-muted">
        <input
          type="checkbox"
          checked={importArt}
          onChange={(event) => onImportArtChange(event.target.checked)}
          disabled={locked}
          className="mt-0.5 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <ImageDown className="h-3.5 w-3.5" aria-hidden /> Also import
            artwork
          </span>
          <span>
            Server downloads the art crop into your card-art bucket. You
            can replace it later.
          </span>
        </span>
      </label>

      <p className="inline-flex items-start gap-2 rounded-md border border-border/60 bg-elevated/40 p-3 text-xs leading-5 text-muted">
        <Info
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-bright"
          aria-hidden
        />
        <span>
          Importing <strong>overwrites the card you&apos;re currently
          editing</strong> —{" "}
          {frameCopy
            ? <>name, text, type, colors, and {frameCopy} are all replaced.</>
            : <>name, text, type and colors are all replaced; your current frame stays.</>}
        </span>
      </p>

      <Disclaimer />
    </div>
  );
}

/** The "Type" row of what an import will populate: the line as the card
 *  will print it (buildTypeLine) — a token's "Token" first ("Token Artifact
 *  — Treasure", TODO 3b.15), an emblem's "Emblem" (TODO 6.23), and every
 *  other card's words in printed order ("Land Creature — Forest Dryad",
 *  TODO 1.20), never the stored columns in stored order ("Creature land —
 *  Forest, Dryad"). */
export function importPatchTypeLine(
  patch: Pick<ScryfallImportPatch, "supertype" | "card_type" | "subtypes_text" | "printed_types">,
): string {
  return buildTypeLine({
    printedTypes: patch.printed_types,
    supertype: patch.supertype,
    cardType: patch.card_type,
    subtypes: parseSubtypes(patch.subtypes_text ?? ""),
  });
}

function PatchPreview({ patch }: { patch: ScryfallImportPatch }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (patch.cost) {
    rows.push({
      label: "Cost",
      value: <ManaCostGlyphs cost={patch.cost} size="sm" />,
    });
  }
  if (patch.card_type) {
    rows.push({
      label: "Type",
      value: (
        <span>{importPatchTypeLine(patch)}</span>
      ),
    });
  }
  if (patch.rarity) {
    rows.push({ label: "Rarity", value: <span className="capitalize">{patch.rarity}</span> });
  }
  if (patch.color_identity && patch.color_identity.length > 0) {
    rows.push({
      label: "Colors",
      value: (
        <span className="capitalize">{patch.color_identity.join(" · ")}</span>
      ),
    });
  }
  if (patch.rules_text) {
    rows.push({
      label: "Rules",
      value: (
        <InlinePips
          text={patch.rules_text}
          className="block whitespace-pre-line text-foreground/85"
        />
      ),
    });
  }
  if (patch.flavor_text) {
    rows.push({
      label: "Flavor",
      value: (
        <span className="italic text-subtle">{patch.flavor_text}</span>
      ),
    });
  }
  if (patch.power || patch.toughness) {
    rows.push({
      label: "P/T",
      value: `${patch.power ?? "—"} / ${patch.toughness ?? "—"}`,
    });
  }
  if (patch.artist_credit) {
    rows.push({ label: "Artist", value: patch.artist_credit });
  }
  // The printing's collector fields (TODO 4.9a): "DMU · 107/281 · EN".
  if (patch.collector) {
    const parts = [
      patch.collector.set_code,
      patch.collector.collector_number,
      patch.collector.lang.toUpperCase(),
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) rows.push({ label: "Collector", value: parts.join(" · ") });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        Will populate
      </span>
      <dl className="flex flex-col gap-1.5 rounded-md border border-border/40 bg-background/30 p-3 text-xs leading-5">
        {rows.length === 0 ? (
          <span className="text-subtle">No fields to populate.</span>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
              <dt className="text-[11px] uppercase tracking-wider text-subtle">
                {row.label}
              </dt>
              <dd className="text-foreground/90">{row.value}</dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] leading-5 text-muted">
      <Badge variant="accent" className="shrink-0">
        Heads up
      </Badge>
      <p>
        Imported text and artwork are the property of their respective
        rights holders. PipGlyph surfaces them so you can riff on real
        designs — rewrite the rules text and swap the art before
        publishing publicly to keep your card original.
      </p>
    </div>
  );
}
