"use client";

import { useMemo, useState } from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { frameChoicesForType } from "@/lib/creator/frame-random";
import {
  isBorrowedVariation,
  kindFromCard,
  templateIsBasicOnly,
} from "@/lib/creator/card-kinds";
import {
  CARD_FILL_FIELDS,
  CREATE_ONLY_FILL_FIELDS,
  FILL_FIELD_LABELS,
  type CardFillField,
} from "@/lib/ai/card-fill-shared";
import {
  CARD_TYPE_LABELS,
  FRAME_ERA_LABELS,
  FRAME_TEMPLATE_LABELS,
  RARITY_VALUES,
  type CardType,
  type FrameTemplate,
  type Rarity,
  RARITY_LABELS,
} from "@/types/card";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { cn } from "@/lib/utils";
import { StylePicker } from "@/components/ai/style-picker";

// ---------------------------------------------------------------------------
// AiFillDialog — "Generate with AI", per field. The user ticks which fields
// the AI should write; everything unticked stays exactly as it is in the
// form and is fed to the designer as fixed context (owner decision
// 2026-09-16). One credit per run whatever is ticked. Opened from the
// Start-with hero (everything ticked), the Identity step's "Generate AI
// artwork and title", and the Text & stats step's button; also on edit and
// remix, where the structural fields aren't offered.
// ---------------------------------------------------------------------------

export type AiFillOptions = {
  want: CardFillField[];
  theme?: string;
  style?: string;
  /** Steering for ticked fields. */
  card_type?: CardType;
  rarity?: Rarity;
  frame?: FrameTemplate | "random";
  /** Pro: design for this deck (create only). */
  deck_id?: string;
};

const AI_CARD_TYPES: CardType[] = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
];



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
  generating: boolean;
  onGenerate: (options: AiFillOptions) => void;
  myDecks?: DeckOption[] | null;
  canDesignForDeck?: boolean;
};

export function AiFillDialog({
  open,
  onOpenChange,
  generating,
  ...body
}: AiFillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !generating && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        {/* DialogContent unmounts its children when closed, so the body's
            state (the tick-set) starts fresh from the preset each open. */}
        <AiFillDialogBody generating={generating} {...body} />
      </DialogContent>
    </Dialog>
  );
}

function AiFillDialogBody({
  initialFields,
  revise,
  statsLabel,
  statsAvailable,
  verifiedFrameKeys,
  generating,
  onGenerate,
  myDecks = null,
  canDesignForDeck = false,
}: Omit<AiFillDialogProps, "open" | "onOpenChange">) {
  const upgrade = useUpgradeModal();
  const [want, setWant] = useState<Set<CardFillField>>(
    () => new Set(initialFields),
  );
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [cardType, setCardType] = useState<CardType | "random">("random");
  const [frame, setFrame] = useState<FrameTemplate | "random">("random");
  const [rarity, setRarity] = useState<Rarity | "random">("random");
  const [deckId, setDeckId] = useState<string>("");
  const decks = revise ? [] : (myDecks ?? []);
  const selectedDeck = decks.find((d) => d.id === deckId) ?? null;

  const offered = CARD_FILL_FIELDS.filter(
    (field) =>
      (!revise || !CREATE_ONLY_FILL_FIELDS.includes(field)) &&
      // Stats only when the type prints them — unless the type itself is
      // being generated (create), in which case the AI decides.
      (field !== "stats" || statsAvailable || (!revise && want.has("card_type"))),
  );
  const toggle = (field: CardFillField) =>
    setWant((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  const allTicked = offered.every((f) => want.has(f));

  const handleDeckChange = (nextId: string) => {
    setDeckId(nextId);
    const deck = decks.find((d) => d.id === nextId);
    if (deck?.theme) setTheme(deck.theme);
    if (deck?.style) setStyle(deck.style);
  };

  const frameOptions = useMemo(() => {
    if (cardType === "random") return [];
    const verified = new Set(verifiedFrameKeys);
    // Basic-only frames (the full-art basic land) are left out: the designer
    // rarely writes exactly one basic land, and the job would quietly swap
    // the request for a random frame (resolveGeneratedFrame, TODO 0.26). So
    // is the artifact frame a creature borrows (TODO 1.7): the job honours
    // it only for an Artifact Creature, which this dialog can't ask for.
    const kind = kindFromCard(cardType, undefined);
    return frameChoicesForType(cardType, verified).filter(
      (choice) =>
        choice.availableColorKeys.length > 0 &&
        !templateIsBasicOnly(choice.template) &&
        !isBorrowedVariation(kind, choice.template),
    );
  }, [cardType, verifiedFrameKeys]);

  const handleTypeChange = (next: CardType | "random") => {
    setCardType(next);
    setFrame("random");
  };

  const wantsType = !revise && want.has("card_type");
  const wantsRarity = want.has("rarity");

  const handleGenerate = () => {
    onGenerate({
      want: offered.filter((f) => want.has(f)),
      theme: theme.trim() || undefined,
      style: style.trim() || undefined,
      card_type: wantsType && cardType !== "random" ? cardType : undefined,
      rarity: wantsRarity && rarity !== "random" ? rarity : undefined,
      frame: wantsType ? frame : undefined,
      deck_id: canDesignForDeck && deckId ? deckId : undefined,
    });
  };

  const labelFor = (field: CardFillField) =>
    field === "stats" ? statsLabel : FILL_FIELD_LABELS[field];

  return (
    <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            Generate with AI
            <CreditMeter className="ml-auto" />
          </DialogTitle>
          <DialogDescription>
            Tick what the AI should write. Anything left unticked stays
            exactly as it is and guides the rest. The result lands in this
            form — nothing is saved until you click Save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          <FieldGroup label="Fields to generate">
            <div className="flex flex-col gap-2">
              <div
                role="group"
                aria-label="Fields to generate"
                className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
              >
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

          {decks.length > 0 ? (
            <FieldGroup
              label="For a deck"
              helper={
                canDesignForDeck
                  ? selectedDeck
                    ? `The AI studies ${selectedDeck.title}'s colors, curve and cards and designs what it's missing.`
                    : "Optional. Pick a deck and the AI designs a card that fits it — theme and style come along."
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

          <FieldGroup
            label="Theme"
            helper="What the card is about — a place, a character, a moment. Optional."
          >
            <input
              type="text"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              maxLength={300}
              placeholder="e.g. haunted lighthouse keepers"
              className={inputClass(false)}
              disabled={generating}
            />
          </FieldGroup>

          <FieldGroup
            label="Art style"
            helper="How the art and tone should feel. Pick a preset or write your own."
          >
            <StylePicker
              value={style}
              onChange={setStyle}
              disabled={generating}
              placeholder="e.g. gritty charcoal sketch"
            />
          </FieldGroup>

          {wantsType || wantsRarity ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {wantsType ? (
                <FieldGroup label="Card type" helper="Steer, or leave it random.">
                  <select
                    value={cardType}
                    onChange={(event) =>
                      handleTypeChange(event.target.value as CardType | "random")
                    }
                    className={inputClass(false)}
                    disabled={generating}
                  >
                    <option value="random">Random</option>
                    {AI_CARD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {CARD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
              ) : null}
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
            </div>
          ) : null}

          {wantsType ? (
            <FieldGroup
              label="Frame"
              helper={
                cardType === "random"
                  ? "Pick a card type to choose a specific frame."
                  : "Only published frames for this type are offered."
              }
            >
              <select
                value={frame}
                onChange={(event) =>
                  setFrame(event.target.value as FrameTemplate | "random")
                }
                className={inputClass(false)}
                disabled={generating || cardType === "random"}
              >
                <option value="random">Random</option>
                {frameOptions.map((choice) => (
                  <option key={choice.template} value={choice.template}>
                    {FRAME_ERA_LABELS[eraForTemplate(choice.template)]} —{" "}
                    {FRAME_TEMPLATE_LABELS[choice.template]}
                  </option>
                ))}
              </select>
            </FieldGroup>
          ) : null}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {isBillingEnabled() ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-strong">
              <Coins className="h-3.5 w-3.5" aria-hidden />
              Uses 1 credit
            </span>
          ) : (
            <span aria-hidden />
          )}
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={generating || want.size === 0}
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
