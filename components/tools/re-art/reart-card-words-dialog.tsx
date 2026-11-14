"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/creator/field-group";
import { textareaClass } from "@/components/ui/field-classes";
import {
  REART_CARD_WORDS_MAX,
  buildReartPrompt,
  reartStateIsSettled,
  type ReartCardWords,
  type ReartStudioEntry,
  type ReartStyle,
} from "@/lib/tools/re-art/model";
import { saveReartCardWordsAction } from "@/lib/tools/re-art/actions";

// ---------------------------------------------------------------------------
// One card's own words (migration 0209): what its picture shows, written by
// the maker — the card's subject in the deck's look, or ("only these words")
// its whole prompt. The dialog shows the prompt exactly as it would be sent,
// built by the one function the step paints with (reartArtPrompt). Saving
// paints nothing and charges nothing.
// ---------------------------------------------------------------------------

export function ReartCardWordsDialog({
  open,
  onOpenChange,
  deckId,
  entry,
  style,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  entry: ReartStudioEntry;
  /** The style the form shows (the preview's). */
  style: ReartStyle;
  onSaved: (words: ReartCardWords | null) => void;
}) {
  const [text, setText] = useState(entry.words?.text ?? "");
  const [only, setOnly] = useState(entry.words?.only ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const onlyId = useId();
  const previewId = useId();

  // Every OPENING starts from the card's stored words — another card, the
  // same card after a save or a removal, or a draft that was abandoned
  // (state adjusted during render: no effect sets it). It used to reset
  // only for another card, so removed words came back in the box.
  const opening = `${entry.id}|${open}|${entry.words?.only ?? false}|${entry.words?.text ?? ""}`;
  const [shown, setShown] = useState(opening);
  if (shown !== opening) {
    setShown(opening);
    setText(entry.words?.text ?? "");
    setOnly(entry.words?.only ?? false);
    setError(null);
  }

  const words: ReartCardWords | null = text.trim() ? { text, only } : null;
  const { prompt, cut } = buildReartPrompt(
    { title: entry.name, typeLine: entry.typeLine, rulesText: entry.rulesText, flavorText: entry.flavorText },
    style,
    words,
  );
  const changed = (entry.words?.text ?? "") !== text.trim() || (entry.words?.only ?? false) !== (words ? only : false);

  const save = (next: ReartCardWords | null) => {
    setError(null);
    startSaving(async () => {
      const result = await saveReartCardWordsAction(deckId, entry.id, next ?? { text: "", only: false }).catch(() => null);
      if (!result) {
        setError("We couldn't reach PipGlyph — try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.words);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!saving ? onOpenChange(next) : undefined)}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Words for {entry.name}</DialogTitle>
          <DialogDescription>
            Write what this card&apos;s picture shows. Nothing is painted or charged here: the words are used the next
            time the card is painted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FieldGroup
            label="This card's own words"
            helper={`Its subject and scene, up to ${REART_CARD_WORDS_MAX} characters. Leave it empty to paint the card from its name and type.`}
          >
            <textarea
              value={text}
              maxLength={REART_CARD_WORDS_MAX}
              rows={5}
              onChange={(event) => setText(event.target.value.slice(0, REART_CARD_WORDS_MAX))}
              placeholder="e.g. an old goblin librarian asleep on a heap of overdue books, one candle burning low"
              className={textareaClass(false)}
            />
          </FieldGroup>
          <p className="-mt-2 text-right text-xs tabular-nums text-subtle">
            {text.length} of {REART_CARD_WORDS_MAX}
          </p>

          <label htmlFor={onlyId} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
            <input
              id={onlyId}
              type="checkbox"
              checked={only}
              onChange={(event) => setOnly(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>
              Use only these words for this card
              <span className="block text-xs text-muted">
                The deck&apos;s style is left out: the picture is painted from these words alone.
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-border/50 bg-elevated/40 p-3">
            <p id={previewId} className="text-xs font-medium text-foreground">
              What is sent for this card
            </p>
            <p aria-labelledby={previewId} className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted">
              {prompt}
            </p>
            {entry.kind === "printing" ? (
              <p className="mt-1 text-xs leading-5 text-subtle">A real card&apos;s flavour and rules text are read when it is painted.</p>
            ) : null}
            {cut ? (
              <p className="mt-1 text-xs leading-5 text-warning">
                This is longer than a picture&apos;s prompt can be: its end is left out.
              </p>
            ) : null}
          </div>

          {reartStateIsSettled(entry.state) ? (
            <p className="text-xs text-muted">This card is painted already: re-roll it to paint it with these words.</p>
          ) : null}
        </div>

        {/* A refusal or a lost connection is the dialog's ONE alert (the
            words themselves are never "invalid": nothing is wrong in the
            field), said where a screen reader hears it. */}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-wrap gap-2">
          {entry.words ? (
            <Button variant="ghost" className="mr-auto" onClick={() => save(null)} disabled={saving}>
              Remove its words
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (changed && !saving) save(words);
            }}
            aria-disabled={!changed || saving ? true : undefined}
            className={!changed || saving ? "cursor-not-allowed opacity-60" : undefined}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save words
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
