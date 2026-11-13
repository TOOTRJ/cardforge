"use client";

import { useId, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup } from "@/components/creator/field-group";
import { textareaClass } from "@/components/ui/field-classes";
import { STYLE_PRESETS, SURPRISE_PRESET_ID } from "@/lib/ai/presets";
import {
  REART_THEME_IDEAS,
  REART_THEME_MAX,
  reartStyleBlock,
  type ReartStyle,
} from "@/lib/tools/re-art/model";

const PRESET_OPTIONS: ChipOption<string>[] = [
  { value: SURPRISE_PRESET_ID, label: "No preset", description: "Your words alone set the look." },
  ...STYLE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label, description: preset.art })),
];

/**
 * Step 1 of the studio: the deck's ONE style — a preset, the deck's world in
 * the maker's own words (with a few starting points), and the exact block
 * every picture's prompt will share. Saving is explicit; a run saves the
 * style it paints in too.
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
}: {
  style: ReartStyle;
  onChange: (next: ReartStyle) => void;
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
}) {
  const themeId = useId();
  const blockId = useId();
  const themeRef = useRef<HTMLTextAreaElement>(null);
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
          {reartStyleBlock(style)}
        </p>
        <p className="mt-1 text-xs leading-5 text-subtle">Before it: each card&apos;s own name, type and flavour.</p>
      </div>

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
              // put back.
              requestAnimationFrame(() => themeRef.current?.focus());
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
