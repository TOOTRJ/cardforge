"use client";

import { useId, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { textareaClass } from "@/components/ui/field-classes";
import { STYLE_PRESETS, SURPRISE_PRESET_ID } from "@/lib/ai/presets";
import {
  REART_PLACEHOLDERS,
  REART_PROMPT_MAX,
  REART_THEME_IDEAS,
  REART_THEME_MAX,
  reartClosingLine,
  reartPromptNamesCard,
  reartStyleBlock,
  type NormalReartStyle,
  type ReartFraming,
  type ReartStyleMode,
} from "@/lib/tools/re-art/model";

const PRESET_OPTIONS: ChipOption<string>[] = [
  { value: SURPRISE_PRESET_ID, label: "No preset", description: "Your words alone set the look." },
  ...STYLE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, description: preset.art })),
];

const MODE_OPTIONS: ChipOption<ReartStyleMode>[] = [
  { value: "preset", label: "Pick a style", description: "A preset and a few words about the deck's world." },
  { value: "custom", label: "Write my own prompt", description: "Every word of the prompt is yours." },
];

/** The maker's own prompt starts from the look the form shows: the card's
 *  subject, then the style block's words — theirs to rewrite. */
export function starterPrompt(style: NormalReartStyle, framing: ReartFraming = "flux2"): string {
  return `{card}. ${reartStyleBlock(style, framing)}`.slice(0, REART_PROMPT_MAX);
}

/**
 * Step 1 of the studio: the deck's prompt. Either the tool's template — a
 * preset, the deck's world in the maker's own words (with a few starting
 * points) and the block every picture's prompt shares — or the maker's OWN
 * prompt (migration 0209), every word theirs, with the card's facts named
 * in braces. Saving is explicit; a run saves the style it paints in too.
 */
export function ReartStylePanel({
  style,
  onChange,
  dirty,
  saved,
  saving,
  onSave,
  onReset,
  problem,
  saveError,
  paintedInSaved,
  preview,
  framing = "flux2",
}: {
  style: NormalReartStyle;
  onChange: (next: NormalReartStyle) => void;
  /** The form differs from the deck's saved style (or none is saved). */
  dirty: boolean;
  /** A style is saved for the deck. */
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  /** Puts the form back to the deck's saved style (offered while the form
   *  differs from it): one card is painted in the saved style only, so an
   *  edit made by mistake needs a way back that doesn't save a new look. */
  onReset?: () => void;
  problem: string | null;
  saveError: string | null;
  /** Cards painted in the saved style (a new style starts a new look). */
  paintedInSaved: number;
  /** One card's whole prompt as the form's style would send it (the maker's
   *  own prompt shows it; null: the deck has no card to show). */
  preview?: { name: string; prompt: string; partial: boolean; cut?: boolean } | null;
  /** The wording the picked model is sent (the studio's model picker): the
   *  shared block is shown — and a prompt of the maker's own started — in
   *  it. Absent: FLUX.2's, what every run was sent before the picker. */
  framing?: ReartFraming;
}) {
  const themeId = useId();
  const blockId = useId();
  const promptId = useId();
  const themeRef = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const custom = style.mode === "custom";

  /** A brace name put where the caret is (or over the selection). */
  const insert = (token: string) => {
    const field = promptRef.current;
    const at = field ? field.selectionStart : style.prompt.length;
    const end = field ? field.selectionEnd : style.prompt.length;
    const next = `${style.prompt.slice(0, at)}${token}${style.prompt.slice(end)}`.slice(0, REART_PROMPT_MAX);
    onChange({ ...style, prompt: next });
    requestAnimationFrame(() => {
      const target = promptRef.current;
      if (!target) return;
      target.focus();
      const caret = Math.min(at + token.length, next.length);
      target.setSelectionRange(caret, caret);
    });
  };

  return (
    <section aria-labelledby="reart-style" className="flex flex-col gap-4 rounded-frame border border-border/60 bg-surface/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="reart-style" className="font-display text-lg text-foreground">
          1. The deck&apos;s style
        </h2>
        {saved && !dirty ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" aria-hidden /> Saved for this deck
          </span>
        ) : saved ? (
          <span className="text-xs text-warning">Changed — not saved yet</span>
        ) : null}
      </div>

      <FieldGroup
        kind="control"
        label="How the prompt is made"
        helper={
          custom
            ? "Every picture is painted from the words you write below."
            : "The tool writes each card's prompt from its name and text, in the look you pick."
        }
      >
        {(aria) => (
          <ChipGroup
            ariaLabel="How the prompt is made"
            ariaDescribedBy={aria["aria-describedby"]}
            keepCase
            size="sm"
            options={MODE_OPTIONS}
            value={style.mode}
            onChange={(next) =>
              // The first time: the maker's own prompt starts from the look
              // the form shows, so nothing is lost by switching.
              onChange({ ...style, mode: next, prompt: next === "custom" && !style.prompt.trim() ? starterPrompt(style, framing) : style.prompt })
            }
          />
        )}
      </FieldGroup>

      {custom ? (
        <>
          <FieldGroup
            label="The deck's prompt"
            helper={`Write exactly what every picture should look like (up to ${REART_PROMPT_MAX.toLocaleString("en-US")} characters). A name in braces is filled in for each card.`}
          >
            <textarea
              id={promptId}
              ref={promptRef}
              value={style.prompt}
              maxLength={REART_PROMPT_MAX}
              rows={9}
              onChange={(event) => onChange({ ...style, prompt: event.target.value.slice(0, REART_PROMPT_MAX) })}
              placeholder="e.g. {card}. A moody oil painting, candle-lit, deep greens and gold, thick visible brushwork"
              className={textareaClass(false)}
            />
          </FieldGroup>
          <p className="-mt-2 text-right text-xs tabular-nums text-subtle">
            {style.prompt.length.toLocaleString("en-US")} of {REART_PROMPT_MAX.toLocaleString("en-US")}
          </p>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted" id={`${promptId}-names`}>
              Add a card&apos;s own facts:
            </p>
            <ul aria-labelledby={`${promptId}-names`} className="flex flex-wrap gap-1.5">
              {REART_PLACEHOLDERS.map((name) => (
                <li key={name.token}>
                  <button
                    type="button"
                    onClick={() => insert(name.token)}
                    title={name.hint}
                    aria-label={`Add ${name.token} — ${name.hint}`}
                    className="rounded-full border border-border/70 px-2.5 py-1 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                  >
                    {name.token}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {style.prompt.trim() && !reartPromptNamesCard(style.prompt) ? (
            <p className="text-xs text-warning">
              This prompt names no card, so every card is painted from the same words. Add {"{card}"} where the
              card&apos;s subject goes.
            </p>
          ) : null}

          <div className="rounded-lg border border-border/50 bg-elevated/40 p-3">
            <p id={blockId} className="text-xs font-medium text-foreground">
              {preview ? `What is sent for ${preview.name}` : "What is sent for each card"}
            </p>
            <p aria-labelledby={blockId} className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted">
              {preview ? preview.prompt : `Your prompt, then: ${reartClosingLine(framing)}`}
            </p>
            <p className="mt-1 text-xs leading-5 text-subtle">
              The last line is always added: the picture is art for a card, never a card.
              {preview?.partial ? " A real card's flavour and rules text are read when it is painted." : ""}
            </p>
            {preview?.cut ? (
              <p className="mt-1 text-xs leading-5 text-warning">
                With the card&apos;s facts filled in this is longer than a picture&apos;s prompt can be: its end is left
                out. Use fewer braces or fewer words.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <FieldGroup kind="control" label="Style" helper="How every picture is painted.">
            {(aria) => (
              <ChipGroup
                ariaLabel="Style"
                ariaDescribedBy={aria["aria-describedby"]}
                keepCase
                size="sm"
                options={PRESET_OPTIONS}
                value={style.preset}
                onChange={(next) => onChange({ ...style, preset: next })}
              />
            )}
          </FieldGroup>

          <FieldGroup
            label="The deck's world and look"
            helper={`Places, palette, light, mood — a few words or a sentence (up to ${REART_THEME_MAX} characters). Every card is painted in it.`}
          >
            <textarea
              id={themeId}
              ref={themeRef}
              value={style.theme}
              maxLength={REART_THEME_MAX}
              rows={3}
              onChange={(event) => onChange({ ...style, theme: event.target.value.slice(0, REART_THEME_MAX) })}
              placeholder="e.g. a sunken clockwork city under a green sea, brass and teal, shafts of light"
              className={textareaClass(false)}
            />
          </FieldGroup>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted" id={`${themeId}-ideas`}>
              Start from an idea:
            </p>
            <ul aria-labelledby={`${themeId}-ideas`} className="flex flex-wrap gap-1.5">
              {REART_THEME_IDEAS.map((idea) => (
                <li key={idea.label}>
                  <button
                    type="button"
                    onClick={() => onChange({ ...style, theme: idea.theme })}
                    className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                  >
                    {idea.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border/50 bg-elevated/40 p-3">
            <p id={blockId} className="text-xs font-medium text-foreground">
              Every picture&apos;s prompt shares this
            </p>
            <p aria-labelledby={blockId} className="mt-1 text-xs leading-5 text-muted">
              {reartStyleBlock(style, framing)}
            </p>
            <p className="mt-1 text-xs leading-5 text-subtle">
              Before it: each card&apos;s own name, type and flavour — or the words you give that card.
            </p>
          </div>
        </>
      )}

      {dirty && paintedInSaved > 0 ? (
        <p className="text-xs text-warning">
          A new style starts a new look: the {paintedInSaved} card{paintedInSaved === 1 ? "" : "s"} painted in the saved
          style will be painted again when you re-art the deck.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!problem && dirty && !saving) onSave();
          }}
          aria-disabled={problem || !dirty || saving ? true : undefined}
          aria-describedby={problem ? `${themeId}-problem` : undefined}
          className={problem || !dirty || saving ? "cursor-not-allowed opacity-60" : undefined}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save style
        </Button>
        {saved && dirty && onReset ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onReset();
              // The button removes itself: the focus goes to the words it
              // put back (the saved style's own field).
              requestAnimationFrame(() => (promptRef.current ?? themeRef.current)?.focus());
            }}
          >
            Undo changes
          </Button>
        ) : null}
        {problem ? (
          <p id={`${themeId}-problem`} className="text-xs text-muted">
            {problem}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-xs text-danger">
            {saveError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
