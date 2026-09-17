"use client";

import { useState } from "react";
import { Coins, Lightbulb, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlinePips } from "@/components/cards/inline-pips";
import { CreditMeter } from "@/components/billing/credit-meter";
import { PremiumBadge } from "@/components/billing/premium-badge";
import { publishCredits } from "@/components/billing/credits-bus";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useCreditConfirm } from "@/components/billing/credit-confirm-provider";
import { isBillingEnabled } from "@/lib/billing/flags";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import type { DeckOption } from "@/components/creator/panels/publish-panel";
import {
  IDEA_FIELD_GROUPS,
  IDEA_FIELD_LABELS,
  composeIdeaPatch,
  type CardFieldPatch,
  ideaFieldSummary,
  ideaHasField,
  wholeIdeaSelection,
  type CardIdea,
  type IdeaFieldGroup,
  type IdeaSelection,
} from "@/lib/ai/card-ideas-select";
import { CARD_TYPE_LABELS, RARITY_VALUES, type CardType, type Rarity } from "@/types/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardIdeasDialog — "Get ideas": one credit buys a few complete, clearly
// different card concepts (title, type line, cost & colors, rarity, rules,
// flavor, stats — never art). The user picks, per field group, which idea's
// value to keep (or takes a whole idea), and the selection seeds the form
// through the same patch the AI assistant applies. Picking a deck (Pro)
// themes every idea to that deck.
// ---------------------------------------------------------------------------

const AI_CARD_TYPES: CardType[] = [
  "creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "battle", "token",
];

const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
};

type IdeasResponse =
  | { ok: true; ideas: CardIdea[]; credits: number | null }
  | { ok: false; error: string; code?: string; credits?: number | null };

export function CardIdeasDialog({
  open,
  onOpenChange,
  onApply,
  myDecks = null,
  canUseDeckIdeas = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applies the composed selection to the form (the assistant's patch). */
  onApply: (patch: CardFieldPatch) => void;
  myDecks?: DeckOption[] | null;
  /** Pro entitlement for deck-themed ideas. */
  canUseDeckIdeas?: boolean;
}) {
  const upgrade = useUpgradeModal();
  const confirmSpend = useCreditConfirm();
  const [theme, setTheme] = useState("");
  const [cardType, setCardType] = useState<CardType | "random">("random");
  const [rarity, setRarity] = useState<Rarity | "random">("random");
  const [deckId, setDeckId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<CardIdea[] | null>(null);
  const [selection, setSelection] = useState<IdeaSelection>(wholeIdeaSelection(0));
  const decks = myDecks ?? [];
  const selectedDeck = decks.find((d) => d.id === deckId) ?? null;

  const generate = async () => {
    if (
      !(await confirmSpend({
        cost: 1,
        title: ideas ? "Get another batch of ideas?" : "Get card ideas?",
        description: "Three text-only concepts you can pick from — no art is painted.",
        confirmLabel: "Get ideas",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/ai/card-ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          theme: theme.trim() || undefined,
          card_type: cardType === "random" ? undefined : cardType,
          rarity: rarity === "random" ? undefined : rarity,
          deck_id: canUseDeckIdeas && deckId ? deckId : undefined,
        }),
      });
      const data = (await response.json()) as IdeasResponse;
      if (typeof data.credits === "number") publishCredits(data.credits);
      if (!data.ok) {
        if (data.code === "INSUFFICIENT_CREDITS") upgrade.open("credits");
        else if (data.code === "UPGRADE_REQUIRED") upgrade.open("deck_aware_generation");
        toast.error(data.error);
        return;
      }
      setIdeas(data.ideas);
      setSelection(wholeIdeaSelection(0));
    } catch {
      toast.error("Couldn't reach the idea generator — try again.");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!ideas) return;
    onApply(composeIdeaPatch(ideas, selection));
    toast.success("Card seeded from your picks — every field stays editable.");
    onOpenChange(false);
    setIdeas(null);
  };

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setIdeas(null);
  };

  const pickWhole = (index: number) => setSelection(wholeIdeaSelection(index));
  const pickField = (group: IdeaFieldGroup, index: number) =>
    setSelection((s) => ({ ...s, [group]: index }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-gold" aria-hidden />
            {ideas ? "Pick what you like" : "Get card ideas"}
            <CreditMeter className="ml-auto" />
          </DialogTitle>
          <DialogDescription>
            {ideas
              ? "Three ideas. Take one whole, or mix — choose a title from one, rules from another. Nothing is saved until you click Use my picks; every field stays editable afterwards."
              : "One credit buys three complete card concepts — name, type, cost, rarity, rules, flavor and stats (no art). You choose what to keep."}
          </DialogDescription>
        </DialogHeader>

        {!ideas ? (
          <div className="flex flex-col gap-4 px-5 py-5">
            {decks.length > 0 ? (
              <FieldGroup
                label="Theme the ideas to a deck"
                helper={
                  canUseDeckIdeas
                    ? selectedDeck
                      ? `Every idea fits ${selectedDeck.title}'s colors, curve and cards.`
                      : "Optional. Pick a deck and every idea is designed to fit it."
                    : "Pro: theme the ideas to one of your decks — colors, curve and synergies included."
                }
              >
                {canUseDeckIdeas ? (
                  <select
                    value={deckId}
                    onChange={(event) => setDeckId(event.target.value)}
                    className={inputClass(false)}
                    disabled={busy}
                  >
                    <option value="">No deck</option>
                    {decks.map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deck.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select className={inputClass(false)} disabled>
                      <option>No deck</option>
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
              helper="Optional — a place, a character, a mood. Leave blank for a surprise."
            >
              <input
                type="text"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                maxLength={300}
                placeholder="e.g. a lighthouse that remembers every ship it lost"
                className={inputClass(false)}
                disabled={busy}
              />
            </FieldGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldGroup label="Card type" helper="Random lets the ideas differ in type.">
                <select
                  value={cardType}
                  onChange={(event) => setCardType(event.target.value as CardType | "random")}
                  className={inputClass(false)}
                  disabled={busy}
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
                  onChange={(event) => setRarity(event.target.value as Rarity | "random")}
                  className={inputClass(false)}
                  disabled={busy}
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
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {ideas.map((idea, index) => {
                const whole = IDEA_FIELD_GROUPS.every((g) => selection[g] === index);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => pickWhole(index)}
                    aria-pressed={whole}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      whole
                        ? "border-gold/70 bg-gold/15 text-foreground"
                        : "border-border bg-elevated/50 text-muted hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    Use idea {index + 1}: {idea.title}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-3">
              {IDEA_FIELD_GROUPS.map((group) => (
                <div key={group} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {IDEA_FIELD_LABELS[group]}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={IDEA_FIELD_LABELS[group]}>
                    {ideas.map((idea, index) => {
                      const active = selection[group] === index;
                      const has = ideaHasField(idea, group);
                      return (
                        <button
                          key={index}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => pickField(group, index)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left text-xs leading-5 transition-colors",
                            active
                              ? "border-primary-bright/60 bg-primary/10 text-foreground"
                              : "border-border/60 text-muted hover:border-border-strong hover:text-foreground",
                            has ? "" : "italic opacity-70",
                          )}
                        >
                          <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-subtle">
                            Idea {index + 1}
                          </span>
                          {group === "rulesText" || group === "costColors" ? (
                            <InlinePips
                              text={ideaFieldSummary(idea, group)}
                              className="whitespace-pre-line"
                            />
                          ) : (
                            ideaFieldSummary(idea, group)
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          {isBillingEnabled() ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-strong">
              <Coins className="h-3.5 w-3.5" aria-hidden />
              {ideas ? "Another batch costs 1 credit" : "Uses 1 credit"}
            </span>
          ) : (
            <span aria-hidden />
          )}
          <div className="flex items-center gap-2">
            {ideas ? (
              <>
                <Button type="button" variant="outline" onClick={() => setIdeas(null)} disabled={busy}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  New ideas
                </Button>
                <Button type="button" onClick={apply} disabled={busy}>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Use my picks
                </Button>
              </>
            ) : (
              <Button type="button" onClick={generate} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Thinking…
                  </>
                ) : (
                  <>
                    <Lightbulb className="h-4 w-4" aria-hidden />
                    Generate ideas
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
