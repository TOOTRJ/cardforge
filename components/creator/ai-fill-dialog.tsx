"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, Coins, Dices, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { CreditMeter } from "@/components/billing/credit-meter";
import { PremiumBadge } from "@/components/billing/premium-badge";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { isBillingEnabled } from "@/lib/billing/flags";
import type { DeckOption } from "@/components/creator/panels/publish-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CARD_TYPE_OPTIONS, FieldGroup, inputClass } from "@/components/creator/field-group";
import { FrameThumb } from "@/components/creator/frame-pickers";
import {
  CARD_FILL_FIELDS,
  CREATE_ONLY_FILL_FIELDS,
  FILL_FIELD_LABELS,
  type CardFillField,
} from "@/lib/ai/card-fill-shared";
import {
  STYLE_PRESETS,
  SURPRISE_PRESET_ID,
  THEME_PRESETS,
  TWIST_MAX,
  composeStyle,
  composeTheme,
} from "@/lib/ai/presets";
import {
  AI_DESIGN_KINDS,
  aiFrameOptions,
  aiKindOffReason,
  frameColorWords,
  type AiDesignKind,
} from "@/lib/ai/frame-choices";
import type { FrameColorKey } from "@/lib/creator/card-kinds";
import {
  RARITY_VALUES,
  type CardType,
  type FrameTemplate,
  type Rarity,
  RARITY_LABELS,
} from "@/types/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// AiFillDialog — "Generate with AI". The maker says what the card is ABOUT
// (a theme: a preset world, their own twist, or both) and how it should
// LOOK (an art style, the same way), then — when the card's type is being
// written — which kind of card and which frame. The design is made for the
// frame picked; "Surprise me" leaves either choice to the AI.
//
// The tick-set (which fields the AI writes) is unchanged: everything
// unticked stays exactly as it is in the form and is fed to the designer as
// fixed context (owner decision 2026-09-16). One credit per run whatever is
// ticked. Opened from the Start-with hero (everything ticked), the Identity
// step's "Generate AI artwork and title", and the Text & stats step's
// button; also on edit and remix, where the structural fields aren't
// offered.
//
// Presets are data (lib/ai/presets.ts); the kinds and frames offered are
// lib/ai/frame-choices.ts.
// ---------------------------------------------------------------------------

export type AiFillOptions = {
  want: CardFillField[];
  /** The composed theme / style (preset words + the maker's twist). */
  theme?: string;
  style?: string;
  /** The parts they were composed from, for the server to compose itself. */
  theme_preset?: string;
  theme_twist?: string;
  style_preset?: string;
  style_twist?: string;
  /** Steering for ticked fields. */
  card_type?: CardType;
  rarity?: Rarity;
  frame?: FrameTemplate | "random";
  /** Pro: design for this deck (create only). */
  deck_id?: string;
};

type AiFillDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which fields start ticked each time the dialog opens. */
  initialFields: CardFillField[];
  /** Edit / remix: the structural fields are locked and not offered. */
  revise: boolean;
  /** Label for the stats row — "Loyalty" for a planeswalker, etc. */
  statsLabel: string;
  /** False when the card type prints no stat line (instants, sorceries…):
   *  the stats option is not offered. */
  statsAvailable: boolean;
  verifiedFrameKeys: string[];
  /** The card's colour key as the form holds it, or null when it has none.
   *  While the Colors field isn't being written, only frames published in
   *  this colour can be picked. */
  colorKey?: FrameColorKey | null;
  generating: boolean;
  onGenerate: (options: AiFillOptions) => void;
  myDecks?: DeckOption[] | null;
  canDesignForDeck?: boolean;
  /** Fields the open card can't have, never offered: an emblem's cost,
   *  colour, rarity and stats (EMBLEM_UNFILLED_FIELDS, TODO 6.23). */
  hiddenFields?: readonly CardFillField[];
};

export function AiFillDialog({
  open,
  onOpenChange,
  generating,
  ...body
}: AiFillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !generating && onOpenChange(next)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl">
        {/* DialogContent unmounts its children when closed, so the body's
            state (the tick-set) starts fresh from the preset each open. */}
        <AiFillDialogBody generating={generating} {...body} />
      </DialogContent>
    </Dialog>
  );
}

const SURPRISE = SURPRISE_PRESET_ID;
type Surprise = typeof SURPRISE;

const surpriseChip = (description?: string): ChipOption<Surprise> => ({
  value: SURPRISE,
  label: "Surprise me",
  icon: Dices,
  description,
});

const THEME_OPTIONS: ChipOption<string>[] = [
  surpriseChip(),
  ...THEME_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

const STYLE_OPTIONS: ChipOption<string>[] = [
  surpriseChip(),
  ...STYLE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

function AiFillDialogBody({
  initialFields,
  revise,
  statsLabel,
  statsAvailable,
  verifiedFrameKeys,
  colorKey = null,
  generating,
  onGenerate,
  myDecks = null,
  canDesignForDeck = false,
  hiddenFields = [],
}: Omit<AiFillDialogProps, "open" | "onOpenChange">) {
  const upgrade = useUpgradeModal();
  const [want, setWant] = useState<Set<CardFillField>>(
    () => new Set(initialFields),
  );
  const [themePreset, setThemePreset] = useState<string>(SURPRISE);
  const [themeTwist, setThemeTwist] = useState("");
  const [stylePreset, setStylePreset] = useState<string>(SURPRISE);
  const [styleTwist, setStyleTwist] = useState("");
  const [kind, setKind] = useState<AiDesignKind | Surprise>(SURPRISE);
  const [frame, setFrame] = useState<FrameTemplate | Surprise>(SURPRISE);
  const [framesOpen, setFramesOpen] = useState(false);
  const [rarity, setRarity] = useState<Rarity | "random">("random");
  const [deckId, setDeckId] = useState<string>("");
  const decks = revise ? [] : (myDecks ?? []);
  const selectedDeck = decks.find((d) => d.id === deckId) ?? null;
  const verified = useMemo(() => new Set(verifiedFrameKeys), [verifiedFrameKeys]);
  const framesRegionId = useId();

  const offered = CARD_FILL_FIELDS.filter(
    (field) =>
      (!revise || !CREATE_ONLY_FILL_FIELDS.includes(field)) &&
      !hiddenFields.includes(field) &&
      // Stats only when the type prints them — unless the type itself is
      // being generated (create), in which case the AI decides.
      (field !== "stats" || statsAvailable || (!revise && want.has("card_type"))),
  );
  const allTicked = offered.every((f) => want.has(f));

  const wantsType = !revise && want.has("card_type");
  const wantsRarity = want.has("rarity");
  // The colour the frame must be published in: none while the AI writes the
  // colour (it is then held to the frame's colours) or the card has none.
  const pinnedColor: FrameColorKey | null =
    revise || !want.has("color_identity") ? colorKey : null;

  const kindOptions = useMemo<ChipOption<AiDesignKind | Surprise>[]>(
    () => [
      surpriseChip(),
      ...AI_DESIGN_KINDS.map((value) => {
        const base = CARD_TYPE_OPTIONS.find((option) => option.value === value);
        const reason = aiKindOffReason(value, verified);
        return {
          value,
          label: base?.label ?? value,
          icon: base?.icon,
          disabled: reason !== null,
          description: reason ?? undefined,
        };
      }),
    ],
    [verified],
  );

  const frameOptions = useMemo(
    () => (kind === SURPRISE ? [] : aiFrameOptions(kind, verified, pinnedColor)),
    [kind, verified, pinnedColor],
  );
  const pickedFrame = frame === SURPRISE ? null : frameOptions.find((option) => option.template === frame) ?? null;
  // A frame the colour no longer allows (the Colors tick changed) is no
  // longer a pick: back to Surprise me.
  const frameValue: FrameTemplate | Surprise = pickedFrame && !pickedFrame.offReason ? pickedFrame.template : SURPRISE;
  const pickableFrames = frameOptions.filter((option) => !option.offReason).length;

  const frameChips = useMemo<ChipOption<FrameTemplate | Surprise>[]>(
    () => [
      surpriseChip("Any frame published for it"),
      ...frameOptions.map((option) => ({
        value: option.template,
        label: option.label,
        description: option.offReason ?? option.eraLabel,
        disabled: option.offReason !== null,
        leading: (
          <FrameThumb
            template={option.template}
            colorKey={pinnedColor && option.colorKeys.includes(pinnedColor) ? pinnedColor : option.colorKeys[0]}
          />
        ),
      })),
    ],
    [frameOptions, pinnedColor],
  );

  const toggle = (field: CardFillField) =>
    setWant((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const handleDeckChange = (nextId: string) => {
    setDeckId(nextId);
    const deck = decks.find((d) => d.id === nextId);
    if (deck?.theme) setThemeTwist(deck.theme.slice(0, TWIST_MAX));
    if (deck?.style) setStyleTwist(deck.style.slice(0, TWIST_MAX));
  };

  const handleKindChange = (next: AiDesignKind | Surprise) => {
    setKind(next);
    setFrame(SURPRISE);
    if (next === SURPRISE) setFramesOpen(false);
  };

  const handleGenerate = () => {
    const themeId = themePreset === SURPRISE ? undefined : themePreset;
    const styleId = stylePreset === SURPRISE ? undefined : stylePreset;
    onGenerate({
      want: offered.filter((f) => want.has(f)),
      theme: composeTheme(themeId, themeTwist),
      style: composeStyle(styleId, styleTwist),
      theme_preset: themeId,
      theme_twist: themeTwist.trim() || undefined,
      style_preset: styleId,
      style_twist: styleTwist.trim() || undefined,
      card_type: wantsType && kind !== SURPRISE ? kind : undefined,
      rarity: wantsRarity && rarity !== "random" ? rarity : undefined,
      frame: wantsType ? (frameValue === SURPRISE ? "random" : frameValue) : undefined,
      deck_id: canDesignForDeck && deckId ? deckId : undefined,
    });
  };

  const labelFor = (field: CardFillField) =>
    field === "stats" ? statsLabel : FILL_FIELD_LABELS[field];

  const kindWord = kind === SURPRISE ? "" : (CARD_TYPE_OPTIONS.find((o) => o.value === kind)?.label ?? kind).toLowerCase();
  const frameHelper =
    pickedFrame && frameValue !== SURPRISE
      ? pinnedColor || frameColorWords(pickedFrame.colorKeys) === "any color"
        ? `The card is designed for ${pickedFrame.label}.`
        : `The card is designed for ${pickedFrame.label}, in ${frameColorWords(pickedFrame.colorKeys)}: the colors it is published in.`
      : `Surprise me: any frame published for a ${kindWord}${pinnedColor ? " in this color" : ""}.`;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-8">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          Generate with AI
          <CreditMeter className="ml-auto" />
        </DialogTitle>
        <DialogDescription>
          Pick a theme and a style, add your own twist, or both — your words
          lead. Nothing is saved until you click Save.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <FieldGroup
          kind="group"
          label="Theme"
          helper="The world the card belongs to. Surprise me leaves it to the AI."
        >
          <ChipGroup
            ariaLabel="Theme presets"
            options={THEME_OPTIONS}
            value={themePreset}
            onChange={setThemePreset}
          />
          <TwistInput
            label="Your twist on the theme"
            value={themeTwist}
            onChange={setThemeTwist}
            placeholder="e.g. the lighthouse keepers are the monsters"
            disabled={generating}
          />
        </FieldGroup>

        <FieldGroup
          kind="group"
          label="Art style"
          helper="How the artwork looks — and the tone of the names and flavor."
        >
          <ChipGroup
            ariaLabel="Art style presets"
            options={STYLE_OPTIONS}
            value={stylePreset}
            onChange={setStylePreset}
          />
          <TwistInput
            label="Your twist on the style"
            value={styleTwist}
            onChange={setStyleTwist}
            placeholder="e.g. moody candlelight, muted greens"
            disabled={generating}
          />
        </FieldGroup>

        {wantsType ? (
          <FieldGroup
            kind="control"
            label="Card kind"
            helper="Surprise me picks the kind and a frame for it."
          >
            {(aria) => (
              <ChipGroup
                ariaLabel="Card kind"
                ariaDescribedBy={aria["aria-describedby"]}
                options={kindOptions}
                value={kind}
                onChange={handleKindChange}
              />
            )}
          </FieldGroup>
        ) : null}

        {wantsType && kind !== SURPRISE ? (
          <FieldGroup kind="group" label="Frame" helper={frameHelper}>
            <div className="flex flex-wrap items-center gap-3">
              {pickedFrame && frameValue !== SURPRISE ? (
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <FrameThumb
                    template={pickedFrame.template}
                    colorKey={pinnedColor && pickedFrame.colorKeys.includes(pinnedColor) ? pinnedColor : pickedFrame.colorKeys[0]}
                  />
                  <span className="flex flex-col">
                    <span>{pickedFrame.label}</span>
                    <span className="text-[11px] text-subtle">{pickedFrame.eraLabel}</span>
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Dices className="h-4 w-4 text-subtle" aria-hidden />
                  Surprise me
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={framesOpen}
                aria-controls={framesRegionId}
                onClick={() => setFramesOpen((was) => !was)}
                disabled={generating}
                className="sm:ml-auto"
              >
                {framesOpen ? "Hide frames" : `Choose a frame (${pickableFrames})`}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", framesOpen && "rotate-180")}
                  aria-hidden
                />
              </Button>
            </div>
            <div id={framesRegionId} hidden={!framesOpen}>
              {framesOpen ? (
                <div className="rounded-lg border border-border/60 bg-elevated/20 p-2 sm:max-h-72 sm:overflow-y-auto">
                  <ChipGroup
                    ariaLabel={`Frames for a ${kindWord}`}
                    options={frameChips}
                    value={frameValue}
                    onChange={setFrame}
                    layout="grid-3"
                    size="md"
                  />
                </div>
              ) : null}
            </div>
          </FieldGroup>
        ) : null}

        {wantsRarity || decks.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {wantsRarity ? (
              <FieldGroup label="Rarity" helper="Steer, or leave it random.">
                <select
                  value={rarity}
                  onChange={(event) =>
                    setRarity(event.target.value as Rarity | "random")
                  }
                  className={inputClass(false)}
                  disabled={generating}
                >
                  <option value="random">Random</option>
                  {RARITY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {RARITY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </FieldGroup>
            ) : null}
            {decks.length > 0 ? (
              <FieldGroup
                label="For a deck"
                helper={
                  canDesignForDeck
                    ? selectedDeck
                      ? `The AI studies ${selectedDeck.title}'s colors, curve and cards and designs what it's missing.`
                      : "Optional. The deck's theme and style come along as your twists."
                    : "Pro: point the AI at one of your decks and it designs the card that deck is missing."
                }
              >
                {canDesignForDeck ? (
                  <select
                    value={deckId}
                    onChange={(event) => handleDeckChange(event.target.value)}
                    className={inputClass(false)}
                    disabled={generating}
                  >
                    <option value="">Not for a deck</option>
                    {decks.map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deck.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select className={inputClass(false)} disabled>
                      <option>Not for a deck</option>
                    </select>
                    <PremiumBadge />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => upgrade.open("deck_aware_generation")}
                    >
                      Unlock with Pro
                    </Button>
                  </div>
                )}
              </FieldGroup>
            ) : null}
          </div>
        ) : null}

        <FieldGroup
          kind="group"
          label="Fields to generate"
          helper="Anything left unticked stays exactly as it is and guides the rest."
        >
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {offered.map((field) => {
                const ticked = want.has(field);
                return (
                  <label
                    key={field}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                      ticked
                        ? "border-accent/60 bg-accent/10 text-foreground"
                        : "border-border bg-elevated/40 text-muted hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => toggle(field)}
                      disabled={generating}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      data-testid={`fill-${field}`}
                    />
                    {labelFor(field)}
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() =>
                setWant(allTicked ? new Set() : new Set(offered))
              }
              disabled={generating}
              className="self-start text-[11px] text-primary-bright underline-offset-2 hover:underline"
            >
              {allTicked ? "Untick all" : "Tick all"}
            </button>
          </div>
        </FieldGroup>
      </div>

      <DialogFooter className="items-center gap-3 sm:justify-between">
        {isBillingEnabled() ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-strong">
            <Coins className="h-3.5 w-3.5" aria-hidden />
            Uses 1 credit
          </span>
        ) : null}
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generating || want.size === 0}
          className="w-full sm:ml-auto sm:w-auto"
          title={want.size === 0 ? "Tick at least one field." : undefined}
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A twist field: the maker's own words, capped at TWIST_MAX. Its counter
 *  is its description (read on focus, never announced as it changes). */
function TwistInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const id = useId();
  const countId = `${id}-count`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label} <span className="text-subtle">(optional)</span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, TWIST_MAX))}
        maxLength={TWIST_MAX}
        placeholder={placeholder}
        aria-describedby={countId}
        className={inputClass(false)}
        disabled={disabled}
      />
      <span id={countId} className={cn("self-end text-[11px] tabular-nums text-subtle", value.length === 0 && "sr-only")}>
        {value.length} of {TWIST_MAX} characters
      </span>
    </div>
  );
}
