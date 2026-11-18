"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { cn } from "@/lib/utils";
import {
  REART_CARD_WORDS_MAX,
  REART_SCENE_HELP,
  REART_SCENE_ONLY_NOTE,
  buildReartPrompt,
  reartSceneCost,
  reartStateIsSettled,
  type ReartCardWords,
  type ReartFraming,
  type ReartMethod,
  type ReartStudioEntry,
  type ReartStyle,
} from "@/lib/tools/re-art/model";
import { saveReartCardWordsAction } from "@/lib/tools/re-art/actions";
import { requestReartScene } from "@/lib/tools/re-art/scene-client";

// ---------------------------------------------------------------------------
// One card's own words (migration 0209): what its picture shows, written by
// the maker — the card's subject in the deck's look, or ("only these words")
// its whole prompt. The dialog shows the prompt exactly as it would be sent,
// built by the one function the step paints with (reartArtPrompt). Saving
// paints nothing and charges nothing.
//
// "Write a scene with AI" (migration 0217, one credit) has the text model
// write the words: the server SAVES them as the card's words before it
// answers, so the box then shows what is stored. The maker's direction has a
// box of its own (never the words' box: pressing again would hand the
// writer its own last scene back as the direction). The words the card had
// — in the box, or stored — stay one press away ("Put back the words it
// had") until the dialog closes.
// ---------------------------------------------------------------------------

export function ReartCardWordsDialog({
  open,
  onOpenChange,
  deckId,
  entry,
  style,
  framing = "flux2",
  bodyMax,
  method = "paint",
  onSaved,
  scene,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  entry: ReartStudioEntry;
  /** The style the form shows (the preview's). */
  style: ReartStyle;
  /** The wording the picked model is sent (the preview's). */
  framing?: ReartFraming;
  /** The most of a prompt's body the picked model reads (absent: the
   *  tool's own limit). */
  bodyMax?: number;
  /** What the picture starts from (the preview's): the prompt alone, or the
   *  card's own art. */
  method?: ReartMethod;
  onSaved: (words: ReartCardWords | null) => void;
  /** "Write a scene with AI" (one credit). Absent: not offered (no text
   *  model here, or a run that starts from the card's own art, where the
   *  words say what CHANGES, not a scene). */
  scene?: {
    /** A scene was written and SAVED as the card's words (the dialog stays
     *  open on it). `credits`: the balance after, where it is known. */
    onWritten: (words: ReartCardWords, credits: number | null) => void;
    /** The maker has no credit left for one. */
    onOutOfCredits?: () => void;
    /** Why a scene can't be written right now (the form shows a style that
     *  isn't saved: the scene is written for the deck's SAVED world), or
     *  null. */
    blocked?: string | null;
  };
}) {
  const [text, setText] = useState(entry.words?.text ?? "");
  const [only, setOnly] = useState(entry.words?.only ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [writing, setWriting] = useState(false);
  /** The maker's direction for the writer (optional). */
  const [direction, setDirection] = useState("");
  /** A scene was written for this card in this opening: the words the card
   *  had before it — what the box held, else what was stored (the way
   *  back) — and whether it was set to "only these words". */
  const [written, setWritten] = useState<{ entryId: string; before: string; beforeOnly: boolean } | null>(null);
  const onlyId = useId();
  const previewId = useId();
  const sceneHelpId = useId();
  const sceneBlockedId = useId();
  const directionId = useId();

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
    // The way back, and the direction, last for this opening of this card
    // (the page re-reading the scene just written is not a new opening).
    if (!open || written?.entryId !== entry.id) {
      setWritten(null);
      setDirection("");
    }
  }

  const words: ReartCardWords | null = text.trim() ? { text, only } : null;
  const { prompt, cut } = buildReartPrompt(
    { title: entry.name, typeLine: entry.typeLine, rulesText: entry.rulesText, flavorText: entry.flavorText },
    style,
    words,
    framing,
    bodyMax,
    method,
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

  const writeScene = async () => {
    if (!scene || scene.blocked || writing || saving) return;
    setError(null);
    setWriting(true);
    const box = { text, only };
    const result = await requestReartScene({ deckId, entryId: entry.id, note: direction });
    setWriting(false);
    if (!result.ok) {
      setError(result.error);
      if (result.code === "INSUFFICIENT_CREDITS") scene.onOutOfCredits?.();
      return;
    }
    setText(result.words.text);
    setOnly(result.words.only);
    // The way back: the words the box held; with an empty box, the words
    // the card had STORED (the server hands them back) — never lost without
    // a word. The first scene's way back is kept when another is written.
    setWritten((earlier) =>
      earlier?.entryId === entry.id
        ? earlier
        : box.text.trim()
          ? { entryId: entry.id, before: box.text, beforeOnly: box.only }
          : { entryId: entry.id, before: result.previous?.text ?? "", beforeOnly: result.previous?.only ?? false },
    );
    scene.onWritten(result.words, result.credits);
  };
  const busy = saving || writing;
  const sceneOff = busy || Boolean(scene?.blocked);

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Words for {entry.name}</DialogTitle>
          <DialogDescription>
            Write what this card&apos;s picture shows. Nothing is painted here, and saving your own words is free: the
            words are used the next time the card is painted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FieldGroup
            label="This card's own words"
            helper={
              method === "restyle"
                ? `What changes in this card's picture, up to ${REART_CARD_WORDS_MAX} characters. Leave it empty to repaint its art in the deck's style alone.`
                : `Its subject and scene, up to ${REART_CARD_WORDS_MAX} characters. Leave it empty to paint the card from its name and type.`
            }
          >
            <textarea
              value={text}
              maxLength={REART_CARD_WORDS_MAX}
              rows={5}
              onChange={(event) => setText(event.target.value.slice(0, REART_CARD_WORDS_MAX))}
              placeholder="e.g. an old goblin librarian asleep on a heap of overdue books, one candle burning low"
              className={textareaClass(false)}
              readOnly={writing}
              aria-busy={writing ? true : undefined}
            />
          </FieldGroup>
          <p className="-mt-2 text-right text-xs tabular-nums text-subtle">
            {text.length} of {REART_CARD_WORDS_MAX}
          </p>

          {scene ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-3">
              <label htmlFor={directionId} className="flex flex-col gap-1 text-xs text-muted">
                Direction for the writer (optional)
                <input
                  id={directionId}
                  type="text"
                  value={direction}
                  maxLength={REART_CARD_WORDS_MAX}
                  onChange={(event) => setDirection(event.target.value.slice(0, REART_CARD_WORDS_MAX))}
                  placeholder="e.g. seen from above at dawn"
                  className={inputClass(false)}
                  readOnly={writing}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void writeScene()}
                  aria-disabled={sceneOff ? true : undefined}
                  aria-describedby={cn(sceneHelpId, scene.blocked && sceneBlockedId)}
                  className={sceneOff ? "cursor-not-allowed opacity-60" : undefined}
                >
                  {writing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                  {writing ? "Writing the scene…" : written ? `Write another scene · ${reartSceneCost(1)}` : `Write a scene with AI · ${reartSceneCost(1)}`}
                </Button>
                {written && written.before.trim() && written.before.trim() !== text.trim() ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    // The box only: the scene stays the card's stored words
                    // (and the dialog goes on saying so) until Save.
                    onClick={() => {
                      setText(written.before);
                      setOnly(written.beforeOnly);
                    }}
                    disabled={busy}
                  >
                    Put back the words it had
                  </Button>
                ) : null}
              </div>
              <p id={sceneHelpId} className="text-xs leading-5 text-muted">
                {REART_SCENE_HELP}
              </p>
              {scene.blocked ? (
                <p id={sceneBlockedId} className="text-xs leading-5 text-warning">
                  {scene.blocked}
                </p>
              ) : null}
              {written ? (
                <p role="status" className="text-xs leading-5 text-foreground">
                  Scene written and saved ({reartSceneCost(1)}): it is this card&apos;s words now. To store what the box
                  shows instead, press Save words.{written.beforeOnly ? ` ${REART_SCENE_ONLY_NOTE}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

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
            {method === "restyle" ? (
              <p className="mt-1 text-xs leading-5 text-subtle">It is sent with the card&apos;s own art: the picture is the subject.</p>
            ) : entry.kind === "printing" ? (
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
            <Button variant="ghost" className="mr-auto" onClick={() => save(null)} disabled={busy}>
              Remove its words
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {/* After a scene there is nothing to cancel — it is saved — unless
                the box was changed since: that draft is what Cancel drops. */}
            {written && !changed ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={() => {
              if (changed && !busy) save(words);
            }}
            aria-disabled={!changed || busy ? true : undefined}
            className={!changed || busy ? "cursor-not-allowed opacity-60" : undefined}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save words
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
