"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronUp, Crown, Hammer, History, Minus, Plus, Sparkles, Undo2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass } from "@/components/ui/field-classes";
import { ChipGroup } from "@/components/ui/chip-group";
import { ColorPips } from "@/components/cards/color-pip";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { cn } from "@/lib/utils";
import type { Visibility } from "@/types/card";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import type { CollectionColour } from "@/lib/tools/collection/queries";
import { draftCollectionDeckAction, saveCollectionDeckAction } from "@/lib/tools/collection/actions";
import {
  ROLE_LABELS,
  ROLE_ORDER,
  ROLE_TARGETS,
  type CommanderDraft,
  type DeckRole,
  type DraftBasic,
} from "@/lib/tools/collection/builder";
import { describeSupport, type CommanderSupport } from "@/lib/tools/collection/commander-scores";
import {
  COLLECTION_DECK_TYPES,
  DECK_TYPE_GROUP_LABELS,
  TYPAL_FLOOR,
  collectionDeckType,
  commanderDeckTypes,
  deckTypeFitsBracket,
  refusalFloor,
  tribeLabel,
  type BuildChoice,
  type CollectionDeckType,
  type CollectionDeckTypeId,
  type DeckTypeGroup,
} from "@/lib/tools/collection/archetypes";
import { COMMANDER_BRACKETS, commanderBracket } from "@/lib/decks/deck-types";
import {
  LAST_AI_DRAFT_DAYS,
  clearLastAiDraft,
  readLastAiDraft,
  writeLastAiDraft,
  type StoredAiDraft,
} from "@/lib/tools/collection/last-ai-draft";
import { COMMANDER_DECK_SIZE } from "@/lib/tools/collection/limits";
import { collectionViewHref } from "@/lib/tools/collection/views";
import { PrintingPicture } from "./printing-tile";
import { CommanderSuggestions } from "./commander-suggestions";
import {
  clearLastSuggestions,
  readLastSuggestions,
  writeLastSuggestions,
  type CommanderSuggestion,
  type StoredSuggestions,
  type SuggestResult,
} from "@/lib/tools/collection/suggestions";
import { COLOUR_OPTIONS, identityMatchesColours } from "./colour-options";

const n = (value: number) => value.toLocaleString("en-US");
type Pip = "W" | "U" | "B" | "R" | "G" | "C";
const pipsOf = (identity: readonly string[]): Pip[] =>
  identity.length === 0 ? ["C"] : (identity.filter((c) => "WUBRG".includes(c)) as Pip[]);

type DraftSource = "rules" | "ai";

/** The commander list's order. "best" reads the free scores
 *  (lib/tools/collection/commander-scores.ts); until they arrive, or when
 *  they can't be read, the list keeps its name order. */
export type CommanderSort = "best" | "colours" | "name";

/** "Best supported by your cards", or — with a deck type picked — best for
 *  that type. */
const sortLabel = (key: CommanderSort, type: CollectionDeckType | null) =>
  key === "best" && type ? `Best for ${type.label}` : SORT_LABELS[key];

const SORT_LABELS: Record<CommanderSort, string> = {
  best: "Best supported by your cards",
  colours: "Most cards in its colours",
  name: "Name",
};

/** Commanders the folded list shows: two rows at every width of its grid
 *  (3 · 4 · 6 · 8 columns). */
export const FOLDED_ROWS_MAX = 16;

/**
 * A folded tile's display, by its place in the list: the first two rows of
 * whichever column count the grid's container gives. Literal class strings
 * (Tailwind reads them from here): base 3 columns → 6, @xl 4 → 8, @3xl 6 →
 * 12, @5xl 8 → 16. Hidden tiles are `display: none` — out of the tab order
 * and the accessibility tree, as the "Show all" button says.
 */
export function foldedTileClass(index: number): string | undefined {
  if (index < 6) return undefined;
  if (index < 8) return "hidden @xl:flex";
  if (index < 12) return "hidden @3xl:flex";
  if (index < FOLDED_ROWS_MAX) return "hidden @5xl:flex";
  return "hidden";
}

/** "Show all" hides itself at the widths where every commander already
 *  shows. */
function showAllClass(count: number): string | undefined {
  if (count <= 8) return "@xl:hidden";
  if (count <= 12) return "@3xl:hidden";
  if (count <= FOLDED_ROWS_MAX) return "@5xl:hidden";
  return undefined;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
];

const VISIBILITY_HINT: Record<Visibility, string> = {
  public: "Listed with the community's decks.",
  unlisted: "Anyone with the link can view it.",
  private: "Only you can see it.",
};

type ScoresState = { status: "loading" } | { status: "ready"; scores: Record<string, CommanderSupport> } | { status: "failed" };

export function CollectionBuild({
  commanders,
  initialCommanderId,
  credits,
  aiAvailable,
  collectionSize,
  viewerId,
}: {
  commanders: CollectionCard[];
  initialCommanderId: string | null;
  credits: number | null;
  aiAvailable: boolean;
  collectionSize: number;
  /** The signed-in user — keys the AI draft this browser keeps. */
  viewerId: string;
}) {
  const legal = useMemo(() => commanders.filter((c) => c.commanderLegal), [commanders]);
  const [commanderId, setCommanderId] = useState<string | null>(
    legal.find((c) => c.id === initialCommanderId)?.id ?? null,
  );
  const [filter, setFilter] = useState("");
  const [colours, setColours] = useState<CollectionColour[]>([]);
  const [sort, setSort] = useState<CommanderSort>("best");
  // What the deck is built around (all optional): sent with a draft or an
  // AI build, saved on the deck (decks.deck_type / bracket).
  const [deckType, setDeckType] = useState<CollectionDeckTypeId | "">("");
  const [tribe, setTribe] = useState("");
  const [bracket, setBracket] = useState<number | "">("");
  const [choiceNote, setChoiceNote] = useState<string | null>(null);
  /** The choice the draft on screen was made with (the pickers may move on). */
  const [draftChoice, setDraftChoice] = useState<BuildChoice>({});
  const [expanded, setExpanded] = useState(false);
  /** With a draft on screen the list folds away behind "Change commander". */
  const [listOpen, setListOpen] = useState(true);
  const [draft, setDraft] = useState<CommanderDraft | null>(null);
  const [source, setSource] = useState<DraftSource>("rules");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(credits);
  const [working, setWorking] = useState<DraftSource | null>(null);
  const [scores, setScores] = useState<ScoresState>({ status: "loading" });
  const [kept, setKept] = useState<StoredAiDraft | null>(null);
  /** "Suggest a commander"'s answer (fresh, or kept in this browser). */
  const [suggestions, setSuggestions] = useState<StoredSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const ids = {
    heading: useId(),
    filter: useId(),
    sort: useId(),
    list: useId(),
    listHeading: useId(),
    grid: useId(),
    reason: useId(),
    deckType: useId(),
    tribe: useId(),
    bracket: useId(),
    choiceHint: useId(),
    suggestions: useId(),
    suggestReason: useId(),
  };
  useLeaveWarning(working === "ai" || suggesting);
  const hasCommanders = collectionSize > 0 && commanders.length > 0;

  // The free scores: one read of the collection, after the page is up.
  useEffect(() => {
    if (!hasCommanders) return;
    const abort = new AbortController();
    fetch("/api/tools/collection-builder/commander-scores", { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { ok: boolean; scores?: Record<string, CommanderSupport> };
        setScores(body.ok && body.scores ? { status: "ready", scores: body.scores } : { status: "failed" });
      })
      .catch(() => {
        if (!abort.signal.aborted) setScores({ status: "failed" });
      });
    return () => abort.abort();
  }, [hasCommanders]);

  // The paid AI draft this browser kept (7 days), offered back — never
  // shown by itself. Read after the first paint (storage isn't there on
  // the server, so reading it while rendering would mismatch the HTML).
  useEffect(() => {
    if (!hasCommanders) return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const context = { collectionSize, commanderIds: new Set(legal.map((c) => c.id)) };
      setKept(readLastAiDraft(viewerId, context));
      setSuggestions(readLastSuggestions(viewerId, context));
    });
    return () => {
      live = false;
    };
  }, [hasCommanders, viewerId, collectionSize, legal]);

  // "Change commander" unfolds the list in its place: the focus goes to the
  // list's heading, not <body>, when the button it was on goes away.
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const suggestionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const draftButtonRef = useRef<HTMLButtonElement>(null);
  /** Where the focus goes once the next render is on screen. */
  const focusNext = useRef<"suggestions" | "draft" | null>(null);
  useEffect(() => {
    if (focusNext.current === "suggestions") suggestionsHeadingRef.current?.focus();
    if (focusNext.current === "draft") draftButtonRef.current?.focus();
    focusNext.current = null;
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusListOnOpen = useRef(false);
  useEffect(() => {
    if (listOpen && focusListOnOpen.current) {
      focusListOnOpen.current = false;
      listHeadingRef.current?.focus();
    }
  }, [listOpen]);

  const sorted = useMemo(() => {
    const ready = scores.status === "ready" ? scores.scores : null;
    const support = (c: CollectionCard) => (ready ? ready[c.id] : undefined);
    const byName = (a: CollectionCard, b: CollectionCard) => a.name.localeCompare(b.name);
    const legalFirst = (a: CollectionCard, b: CollectionCard) => Number(b.commanderLegal) - Number(a.commanderLegal);
    return [...commanders].sort((a, b) => {
      const first = legalFirst(a, b);
      if (first !== 0) return first;
      if (ready && sort !== "name") {
        const sa = support(a);
        const sb = support(b);
        // With a deck type picked, "best" is best FOR it (theme first):
        // the most cards of the type in its colours, then the score.
        const onType = (x: CommanderSupport | undefined) => (deckType && x ? (x.deckTypes[deckType] ?? 0) : 0);
        const diff =
          sort === "best"
            ? onType(sb) - onType(sa) || (sb?.score ?? -1) - (sa?.score ?? -1) || (sb?.inColours ?? -1) - (sa?.inColours ?? -1)
            : (sb?.inColours ?? -1) - (sa?.inColours ?? -1);
        if (diff !== 0) return diff;
      }
      return byName(a, b);
    });
  }, [commanders, scores, sort, deckType]);

  if (!hasCommanders) {
    return (
      <EmptyState
        icon={Crown}
        headingLevel={2}
        title={collectionSize === 0 ? "Add your cards first" : "No commander in your collection yet"}
        description={
          collectionSize === 0
            ? "The builder drafts a Commander deck from cards you own. Import your collection to start."
            : "A Commander deck is led by a legendary creature (or a card that says it can be your commander). Add one you own and come back."
        }
        action={
          <Link href={collectionViewHref("add")} className={buttonVariants({ variant: "primary" })}>
            Add cards
          </Link>
        }
      />
    );
  }

  const commander = commanders.find((c) => c.id === commanderId) ?? null;
  const ready = scores.status === "ready" ? scores.scores : null;
  const query = filter.trim().toLowerCase();
  const filtering = query !== "" || colours.length > 0;
  const matching = sorted.filter(
    (c) => (!query || c.name.toLowerCase().includes(query)) && identityMatchesColours(c.colorIdentity, colours),
  );
  const folded = !expanded && !filtering;
  // The picked commander is never folded away (picked through the address,
  // a kept draft, or re-sorted by the scores): it stays where the list puts
  // it, shown at every width — a hidden checked radio would take the whole
  // group out of the Tab order, and nobody would see which one is picked.
  const shown = matching;

  const pick = (card: CollectionCard) => {
    // Not mid-draft: the draft that lands must match the bar's commander.
    if (!card.commanderLegal || working) return;
    setCommanderId(card.id);
    setDraft(null);
    setError(null);
    if (tribe && !(ready?.[card.id]?.tribes ?? []).some((t) => t.tribe === tribe)) setTribe("");
  };

  const choice: BuildChoice = {
    deckType: deckType || null,
    tribe: tribe || null,
    bracket: bracket === "" ? null : bracket,
  };

  const pickBracket = (value: number | "") => {
    setBracket(value);
    const type = collectionDeckType(deckType);
    if (type && value !== "" && !deckTypeFitsBracket(type, value)) {
      setDeckType("");
      setChoiceNote(`${type.label} is a deck type for Bracket ${type.minBracket} and up, so the deck type is back to Any.`);
    } else {
      setChoiceNote(null);
    }
  };

  const showDraft = (next: CommanderDraft, from: DraftSource, wasTruncated: boolean) => {
    setDraft(next);
    setSource(from);
    setTruncated(wasTruncated);
    setListOpen(false);
  };

  const draftWithRules = async () => {
    if (!commanderId || working) return;
    setWorking("rules");
    setError(null);
    try {
      const result = await draftCollectionDeckAction({ commanderId, ...choice });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraftChoice(choice);
      showDraft(result.draft, "rules", result.truncated);
    } catch {
      setError("The draft didn't finish. Try again.");
    } finally {
      setWorking(null);
    }
  };

  const draftWithAi = async () => {
    if (!commanderId || working) return;
    setWorking("ai");
    setError(null);
    try {
      const response = await fetch("/api/tools/collection-builder/ai-build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commanderId, ...choice }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        draft?: CommanderDraft;
        truncated?: boolean;
        error?: string;
        credits?: number | null;
      };
      if (typeof body.credits === "number") setBalance(body.credits);
      if (!body.ok || !body.draft) {
        setError(body.error ?? "The AI build didn't finish. Try again.");
        return;
      }
      const wasTruncated = Boolean(body.truncated);
      setDraftChoice(choice);
      showDraft(body.draft, "ai", wasTruncated);
      // Paid for: kept in this browser for a week, so a reload can't lose it.
      writeLastAiDraft(viewerId, {
        savedAt: new Date().toISOString(),
        commanderId,
        collectionSize,
        truncated: wasTruncated,
        draft: body.draft,
        choice,
      });
      setKept(null);
    } catch {
      setError("The AI build didn't answer. If a credit was taken it comes back by itself.");
    } finally {
      setWorking(null);
    }
  };

  const suggest = async () => {
    if (suggesting || working) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const response = await fetch("/api/tools/collection-builder/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deckType: choice.deckType, bracket: choice.bracket, colours }),
      });
      const body = (await response.json()) as { ok: boolean; result?: SuggestResult; error?: string; credits?: number | null };
      if (typeof body.credits === "number") setBalance(body.credits);
      if (!body.ok || !body.result) {
        setSuggestError(body.error ?? "The suggestions didn't finish. Try again.");
        return;
      }
      const stored: StoredSuggestions = { savedAt: new Date().toISOString(), collectionSize, result: body.result };
      // Paid for: kept in this browser for a week.
      writeLastSuggestions(viewerId, stored);
      setSuggestions(stored);
      focusNext.current = "suggestions";
    } catch {
      setSuggestError("The suggestions didn't answer. If a credit was taken it comes back by itself.");
    } finally {
      setSuggesting(false);
    }
  };

  const buildFromSuggestion = (suggestion: CommanderSuggestion) => {
    const target = commanders.find((c) => c.id === suggestion.commanderId);
    if (!target || working) return;
    pick(target);
    setDeckType(suggestion.deckType ?? "");
    setChoiceNote(null);
    // To the bar: the next press builds it.
    focusNext.current = "draft";
  };

  const dismissSuggestions = () => {
    clearLastSuggestions(viewerId);
    setSuggestions(null);
    listHeadingRef.current?.focus();
  };

  const restoreKept = () => {
    if (!kept) return;
    setCommanderId(kept.commanderId);
    setError(null);
    // A kept choice is cleaned before it's used (a type renamed since, a
    // creature type no longer offered): the save must send what validates.
    const keptChoice = kept.choice ?? {};
    const keptType = collectionDeckType(keptChoice.deckType)?.id ?? null;
    // The draft was built with this creature type: it is saved with it
    // whenever it is well formed; the picker shows it only while the
    // commander's creature types (the scores) offer it.
    const keptTribe =
      typeof keptChoice.tribe === "string" && /^[a-z][a-z'-]{1,29}$/.test(keptChoice.tribe) ? keptChoice.tribe : null;
    const keptBracket =
      typeof keptChoice.bracket === "number" && keptChoice.bracket >= 1 && keptChoice.bracket <= 5 ? keptChoice.bracket : null;
    const offered = (ready?.[kept.commanderId]?.tribes ?? []).some((t) => t.tribe === keptTribe);
    setDeckType(keptType ?? "");
    setTribe(keptTribe && offered ? keptTribe : "");
    setBracket(keptBracket ?? "");
    setDraftChoice({ deckType: keptType, tribe: keptTribe, bracket: keptBracket });
    showDraft(kept.draft, "ai", kept.truncated);
    setKept(null);
  };

  const dismissKept = () => {
    clearLastAiDraft(viewerId);
    setKept(null);
    // The notice (and the button pressed) goes: the focus goes to the
    // section's heading, never <body>.
    headingRef.current?.focus();
  };

  const aiOff = !aiAvailable
    ? "AI isn't available right now."
    : balance !== null && balance < 1
      ? "You're out of AI credits."
      : null;
  // A button that can't act yet stays reachable and says why (aria-disabled,
  // never `disabled`, which would drop it from the keyboard's path).
  const draftBlocked = !commander ? "Pick a commander first." : null;
  const support = commander && ready ? ready[commander.id] : undefined;
  const pickedType = collectionDeckType(deckType);
  const typeCount = pickedType && support ? (support.deckTypes[pickedType.id] ?? 0) : null;
  // The route refuses a type the collection can't begin to fill (below half
  // its floor) before charging; the button says so first.
  const themeTooThin =
    pickedType && typeCount !== null && typeCount < refusalFloor(pickedType.floor)
      ? `Your collection has too few ${pickedType.label} cards in these colours for the AI to build around — try the free draft or another deck type.`
      : null;
  const aiBlocked = draftBlocked ?? aiOff ?? themeTooThin;
  const suggestBlocked =
    legal.length < 3
      ? `With ${n(legal.length)} commander${legal.length === 1 ? "" : "s"} there's nothing to rank — pick one below.`
      : aiOff;
  const tribeOptions = support?.tribes ?? [];
  const fitsTypes = commander ? commanderDeckTypes(commander) : [];
  const bracketLevel = bracket === "" ? null : bracket;
  const typeOptionLabel = (type: CollectionDeckType) => {
    const count = support ? (support.deckTypes[type.id] ?? 0) : null;
    return [
      type.label,
      count !== null ? ` — ${n(count)} card${count === 1 ? "" : "s"}${count < type.floor ? ` (wants ${type.floor})` : ""}` : "",
      deckTypeFitsBracket(type, bracketLevel) ? "" : ` — Bracket ${type.minBracket}+`,
    ].join("");
  };
  const typesByGroup = (Object.keys(DECK_TYPE_GROUP_LABELS) as DeckTypeGroup[]).map((group) => ({
    group,
    types: COLLECTION_DECK_TYPES.filter((t) => t.group === group),
  }));
  const supportFor = (card: CollectionCard) => (ready && card.commanderLegal ? ready[card.id] : undefined);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby={ids.heading} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            id={ids.heading}
            className="font-display text-xl font-semibold text-foreground focus:outline-none"
          >
            Pick your commander
          </h2>
          <p className="text-sm text-muted">
            {n(legal.length)} commander{legal.length === 1 ? "" : "s"} in your collection. The deck is drafted from cards
            you own in its colours.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {commander ? (
              <>
                <div className="w-10 shrink-0">
                  <PrintingPicture imageUrl={commander.imageUrl} name={commander.name} size="small" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <ColorPips
                      colors={pipsOf(commander.colorIdentity)}
                      label={`Colours: ${commander.colorIdentity.join(", ") || "colourless"}`}
                    />
                    <p className="min-w-0 truncate text-sm text-foreground">
                      <span className="text-muted">Commander:</span> {commander.name}
                    </p>
                  </div>
                  {support ? <p className="text-xs leading-5 text-muted">{describeSupport(support)}</p> : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No commander picked yet — pick one from your commanders below.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <Button
              ref={draftButtonRef}
              variant="secondary"
              onClick={draftBlocked ? undefined : draftWithRules}
              aria-disabled={draftBlocked || working ? true : undefined}
              aria-describedby={draftBlocked ? ids.reason : undefined}
              className={cn("flex-1 sm:flex-none", (draftBlocked || working) && "opacity-50")}
            >
              <Hammer aria-hidden />
              {working === "rules" ? "Drafting…" : draft ? "Draft again" : "Draft a deck"}
            </Button>
            <Button
              onClick={aiBlocked ? undefined : draftWithAi}
              aria-disabled={aiBlocked || working ? true : undefined}
              aria-describedby={aiBlocked ? ids.reason : undefined}
              className={cn("flex-1 sm:flex-none", (aiBlocked || working) && "opacity-50")}
            >
              <Sparkles aria-hidden />
              {working === "ai" ? "Building with AI…" : "Build with AI · 1 credit"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={ids.deckType} className="text-xs font-medium text-muted">
              Deck type
            </label>
            <select
              id={ids.deckType}
              value={deckType}
              aria-describedby={ids.choiceHint}
              onChange={(event) => {
                setDeckType(event.target.value as CollectionDeckTypeId | "");
                setChoiceNote(null);
              }}
              className={inputClass(false)}
            >
              <option value="">Any — follow the commander</option>
              {typesByGroup.map(({ group, types }) => (
                <optgroup key={group} label={DECK_TYPE_GROUP_LABELS[group]}>
                  {types.map((type) => (
                    <option key={type.id} value={type.id} disabled={!deckTypeFitsBracket(type, bracketLevel)}>
                      {typeOptionLabel(type)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {tribeOptions.length > 0 ? (
              <>
                <label htmlFor={ids.tribe} className="text-xs font-medium text-muted">
                  Creature type
                </label>
                <select
                  id={ids.tribe}
                  value={tribe}
                  onChange={(event) => setTribe(event.target.value)}
                  className={inputClass(false)}
                >
                  <option value="">None</option>
                  {tribeOptions.map((t) => (
                    <option key={t.tribe} value={t.tribe}>
                      {`${tribeLabel(t.tribe)} — ${n(t.count)} creature${t.count === 1 ? "" : "s"}${t.count < TYPAL_FLOOR ? ` (aim for ${TYPAL_FLOOR}+)` : ""}`}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <span className="text-xs font-medium text-muted">Creature type</span>
                <p className="py-2 text-xs leading-5 text-subtle">
                  {!commander
                    ? "Pick a commander to see the creature types you could build around."
                    : scores.status === "ready"
                      ? "No creature type has 10 or more creatures in these colours yet."
                      : "Counting your creature types…"}
                </p>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={ids.bracket} className="text-xs font-medium text-muted">
              Bracket
            </label>
            <select
              id={ids.bracket}
              value={bracket === "" ? "" : String(bracket)}
              onChange={(event) => pickBracket(event.target.value === "" ? "" : Number(event.target.value))}
              className={inputClass(false)}
            >
              <option value="">Any bracket</option>
              {COMMANDER_BRACKETS.map((b) => (
                <option key={b.level} value={String(b.level)}>{`${b.level} · ${b.name}`}</option>
              ))}
            </select>
          </div>
        </div>
        <div id={ids.choiceHint} className="flex flex-col gap-1 text-xs leading-5 text-muted empty:hidden">
          {pickedType ? (
            <p>
              {pickedType.label}: {pickedType.summary}
              {typeCount !== null
                ? ` You own ${n(typeCount)} ${pickedType.label} card${typeCount === 1 ? "" : "s"} in these colours — a ${pickedType.label} deck wants about ${pickedType.floor}.`
                : ""}
            </p>
          ) : null}
          {commander && fitsTypes.length > 0 ? (
            <p>
              {commander.name}&apos;s own text plays into{" "}
              {fitsTypes.map((id) => collectionDeckType(id)?.label).filter(Boolean).join(", ")}.
            </p>
          ) : null}
          {bracketLevel ? <p>Bracket {bracketLevel}: {commanderBracket(bracketLevel)?.blurb}</p> : null}
        </div>
        {/* Always mounted: a status region added with its text is often not announced. */}
        <p role="status" className="text-xs text-ember empty:hidden">
          {choiceNote ?? ""}
        </p>
        </div>
        <p className="text-xs text-subtle">
          &ldquo;Draft a deck&rdquo; is free and follows the rules. &ldquo;Build with AI&rdquo; reads your cards and plans around
          your commander{balance !== null ? ` — you have ${n(balance)} credit${balance === 1 ? "" : "s"}` : ""}.
          {draftBlocked || aiOff || themeTooThin ? <span id={ids.reason}> {draftBlocked ?? aiOff ?? themeTooThin}</span> : null}
        </p>
        <p role="status" className="text-sm text-muted empty:hidden">
          {working === "ai" ? "The AI is choosing from your cards. This takes up to a minute." : working === "rules" ? "Drafting…" : ""}
        </p>
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            {error}
          </p>
        ) : null}
        {kept && !draft ? (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 items-start gap-2 text-sm text-foreground">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
              <span>
                You have an unsaved AI build for <span className="font-medium">{kept.draft.commander.name}</span> from{" "}
                {new Date(kept.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. This browser
                keeps it for {LAST_AI_DRAFT_DAYS} days.
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={restoreKept}>
                Show it
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissKept}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {draft && !listOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
          <p className="text-sm text-muted">
            {n(legal.length)} commander{legal.length === 1 ? "" : "s"} in your collection.
          </p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={false}
            onClick={() => {
              focusListOnOpen.current = true;
              setListOpen(true);
            }}
          >
            <ChevronDown aria-hidden />
            Change commander
          </Button>
        </div>
      ) : (
        <section id={ids.list} aria-labelledby={ids.listHeading} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3
                ref={listHeadingRef}
                tabIndex={-1}
                id={ids.listHeading}
                className="text-base font-semibold text-foreground focus:outline-none"
              >
                Your commanders <span className="font-normal text-muted">({n(commanders.length)})</span>
              </h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={suggestBlocked ? undefined : suggest}
                aria-disabled={suggestBlocked || suggesting || working ? true : undefined}
                aria-describedby={ids.suggestReason}
                className={cn((suggestBlocked || suggesting || working) && "opacity-50")}
              >
                <Sparkles aria-hidden />
                {suggesting ? "Suggesting…" : "Suggest a commander · 1 credit"}
              </Button>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
                {commanders.length > 8 ? (
                  <div className="flex min-w-0 flex-col gap-1 sm:w-56">
                    <label htmlFor={ids.filter} className="text-xs font-medium text-muted">
                      Find a commander
                    </label>
                    <input
                      id={ids.filter}
                      type="search"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      className={inputClass(false)}
                    />
                  </div>
                ) : null}
                {commanders.length > 1 ? (
                  <div className="flex min-w-0 flex-col gap-1 sm:w-64">
                    <label htmlFor={ids.sort} className="text-xs font-medium text-muted">
                      Sort
                    </label>
                    <select
                      id={ids.sort}
                      value={sort}
                      onChange={(event) => setSort(event.target.value as CommanderSort)}
                      className={inputClass(false)}
                    >
                      {(Object.keys(SORT_LABELS) as CommanderSort[]).map((key) => (
                        <option key={key} value={key}>
                          {sortLabel(key, pickedType)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </div>
            {commanders.length > 8 ? (
              <ChipGroup
                multiSelect
                options={COLOUR_OPTIONS}
                value={colours}
                keepCase
                size="sm"
                ariaLabel="Commander colours"
                onChange={setColours}
              />
            ) : null}
            {sort !== "name" && scores.status !== "ready" ? (
              <p role="status" className="text-xs text-muted">
                {scores.status === "loading"
                  ? "Ranking your commanders by your cards…"
                  : "Your commanders couldn't be ranked right now — they're listed by name."}
              </p>
            ) : null}
            <p id={ids.suggestReason} className="text-xs text-subtle">
              {suggestBlocked ??
                `"Suggest a commander" asks the AI which of your commanders your cards support best${
                  pickedType || colours.length ? " — for the deck type and colours picked" : ""
                }.`}
            </p>
            <p role="status" className="text-sm text-muted empty:hidden">
              {suggesting ? "The AI is reading your commanders and cards. This takes up to a minute." : ""}
            </p>
            {suggestError ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                {suggestError}
              </p>
            ) : null}
          </div>

          {suggestions ? (
            <CommanderSuggestions
              result={suggestions.result}
              savedAt={suggestions.savedAt}
              headingId={ids.suggestions}
              headingRef={suggestionsHeadingRef}
              onBuild={buildFromSuggestion}
              onDismiss={dismissSuggestions}
            />
          ) : null}

          <fieldset className="min-w-0">
            <legend className="sr-only">Commander</legend>
            <div className="@container flex flex-col gap-3">
              <div id={ids.grid} className="grid grid-cols-3 gap-3 @xl:grid-cols-4 @3xl:grid-cols-6 @5xl:grid-cols-8">
                {shown.map((card, index) => {
                  const off = !card.commanderLegal;
                  const active = card.id === commanderId;
                  const cardSupport = supportFor(card);
                  return (
                    <label
                      key={card.id}
                      className={cn(
                        "group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg p-1",
                        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-bright/60",
                        active && "bg-primary/15 ring-2 ring-primary",
                        off && "cursor-not-allowed opacity-50",
                        folded && !active && foldedTileClass(index),
                      )}
                    >
                      <input
                        type="radio"
                        name="commander"
                        value={card.id}
                        checked={active}
                        // Reachable, its reason in its name; never picked.
                        aria-disabled={off || undefined}
                        aria-label={
                          off
                            ? `${card.name} (not legal in Commander)`
                            : cardSupport
                              ? pickedType
                                ? `${card.name}, ${n(cardSupport.deckTypes[pickedType.id] ?? 0)} of your ${pickedType.label} cards in its colours`
                                : `${card.name}, ${n(cardSupport.fit)} of your cards fit its plan`
                              : card.name
                        }
                        onChange={() => pick(card)}
                        className="sr-only"
                      />
                      <PrintingPicture imageUrl={card.imageUrl} name={card.name} size="small" />
                      <span className="truncate text-xs font-medium text-foreground">{card.name}</span>
                      {off ? (
                        <span className="text-[11px] leading-4 text-subtle">Not legal in Commander</span>
                      ) : cardSupport ? (
                        <span aria-hidden className="text-[11px] leading-4 text-subtle">
                          {pickedType
                            ? `${n(cardSupport.deckTypes[pickedType.id] ?? 0)} ${pickedType.label}`
                            : `${n(cardSupport.fit)} fit · ${n(cardSupport.inColours)} cards`}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              {matching.length === 0 ? <p className="text-sm text-muted">No commander matches.</p> : null}
              {!filtering && matching.length > 6 ? (
                expanded ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    aria-expanded
                    aria-controls={ids.grid}
                    onClick={() => setExpanded(false)}
                  >
                    <ChevronUp aria-hidden />
                    Show fewer
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("self-start", showAllClass(matching.length))}
                    aria-expanded={false}
                    aria-controls={ids.grid}
                    onClick={() => setExpanded(true)}
                  >
                    <ChevronDown aria-hidden />
                    Show all {n(matching.length)} commanders
                  </Button>
                )
              ) : null}
            </div>
          </fieldset>
        </section>
      )}

      {draft ? (
        <DraftReview
          key={`${draft.commander.cardId}-${source}-${draft.total}-${draft.picks.length}`}
          draft={draft}
          source={source}
          truncated={truncated}
          onSaved={source === "ai" ? () => clearLastAiDraft(viewerId) : undefined}
          choice={draftChoice}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

function DraftReview({
  draft,
  source,
  truncated,
  onSaved,
  choice = {},
}: {
  draft: CommanderDraft;
  source: DraftSource;
  truncated: boolean;
  /** Called once the draft is a deck (the AI draft this browser kept goes). */
  onSaved?: () => void;
  /** The deck type / creature type / bracket it was built with (saved on the deck). */
  choice?: BuildChoice;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A new draft takes the focus — it lands under the build bar, and a
  // keyboard or screen-reader user should hear it arrived, not hunt for it.
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, []);
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [basics, setBasics] = useState<DraftBasic[]>(draft.basics);
  const [title, setTitle] = useState(`${draft.commander.name} from my collection`.slice(0, 80));
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [saved, setSaved] = useState<{ slug: string; title: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePressed = useRef(false);
  const [pending, startTransition] = useTransition();
  const ids = { title: useId(), heading: useId() };

  const kept = draft.picks.filter((p) => !left.has(p.cardId));
  const basicCount = basics.reduce((sum, b) => sum + b.count, 0);
  const total = 1 + kept.length + basicCount;
  const over = total - COMMANDER_DECK_SIZE;

  const groups = useMemo(() => {
    const byRole = new Map<DeckRole, typeof draft.picks>();
    for (const role of ROLE_ORDER) byRole.set(role, []);
    for (const pick of draft.picks) byRole.get(pick.role)?.push(pick);
    return byRole;
  }, [draft]);

  const toggle = (id: string) =>
    setLeft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stepBasic = (name: DraftBasic["name"], step: number) =>
    setBasics((prev) => prev.map((b) => (b.name === name ? { ...b, count: Math.max(0, Math.min(99, b.count + step)) } : b)));

  const save = () => {
    setSaveError(null);
    if (over > 0) {
      setSaveError(`That's ${total} cards — leave out ${over} to make ${COMMANDER_DECK_SIZE}.`);
      return;
    }
    // Every press after the first says so: a press whose answer was lost
    // made a deck, and the server takes that one back instead of a second.
    const retry = savePressed.current;
    savePressed.current = true;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveCollectionDeckAction>>;
      try {
        result = await saveCollectionDeckAction({
          commanderId: draft.commander.cardId,
          cardIds: kept.map((p) => p.cardId),
          basics: basics.filter((b) => b.count > 0).map((b) => ({ name: b.name, count: b.count })),
          title,
          visibility,
          retry,
          deckType: choice.deckType ?? null,
          tribe: choice.tribe ?? null,
          bracket: choice.bracket ?? null,
        });
      } catch {
        setSaveError("The connection dropped before the deck was saved. Press Save deck again — it won't make a second one.");
        return;
      }
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSaved({ slug: result.slug, title: result.title });
      onSaved?.();
      toast.success(`${result.title} is saved as a deck.`);
    });
  };

  const maxCurve = Math.max(1, ...draft.curve);

  return (
    <section aria-labelledby={ids.heading} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 ref={headingRef} tabIndex={-1} id={ids.heading} className="scroll-mt-24 font-display text-xl font-semibold text-foreground focus:outline-none">
            Your draft
          </h2>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            {source === "ai" ? "Built with AI" : "Drafted by the rules"}
          </span>
          {(draft.focus ?? []).map((f) => (
            <span key={f.label} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
              {f.label} · {f.inDeck} in the deck
            </span>
          ))}
          {draft.gameChangers !== undefined && draft.gameChangers !== null ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
              {draft.bracket ? `Built for Bracket ${draft.bracket} · ` : ""}
              {draft.gameChangers} Game Changer{draft.gameChangers === 1 ? "" : "s"}
              {draft.bracketFloor && draft.bracketFloor > 2 ? ` · its cards need Bracket ${draft.bracketFloor} or higher` : ""}
            </span>
          ) : draft.bracket ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">Built for Bracket {draft.bracket}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          <span className={cn("font-semibold tabular-nums", over > 0 ? "text-danger" : "text-foreground")}>
            {total} / {COMMANDER_DECK_SIZE}
          </span>{" "}
          cards — the commander, {kept.length} from your collection and {basicCount} basic land{basicCount === 1 ? "" : "s"}.
          Every card but the basics is one you own.
        </p>
        {draft.strategy ? (
          <blockquote className="border-l-2 border-primary-bright/60 pl-3 text-sm leading-6 text-foreground">{draft.strategy}</blockquote>
        ) : null}
        {draft.warnings.length > 0 || truncated ? (
          <ul className="flex flex-col gap-1">
            {truncated ? (
              <li className="text-sm text-ember">Your collection is very large: the draft read the first 12,000 cards in these colours.</li>
            ) : null}
            {draft.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm text-ember">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface/40 p-3">
            <div className="w-14 shrink-0">
              <PrintingPicture imageUrl={draft.commander.imageUrl} name={draft.commander.name} size="small" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">Commander</p>
              <p className="truncate font-medium text-foreground">{draft.commander.name}</p>
              <p className="truncate text-xs text-subtle">{draft.commander.typeLine}</p>
            </div>
          </div>

          {ROLE_ORDER.map((role) => {
            const picks = groups.get(role) ?? [];
            if (picks.length === 0) return null;
            const keptHere = picks.filter((p) => !left.has(p.cardId)).length;
            return (
              <section key={role} aria-labelledby={`${ids.heading}-${role}`} className="flex min-w-0 flex-col gap-2">
                <h3 id={`${ids.heading}-${role}`} className="text-sm font-semibold text-foreground">
                  {ROLE_LABELS[role]} <span className="font-normal text-muted">({keptHere})</span>
                </h3>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {picks.map((pick) => {
                    const out = left.has(pick.cardId);
                    return (
                      <li
                        key={pick.cardId}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-md border border-transparent px-1.5 py-1",
                          out ? "opacity-50" : "hover:border-border",
                        )}
                      >
                        <div className="w-8 shrink-0">
                          <PrintingPicture imageUrl={pick.imageUrl} name={pick.name} size="small" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm text-foreground", out && "line-through")}>{pick.name}</p>
                          <p className="truncate text-xs text-subtle">
                            {pick.typeLine}
                            {pick.fromAi ? " · AI's pick" : ""}
                          </p>
                          {pick.aiWhy ? (
                            <p className={cn("text-xs leading-5 text-muted", out && "line-through")}>{pick.aiWhy}</p>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(pick.cardId)}
                          aria-label={out ? `Put ${pick.name} back` : `Leave ${pick.name} out`}
                          className="h-8 w-8 shrink-0 px-0"
                          disabled={saved !== null}
                        >
                          {out ? <Undo2 aria-hidden /> : <X aria-hidden />}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <section aria-labelledby={`${ids.heading}-basics`} className="flex min-w-0 flex-col gap-2">
            <h3 id={`${ids.heading}-basics`} className="text-sm font-semibold text-foreground">
              Basic lands <span className="font-normal text-muted">({basicCount})</span>
            </h3>
            {basics.length === 0 ? (
              <p className="text-sm text-muted">None — your own lands fill the mana base.</p>
            ) : (
              <ul className="flex flex-wrap gap-3">
                {basics.map((basic) => (
                  <li key={basic.name} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                    <span className="text-sm text-foreground">{basic.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 px-0"
                      onClick={() => stepBasic(basic.name, -1)}
                      disabled={basic.count === 0 || saved !== null}
                      aria-label={`One ${basic.name} fewer`}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums text-foreground" aria-live="polite">
                      {basic.count}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 px-0"
                      onClick={() => stepBasic(basic.name, 1)}
                      disabled={saved !== null}
                      aria-label={`One ${basic.name} more`}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-subtle">Basics are added to the deck as printings — you don&apos;t need them in your collection.</p>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">The shape</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {(["ramp", "draw", "removal", "wipe"] as const).map((role) => (
                <div key={role} className="contents">
                  <dt className="text-muted">{ROLE_LABELS[role]}</dt>
                  <dd className="text-right tabular-nums text-foreground">
                    {draft.counts[role]} <span className="text-subtle">/ ~{ROLE_TARGETS[role]}</span>
                  </dd>
                </div>
              ))}
              <dt className="text-muted">Lands</dt>
              <dd className="text-right tabular-nums text-foreground">{draft.counts.land}</dd>
            </dl>
            <h4 className="mt-2 text-xs font-medium text-muted">Mana curve (spells)</h4>
            <table className="w-full text-xs">
              <caption className="sr-only">Spells by mana value</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Mana value</th>
                  <th scope="col">Spells</th>
                </tr>
              </thead>
              <tbody>
                {draft.curve.map((count, mv) => (
                  <tr key={mv}>
                    <th scope="row" className="w-6 py-0.5 text-left font-normal tabular-nums text-muted">
                      {mv === 7 ? "7+" : mv}
                    </th>
                    <td className="py-0.5">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-2 rounded-full bg-[var(--color-chart-1)]" style={{ width: `${(count / maxCurve) * 100}%`, minWidth: count ? 4 : 0 }} />
                        <span className="tabular-nums text-foreground">{count}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
            <h3 className="text-sm font-semibold text-foreground">Save as a deck</h3>
            {saved ? (
              <div className="flex flex-col gap-3">
                <p role="status" className="text-sm text-foreground">
                  {saved.title} is saved.
                </p>
                <Link href={`/deck/${saved.slug}`} className={buttonVariants({ variant: "primary" })}>
                  Open the deck
                </Link>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={ids.title} className="text-xs font-medium text-muted">
                    Deck name
                  </label>
                  <input
                    id={ids.title}
                    value={title}
                    maxLength={80}
                    onChange={(event) => setTitle(event.target.value)}
                    className={inputClass(false)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span aria-hidden className="text-xs font-medium text-muted">
                    Who can see it
                  </span>
                  <ChipGroup
                    options={VISIBILITY_OPTIONS}
                    value={visibility}
                    onChange={setVisibility}
                    keepCase
                    ariaLabel="Who can see the deck"
                  />
                  <p className="text-xs text-subtle">{VISIBILITY_HINT[visibility]}</p>
                </div>
                {saveError ? (
                  <p role="alert" className="text-sm text-danger">
                    {saveError}
                  </p>
                ) : null}
                <Button onClick={save} disabled={pending || !title.trim()}>
                  {pending ? "Saving…" : "Save deck"}
                </Button>
                <p className="text-xs text-subtle">Free. The deck is yours to edit like any other.</p>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
