"use client";

import { useMemo, useState } from "react";
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
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { frameChoicesForType } from "@/lib/creator/frame-random";
import {
  CARD_TYPE_LABELS,
  FRAME_ERA_LABELS,
  FRAME_TEMPLATE_LABELS,
  RARITY_VALUES,
  type CardType,
  type FrameTemplate,
  type Rarity,
} from "@/types/card";
import { eraForTemplate } from "@/lib/creator/frame-picker";

// ---------------------------------------------------------------------------
// AiGenerateDialog — options for the "Generate with AI" flow. Everything is
// optional: hitting Generate with nothing set is the classic one-click
// surprise. Theme steers the story, style steers the art + tone, and the
// type/frame/rarity selects pin down what gets designed.
//
// The frame select only unlocks once a specific card type is chosen (the
// valid frame list depends on the type) and only offers frames with at
// least one published color — same verification gate as the frame picker.
// ---------------------------------------------------------------------------

export type AiGenerateOptions = {
  theme?: string;
  style?: string;
  card_type?: CardType;
  frame?: FrameTemplate | "random";
  rarity?: Rarity;
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

const STYLE_PRESETS = [
  "Anime",
  "Pixel art",
  "Oil painting",
  "Watercolor",
  "Comic book",
  "Dark fantasy",
];

const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

export function AiGenerateDialog({
  open,
  onOpenChange,
  verifiedFrameKeys,
  generating,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verifiedFrameKeys: string[];
  generating: boolean;
  onGenerate: (options: AiGenerateOptions) => void;
}) {
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [cardType, setCardType] = useState<CardType | "random">("random");
  const [frame, setFrame] = useState<FrameTemplate | "random">("random");
  const [rarity, setRarity] = useState<Rarity | "random">("random");

  const frameOptions = useMemo(() => {
    if (cardType === "random") return [];
    const verified = new Set(verifiedFrameKeys);
    return frameChoicesForType(cardType, verified).filter(
      (choice) => choice.availableColorKeys.length > 0,
    );
  }, [cardType, verifiedFrameKeys]);

  const handleTypeChange = (next: CardType | "random") => {
    setCardType(next);
    // The frame list changes with the type; a stale pick would be invalid.
    setFrame("random");
  };

  const handleGenerate = () => {
    onGenerate({
      theme: theme.trim() || undefined,
      style: style.trim() || undefined,
      card_type: cardType === "random" ? undefined : cardType,
      // "random" is meaningful to the server (pick any published frame);
      // omit it entirely only when the user never touched frames AND never
      // picked a type — that keeps the classic era-default behavior.
      frame: cardType === "random" && frame === "random" ? "random" : frame,
      rarity: rarity === "random" ? undefined : rarity,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !generating && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            Generate a card with AI
          </DialogTitle>
          <DialogDescription>
            Steer as much or as little as you like — everything left on
            Random is the AI&apos;s creative call. Art is painted to match.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FieldGroup
            label="Theme"
            helper="What the card is about — a place, a character, a moment."
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {STYLE_PRESETS.map((preset) => {
                  const active = style.toLowerCase() === preset.toLowerCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      disabled={generating}
                      onClick={() => setStyle(active ? "" : preset)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? "border-accent/70 bg-accent/15 text-foreground"
                          : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground"
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={style}
                onChange={(event) => setStyle(event.target.value)}
                maxLength={200}
                placeholder="e.g. gritty charcoal sketch"
                className={inputClass(false)}
                disabled={generating}
              />
            </div>
          </FieldGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Card type">
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

            <FieldGroup label="Rarity">
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
          </div>

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
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-[11px] text-muted">
            Uses 1 AI credit · 10 generations per day
          </span>
          <Button type="button" onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Forging…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Generate card
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
