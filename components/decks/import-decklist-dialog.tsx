"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  HelpCircle,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  commitDeckImportAction,
  resolveDecklistAction,
  type ImportReviewLine,
} from "@/lib/decks/import";
import { DECK_BOARD_LABELS, DECK_BOARD_VALUES } from "@/types/deck";
import type { ParseWarning } from "@/lib/decks/parse-decklist";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ImportDecklistDialog — paste → resolve → review → commit.
//
// Accepts exports from MTG Arena, Moxfield, Archidekt, ManaBox, and plain
// MTGO text (auto-detected — no format picker). Nothing is written until
// the user confirms the review step; every skipped or unresolved line is
// shown with its source line number and can be fixed inline.
// ---------------------------------------------------------------------------

type ImportDecklistDialogProps = {
  deckId: string;
  /** Rendered as the trigger; defaults to an "Import decklist" button. */
  triggerLabel?: string;
};

type Step = "paste" | "review";

export function ImportDecklistDialog({
  deckId,
  triggerLabel = "Import decklist",
}: ImportDecklistDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [lines, setLines] = useState<ImportReviewLine[]>([]);
  const [parseWarnings, setParseWarnings] = useState<ParseWarning[]>([]);
  const [isResolving, startResolving] = useTransition();
  const [isCommitting, startCommitting] = useTransition();

  const reset = () => {
    setStep("paste");
    setLines([]);
    setParseWarnings([]);
  };

  const handleResolve = () => {
    startResolving(async () => {
      const result = await resolveDecklistAction({ text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLines(result.lines);
      setParseWarnings(result.parseWarnings);
      setStep("review");
    });
  };

  const handleCommit = () => {
    const keep = lines.filter((line) => line.quantity > 0);
    if (keep.length === 0) {
      toast.error("Nothing left to import.");
      return;
    }
    startCommitting(async () => {
      const result = await commitDeckImportAction({
        deckId,
        lines: keep.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          board: line.board,
          resolved: line.resolved,
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const bits = [
        `${result.added} added`,
        result.merged > 0 ? `${result.merged} merged` : null,
        result.placeholders > 0
          ? `${result.placeholders} placeholder${result.placeholders === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean);
      toast.success(`Decklist imported — ${bits.join(", ")}.`);
      setOpen(false);
      setText("");
      reset();
      router.refresh();
    });
  };

  const updateLine = (index: number, patch: Partial<ImportReviewLine>) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  };

  const counts = useMemo(() => {
    const kept = lines.filter((l) => l.quantity > 0);
    return {
      resolved: kept.filter((l) => l.status === "resolved").length,
      fuzzy: kept.filter((l) => l.status === "fuzzy").length,
      unresolved: kept.filter((l) => l.status === "unresolved").length,
      cards: kept.reduce((sum, l) => sum + l.quantity, 0),
    };
  }, [lines]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <ClipboardPaste className="h-4 w-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Import a decklist</DialogTitle>
          <DialogDescription>
            Paste a list from Moxfield, Archidekt, MTG Arena, ManaBox, or
            plain text. You&apos;ll review everything before it&apos;s added.
          </DialogDescription>
        </DialogHeader>

        {step === "paste" ? (
          <div className="flex flex-col gap-4">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              placeholder={
                "4 Lightning Bolt\n4 Monastery Swiftspear (KTK) 118\n20 Mountain\n\nSideboard\n3 Pyroblast"
              }
              aria-label="Decklist text"
              className="w-full rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs leading-5 text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {text.trim()
                  ? `${text.trim().split(/\r\n|\r|\n/).filter(Boolean).length} lines`
                  : "Sideboard, Commander, and Maybeboard sections are detected automatically."}
              </span>
              <Button
                type="button"
                onClick={handleResolve}
                disabled={!text.trim() || isResolving}
              >
                {isResolving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden />
                )}
                {isResolving ? "Matching cards…" : "Preview import"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="primary">{counts.cards} cards</Badge>
              <Badge>{counts.resolved} matched</Badge>
              {counts.fuzzy > 0 ? (
                <Badge variant="accent">{counts.fuzzy} best-guess</Badge>
              ) : null}
              {counts.unresolved > 0 ? (
                <Badge variant="outline">{counts.unresolved} not found</Badge>
              ) : null}
            </div>

            {parseWarnings.length > 0 ? (
              <div className="rounded-md border border-gold/40 bg-gold/5 p-3">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gold">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {parseWarnings.length} line
                  {parseWarnings.length === 1 ? "" : "s"} skipped or adjusted
                </span>
                <ul className="flex flex-col gap-0.5 text-xs text-muted">
                  {parseWarnings.slice(0, 8).map((warning) => (
                    <li key={`${warning.line}-${warning.reason}`}>
                      Line {warning.line}: {warning.reason}{" "}
                      {warning.raw ? (
                        <span className="font-mono text-subtle">
                          ({warning.raw.slice(0, 60)})
                        </span>
                      ) : null}
                    </li>
                  ))}
                  {parseWarnings.length > 8 ? (
                    <li>…and {parseWarnings.length - 8} more.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <ul className="flex flex-col divide-y divide-border/40">
              {lines.map((line, index) =>
                line.quantity === 0 ? null : (
                  <ReviewRow
                    key={`${line.line}-${line.name}-${line.board}`}
                    line={line}
                    onChange={(patch) => updateLine(index, patch)}
                  />
                ),
              )}
            </ul>

            <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border/50 bg-surface/95 py-3 backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("paste")}
                disabled={isCommitting}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleCommit}
                disabled={isCommitting || counts.cards === 0}
              >
                {isCommitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" aria-hidden />
                )}
                {isCommitting
                  ? "Importing…"
                  : `Add ${counts.cards} card${counts.cards === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  line,
  onChange,
}: {
  line: ImportReviewLine;
  onChange: (patch: Partial<ImportReviewLine>) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      {line.resolved?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={line.resolved.image_url}
          alt=""
          className="h-12 w-9 shrink-0 rounded-sm object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded-sm bg-elevated">
          <HelpCircle className="h-4 w-4 text-subtle" aria-hidden />
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-foreground">
          {line.resolved?.name ?? line.name}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-subtle">
          {line.status === "resolved" ? (
            <span className="text-muted">
              {line.resolved?.set_code?.toUpperCase()}{" "}
              {line.resolved?.collector_number}
            </span>
          ) : line.status === "fuzzy" ? (
            <span className="text-gold">
              Best guess for “{line.name}” — check it&apos;s right
            </span>
          ) : (
            <span className="text-danger">
              Not found — imports as a name-only placeholder
            </span>
          )}
        </span>
      </div>

      <input
        type="number"
        min={1}
        max={250}
        value={line.quantity}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          onChange({
            quantity: Number.isFinite(next) ? Math.max(1, Math.min(next, 250)) : 1,
          });
        }}
        aria-label={`Quantity of ${line.name}`}
        className="h-8 w-14 shrink-0 rounded-md border border-border bg-background/60 px-2 text-center text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
      />

      <select
        value={line.board}
        onChange={(event) =>
          onChange({
            board: event.target.value as ImportReviewLine["board"],
          })
        }
        aria-label={`Board for ${line.name}`}
        className="h-8 shrink-0 rounded-md border border-border bg-background/60 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
      >
        {DECK_BOARD_VALUES.map((board) => (
          <option key={board} value={board}>
            {DECK_BOARD_LABELS[board]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => onChange({ quantity: 0 })}
        aria-label={`Remove ${line.name}`}
        className={cn(
          "shrink-0 rounded-md p-1.5 text-muted transition-colors",
          "hover:bg-elevated hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}
