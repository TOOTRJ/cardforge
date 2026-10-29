"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronUp, Globe2, Link2, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { FieldGroup, inputClass, joinIds, textareaClass } from "@/components/creator/field-group";
import { DeckAiPausedNote } from "@/components/decks/deck-ai-coming-soon";
import { ImportSlotForecast } from "@/components/decks/import-decklist-dialog";
import { createDeckAction } from "@/lib/decks/actions";
import { commitDeckImportAction, resolveDecklistAction, type ImportReviewLine } from "@/lib/decks/import";
import { frontFaceName, MAX_DECKLIST_CHARS, parseDecklist, type ParseWarning } from "@/lib/decks/parse-decklist";
import {
  clearNewDeckDraft,
  NEW_DECK_CONTEXT_PATH,
  newDeckContextOf,
  readNewDeckDraft,
  saveNewDeckDraft,
  type NewDeckContext,
} from "@/lib/decks/new-deck";
import { newDeckAuthHref, newDeckPageHref } from "@/lib/decks/new-deck-paths";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import { cn } from "@/lib/utils";
import { DECK_FORMAT_LABELS, DECK_FORMAT_VALUES, type DeckFormat } from "@/types/deck";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// NewDeckDialog — the one short way to start a deck (TODO DK4.1; it replaced
// the four-step DeckWizard, DK4.2). Opened through NewDeckProvider
// (`useNewDeck().openNewDeck`), never rendered by a page itself.
//
//   Deck name   1+ characters (createDeckSchema's rule)
//   Format      a single-select chip row: Commander (the default),
//               Standard, Modern, Pauper, Brawl; "More" adds the rest
//   Paste       optional. On Create the deck is made FIRST, then the list
//               goes through the deck page's import (resolve → commit, the
//               `import_deck_entries` RPC) without the review step — so only
//               EXACT matches go in as cards: a best guess is kept as a
//               name to check (a placeholder), never a guessed card, and
//               the toast names those lines and the ones skipped. A list
//               that can't be read keeps the deck: the dialog says what the
//               import said and offers it again (never twice — the commit's
//               `firstImportOnly`) or the deck page. The saved-card forecast
//               (owner decision D2) never blocks.
//   Visibility  "Visibility: Public · change". Public by default; the
//               maker CHOOSES private (owner 2026-10-29: "same as how
//               create card is"), so "change" opens the creator's Publish
//               control in deck words — a "Keep it private" box over the
//               Unlisted | Public chips, in the creator's order. Decks are
//               unlimited on every plan (the plans differ in saved cards).
//
// Signed out (TODO DK4.3), Create asks the visitor to sign up or sign in;
// their input waits in sessionStorage (lib/decks/new-deck.ts) and the auth
// pages send them back to /dashboard/decks/new, which reopens this with it.
// AI deck building is paused (lib/ai/deck-ai-pause.ts): one quiet line, no
// AI path. Description, cover, deck type and bracket are the deck page's.
// ---------------------------------------------------------------------------

/** Why the dialog closed: a dismissal (Cancel, Escape, the X, a click
 *  outside) or the new deck's page opening. */
export type NewDeckCloseReason = "dismiss" | "created";

export type NewDeckDialogRequest = {
  /** A new key per open: every open starts from a fresh form. */
  key: number;
  format?: DeckFormat;
  cardId?: string;
  /** What opened it: the focus goes back there when it closes (it opens
   *  from context, so Radix has no trigger of its own to return to). */
  returnFocusTo?: HTMLElement | null;
};

/** The chips shown before "More": the formats most decks are built for. */
export const PRIMARY_DECK_FORMATS: readonly DeckFormat[] = ["commander", "standard", "modern", "pauper", "brawl"];

// The card creator's Publish control (components/creator/panels/
// publish-panel.tsx), mirrored: private is a box the maker ticks, never a
// chip; the chips are the creator's two, in its order, in deck words.
const SHARED_VISIBILITY_OPTIONS: ChipOption<Visibility>[] = [
  {
    value: "unlisted",
    label: "Unlisted",
    description: "Anyone with the link can view, hidden from community decks.",
    icon: Link2,
  },
  {
    value: "public",
    label: "Public",
    description: "Listed in community decks and on your profile. The default.",
    icon: Globe2,
  },
];

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

const SIGNED_OUT: NewDeckContext = { signedIn: false, cardCapacity: null };

const OFFLINE = "Couldn't reach PipGlyph. Check your connection and try again.";

type Phase = "form" | "creating" | "importing" | "created";

type ImportFeedback = {
  error: string;
  warnings: ParseWarning[];
  /** The commit found the list in the deck already (a lost answer): there
   *  is nothing left to add. */
  listIn?: boolean;
};

/** Up to three names, then how many more. */
function someNames(names: readonly string[]): string {
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/** The parser's skipped / adjusted lines, by number and words. */
function skippedLines(warnings: readonly ParseWarning[]): string {
  return someNames(warnings.map((warning) => (warning.raw ? `${warning.line} (“${warning.raw.slice(0, 40)}”)` : `${warning.line}`)));
}

/**
 * What a quick import left for the maker to check (TODO DK4.1): the lines
 * kept as NAMES — a best guess or a name Scryfall didn't find; a guess is
 * never committed as a card without the review step — and the lines the
 * parser skipped or adjusted. Undefined when there is nothing to say.
 */
export function quickImportNotes(
  reviewLines: readonly ImportReviewLine[],
  warnings: readonly ParseWarning[],
): string | undefined {
  const toCheck = reviewLines.filter((line) => line.quantity > 0 && line.status !== "resolved").map((line) => line.name);
  const notes = [
    toCheck.length > 0
      ? `${lines(toCheck.length)} kept as ${toCheck.length === 1 ? "a name" : "names"} to check: ${someNames(toCheck)}.`
      : null,
    warnings.length > 0 ? `${lines(warnings.length)} skipped or adjusted: line ${skippedLines(warnings)}.` : null,
  ].filter(Boolean);
  return notes.length > 0 ? notes.join(" ") : undefined;
}

export function NewDeckDialog({
  open,
  request,
  onClosed,
}: {
  open: boolean;
  request: NewDeckDialogRequest;
  onClosed: (reason: NewDeckCloseReason) => void;
}) {
  const router = useRouter();
  const ids = useId();

  // What a signed-out visitor typed before signing in comes back here.
  const [draft] = useState(() => readNewDeckDraft());
  const [title, setTitle] = useState(draft?.title ?? "");
  const [format, setFormat] = useState<DeckFormat>(draft?.format ?? request.format ?? "commander");
  const [visibility, setVisibility] = useState<Visibility>(draft?.visibility ?? "public");
  const [decklist, setDecklist] = useState(draft?.decklist ?? "");
  const cardId = draft?.cardId ?? request.cardId ?? null;

  const [moreFormats, setMoreFormats] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [askToSignIn, setAskToSignIn] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [created, setCreated] = useState<{ deckId: string; slug: string; title: string } | null>(null);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);

  // Who is asking, and their saved-card slots. No session cookie = signed
  // out at once; otherwise GET /api/me (null until it answers — or if it
  // can't: then Create asks the server, which knows).
  const [context, setContext] = useState<NewDeckContext | null>(() =>
    hasSupabaseSessionCookie() ? null : SIGNED_OUT,
  );
  useEffect(() => {
    if (context?.signedIn === false) return;
    const controller = new AbortController();
    void fetchNewDeckContext(controller.signal).then((next) => {
      if (next) setContext(next);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open (the dialog is keyed)
  }, []);
  const signedIn = context?.signedIn ?? null;

  const nameRef = useRef<HTMLInputElement>(null);
  const signUpRef = useRef<HTMLAnchorElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const openDeckRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  // A create whose ANSWER was lost may have made the deck: the next press
  // asks for that deck back instead of a second one (reuseRecentTwin).
  const createLost = useRef(false);
  // How the dialog last closed — a "created" close navigates away, so the
  // focus is not handed back to the opener.
  const closedAs = useRef<NewDeckCloseReason | null>(null);

  // The paste, read as the import will read it — for the forecast only.
  const deferredList = useDeferredValue(decklist);
  const parsed = useMemo(() => {
    if (!deferredList.trim()) return null;
    const { entries, warnings } = parseDecklist(deferredList);
    const cards = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const distinct = new Set(entries.map((entry) => (frontFaceName(entry.name) ?? entry.name).trim().toLowerCase())).size;
    return {
      cards,
      distinct,
      entries: entries.length,
      warnings,
      firstWarning: warnings[0]?.reason ?? null,
    };
  }, [deferredList]);

  // A control that replaced the one holding the focus takes it.
  useEffect(() => {
    if (askToSignIn) signUpRef.current?.focus();
  }, [askToSignIn]);
  useEffect(() => {
    if (phase !== "created") return;
    (importFeedback?.listIn ? openDeckRef.current : retryRef.current)?.focus();
  }, [phase, importFeedback]);

  const busy = phase === "creating" || phase === "importing";
  // The deck is made and its list was refused: from here the dialog offers
  // the list again or the deck page — never the form (no second deck).
  const deckKept = created !== null && importFeedback !== null;

  const formatOptions = useMemo<ChipOption<DeckFormat>[]>(() => {
    const shown = moreFormats
      ? [...PRIMARY_DECK_FORMATS, ...DECK_FORMAT_VALUES.filter((f) => !PRIMARY_DECK_FORMATS.includes(f))]
      : PRIMARY_DECK_FORMATS.includes(format)
        ? PRIMARY_DECK_FORMATS
        : [...PRIMARY_DECK_FORMATS, format];
    return shown.map((value) => ({ value, label: DECK_FORMAT_LABELS[value] }));
  }, [moreFormats, format]);

  const currentDraft = () => ({ title, format, visibility, decklist, cardId });

  const close = (reason: NewDeckCloseReason) => {
    closedAs.current = reason;
    if (reason === "dismiss") {
      // A deliberate close drops what a signed-out visitor kept.
      clearNewDeckDraft();
      // The deck exists (its list failed): the page behind lists it now.
      if (created) router.refresh();
    }
    onClosed(reason);
  };

  const openDeck = (slug: string, empty: boolean) => {
    close("created");
    router.push(newDeckPageHref(slug, empty));
  };

  /** The pasted list into the new deck: the deck page's import, minus its
   *  review. Any refusal keeps the deck and says what the import said. */
  const importList = async (deck: { deckId: string; slug: string }) => {
    setPhase("importing");
    const resolved = await resolveDecklistAction({ text: decklist });
    if (!resolved.ok) {
      setImportFeedback({ error: resolved.error, warnings: [] });
      setPhase("created");
      return;
    }
    const committed = await commitDeckImportAction({
      deckId: deck.deckId,
      // Only an EXACT match goes in as its card. Without the review step a
      // best guess ("Lightning Blot" → Lightning Blow, a set + number that
      // points at another card) is kept as the name typed — a placeholder
      // the maker can check — never as the guessed card.
      lines: resolved.lines
        .filter((line) => line.quantity > 0)
        .map((line) => ({
          name: line.name,
          quantity: line.quantity,
          board: line.board,
          resolved: line.status === "resolved" ? line.resolved : null,
        })),
      firstImportOnly: true,
    });
    if (!committed.ok) {
      setImportFeedback({
        error: committed.error,
        warnings: committed.alreadyImported ? [] : resolved.parseWarnings,
        listIn: committed.alreadyImported === true,
      });
      setPhase("created");
      return;
    }
    const bits = [
      `${committed.added} added`,
      committed.merged > 0 ? `${committed.merged} merged` : null,
      committed.placeholders > 0
        ? `${committed.placeholders} placeholder${committed.placeholders === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);
    const notes = quickImportNotes(resolved.lines, resolved.parseWarnings);
    toast.success(`Deck created — ${bits.join(", ")}.`, {
      description: notes,
      // Long enough to read the names it lists.
      duration: notes ? 12_000 : undefined,
    });
    openDeck(deck.slug, false);
  };

  const submit = async () => {
    if (busy || submitting.current) return;
    const name = title.trim();
    if (!name) {
      setNameError("Give the deck a name.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setFormError(null);
    if (signedIn === false) {
      saveNewDeckDraft(currentDraft());
      setAskToSignIn(true);
      return;
    }

    submitting.current = true;
    setPhase("creating");
    let made = false;
    try {
      const result = await createDeckAction(
        { title: name, format, visibility },
        {
          redirectAfterCreate: false,
          surface: "dialog",
          firstCardId: cardId ?? undefined,
          ...(createLost.current ? { reuseRecentTwin: true } : {}),
        },
      );
      createLost.current = false;
      if (!result.ok) {
        setPhase("form");
        if (result.code === "AUTH_REQUIRED") {
          setContext(SIGNED_OUT);
          saveNewDeckDraft(currentDraft());
          setAskToSignIn(true);
          return;
        }
        if (result.fieldErrors?.title) {
          setNameError(result.fieldErrors.title);
          nameRef.current?.focus();
          return;
        }
        setFormError(
          result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "Couldn't create the deck. Try again.",
        );
        return;
      }
      made = true;
      clearNewDeckDraft();
      if (result.firstCardError) toast.message(result.firstCardError);
      setCreated({ deckId: result.deckId, slug: result.slug, title: name });
      if (!decklist.trim()) {
        toast.success("Deck created.");
        // Empty unless its first card went in: only an empty deck asks the
        // page to focus its way to add cards.
        openDeck(result.slug, !(cardId && !result.firstCardError));
        return;
      }
      await importList(result);
    } catch {
      // A throw (the network) after the deck was made is the list's failure:
      // the deck is kept, never made twice.
      if (made) {
        setImportFeedback({ error: OFFLINE, warnings: [] });
        setPhase("created");
      } else {
        // The deck may have been made all the same: the next press asks for
        // it back before making another.
        createLost.current = true;
        setPhase("form");
        setFormError(OFFLINE);
      }
    } finally {
      submitting.current = false;
    }
  };

  const retryImport = async () => {
    if (!created || busy || submitting.current || !decklist.trim() || importFeedback?.listIn) return;
    submitting.current = true;
    try {
      await importList(created);
    } catch {
      setImportFeedback({ error: OFFLINE, warnings: [] });
      setPhase("created");
    } finally {
      submitting.current = false;
    }
  };

  const visibilityPanelId = `${ids}-visibility`;
  const privateNameId = `${ids}-private-name`;
  const privateNoteId = `${ids}-private-note`;
  const forecastId = `${ids}-forecast`;
  const signInTextId = `${ids}-sign-in`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never mid-create: the deck (and its list) is on its way.
        if (!next && !busy) close("dismiss");
      }}
    >
      {/* A 1 rem gutter on a phone; 36 rem wide on a desk. */}
      <DialogContent
        size="md"
        className="w-[calc(100%-2rem)] max-w-xl"
        closeDisabled={busy}
        onCloseAutoFocus={(event) => {
          // Created: the deck's page opens and takes the focus itself.
          if (closedAs.current === "created") {
            event.preventDefault();
            return;
          }
          const opener = request.returnFocusTo;
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New deck</DialogTitle>
          <DialogDescription>
            {phase === "created"
              ? "Your deck is made. Its list still needs adding."
              : "Name it and pick a format. Paste a list now, or add cards on the deck page."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (deckKept) void retryImport();
            else void submit();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            {deckKept ? (
              <CreatedFeedback deckTitle={created.title} feedback={importFeedback} />
            ) : (
              <>
                {draft ? (
                  <p className="text-xs leading-5 text-muted">Your deck is as you left it — create it when you&apos;re ready.</p>
                ) : null}
                <FieldGroup label="Deck name" error={nameError ?? undefined}>
                  <input
                    ref={nameRef}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (nameError && event.target.value.trim()) setNameError(null);
                    }}
                    maxLength={120}
                    placeholder="e.g. Krenko's Goblin Swarm"
                    className={inputClass(Boolean(nameError))}
                    // Read-only, never disabled, while the deck is made: a
                    // disabled control drops the focus.
                    readOnly={busy}
                    autoComplete="off"
                  />
                </FieldGroup>

                <FieldGroup kind="control" label="Format" helper="Sets the deck's size and copy limits.">
                  {(aria) => (
                    <div className="flex flex-wrap items-start gap-2">
                      <ChipGroup
                        ariaLabel="Format"
                        ariaDescribedBy={aria["aria-describedby"]}
                        options={formatOptions}
                        value={format}
                        onChange={setFormat}
                        keepCase
                      />
                      <button
                        type="button"
                        aria-expanded={moreFormats}
                        aria-label="More formats"
                        onClick={() => setMoreFormats((value) => !value)}
                        className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        More
                        {moreFormats ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                  )}
                </FieldGroup>

                <DecklistField
                  value={decklist}
                  onChange={setDecklist}
                  readOnly={busy}
                  forecastId={forecastId}
                  forecast={
                    parsed && parsed.entries > 0 ? (
                      <>
                        {context?.cardCapacity ? (
                          <ImportSlotForecast
                            cardCapacity={context.cardCapacity}
                            cards={parsed.cards}
                            distinctCards={parsed.distinct}
                          />
                        ) : (
                          <p className="text-xs leading-5 text-muted">
                            {`${parsed.cards} card${parsed.cards === 1 ? "" : "s"} found — added when you create the deck.`}
                          </p>
                        )}
                        {parsed.warnings.length > 0 ? (
                          <p className="text-xs leading-5 text-gold">
                            {`${lines(parsed.warnings.length)} skipped or adjusted: line ${skippedLines(parsed.warnings)}.`}
                          </p>
                        ) : null}
                      </>
                    ) : parsed ? (
                      // Nothing readable yet: the import's own words. Never a
                      // block — the deck is made, and the dialog says so.
                      <p className="text-xs leading-5 text-gold">
                        {parsed.firstWarning ?? "No cards found yet — expected lines like “4 Lightning Bolt”."}
                      </p>
                    ) : null
                  }
                />

                <div className="flex flex-col gap-2">
                  <p className="text-sm text-foreground">
                    <span className="text-muted">Visibility:</span>{" "}
                    <span className="font-semibold">{VISIBILITY_LABELS[visibility]}</span>
                    <span className="text-subtle" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <button
                      type="button"
                      aria-expanded={visibilityOpen}
                      aria-controls={visibilityOpen ? visibilityPanelId : undefined}
                      aria-label="Change visibility"
                      onClick={() => setVisibilityOpen((value) => !value)}
                      className="rounded-sm font-semibold text-primary-bright underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                    >
                      change
                    </button>
                  </p>
                  {visibilityOpen ? (
                    <div id={visibilityPanelId} className="flex flex-col gap-3">
                      {/* Named by its words, DESCRIBED by the line under them
                          (the creator's "Save as a draft", TODO 3b.36); the
                          label makes the whole box a click target. */}
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                        <input
                          type="checkbox"
                          checked={visibility === "private"}
                          // Unticked, a private deck is offered public again
                          // (the default), as the creator does.
                          onChange={(event) => setVisibility(event.target.checked ? "private" : "public")}
                          aria-labelledby={privateNameId}
                          aria-describedby={privateNoteId}
                          className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span id={privateNameId} className="inline-flex items-center gap-1.5 font-medium">
                            <Lock className="h-4 w-4 text-muted" aria-hidden />
                            Keep it private
                          </span>
                          <span id={privateNoteId} className="text-xs leading-5 text-muted">
                            Only you can see it. Untick it whenever you&apos;re ready to share it.
                          </span>
                        </span>
                      </label>
                      {visibility === "private" ? null : (
                        <ChipGroup
                          ariaLabel="Visibility"
                          layout="grid-2"
                          size="md"
                          options={SHARED_VISIBILITY_OPTIONS}
                          value={visibility}
                          onChange={setVisibility}
                          keepCase
                        />
                      )}
                    </div>
                  ) : null}
                </div>

                {askToSignIn ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
                    <p id={signInTextId} className="text-sm leading-6 text-foreground">
                      Sign up or sign in to create your deck. What you&apos;ve entered here comes back with you.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        ref={signUpRef}
                        href={newDeckAuthHref("signup", format)}
                        aria-describedby={signInTextId}
                        onClick={() => saveNewDeckDraft(currentDraft())}
                        className={buttonVariants({ size: "sm" })}
                      >
                        Sign up free
                      </Link>
                      <Link
                        href={newDeckAuthHref("login", format)}
                        aria-describedby={signInTextId}
                        onClick={() => saveNewDeckDraft(currentDraft())}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Sign in
                      </Link>
                    </div>
                  </div>
                ) : null}

                {formError ? (
                  <p role="alert" className="flex items-start gap-2 text-sm leading-6 text-danger">
                    <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                    {formError}
                  </p>
                ) : null}

                <DeckAiPausedNote id={`${ids}-ai`} />
              </>
            )}
            {deckKept && !importFeedback.listIn ? (
              <DecklistField
                label="Decklist"
                value={decklist}
                onChange={setDecklist}
                readOnly={busy}
                forecastId={forecastId}
                forecast={null}
              />
            ) : null}
          </div>

          <DialogFooter>
            {/* While the deck is made the submit button is aria-disabled, never
                disabled — it keeps the focus; a second press does nothing. */}
            {deckKept && importFeedback.listIn ? (
              <Button ref={openDeckRef} type="button" onClick={() => openDeck(created.slug, false)}>
                Open the deck
              </Button>
            ) : deckKept ? (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => openDeck(created.slug, true)}>
                  Open the deck
                </Button>
                <Button ref={retryRef} type="submit" aria-disabled={busy || !decklist.trim() || undefined}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {busy ? "Adding the list…" : "Add the list"}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => close("dismiss")}>
                  Cancel
                </Button>
                <Button type="submit" aria-disabled={busy || undefined}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                  {phase === "importing" ? "Adding the list…" : phase === "creating" ? "Creating…" : "Create deck"}
                </Button>
              </>
            )}
            {/* Always in the page, so its change is announced. */}
            <span className="sr-only" role="status">
              {phase === "creating" ? "Creating the deck…" : phase === "importing" ? "Adding the list…" : ""}
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** GET /api/me — the header's own per-visitor answer (`{ user,
 *  cardCapacity }`) — read as the dialog's context. A plain GET, never a
 *  server action: an action rides the router's queue, and the dialog opens
 *  while /dashboard/decks/new may still be navigating. Null when it can't
 *  say (the forecast waits, Create still works — the server decides). */
async function fetchNewDeckContext(signal?: AbortSignal): Promise<NewDeckContext | null> {
  try {
    const response = await fetch(NEW_DECK_CONTEXT_PATH, { cache: "no-store", signal });
    return response.ok ? newDeckContextOf(await response.json()) : null;
  } catch {
    return null;
  }
}

/** The optional decklist. Its note is the forecast (or what the import will
 *  say about a list it can't read), read as the textarea's description. */
function DecklistField({
  label = "Paste a decklist (optional)",
  value,
  onChange,
  readOnly,
  forecastId,
  forecast,
}: {
  /** The kept deck's list is no longer optional: it is what is added. */
  label?: string;
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  forecastId: string;
  forecast: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldGroup
        label={label}
        helper="From MTG Arena, Moxfield, Archidekt, ManaBox or MTGO. You can add cards on the deck page too."
      >
        {(aria) => (
          <textarea
            {...aria}
            aria-describedby={joinIds(aria["aria-describedby"], forecast ? forecastId : null)}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            maxLength={MAX_DECKLIST_CHARS}
            spellCheck={false}
            readOnly={readOnly}
            placeholder={"1 Krenko, Mob Boss\n1 Sol Ring\n29 Mountain"}
            className={cn(textareaClass(false), "font-mono text-xs leading-5")}
          />
        )}
      </FieldGroup>
      {forecast ? <div id={forecastId}>{forecast}</div> : null}
    </div>
  );
}

/** The deck is made; its list wasn't added. The import's own words, the
 *  lines it skipped, and (in the footer) the two ways on — or, when a lost
 *  answer hid a list that DID go in, only the way to the deck. */
function CreatedFeedback({ deckTitle, feedback }: { deckTitle: string; feedback: ImportFeedback | null }) {
  if (feedback?.listIn) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3 text-sm">
        <p className="leading-6 text-foreground">
          <span className="font-semibold">“{deckTitle}” is created</span> and its list is in — open the deck to see
          it.
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm">
      <p className="leading-6 text-foreground">
        <span className="font-semibold">“{deckTitle}” is created</span>, but its list wasn&apos;t added
        {feedback ? `: ${feedback.error}` : "."}
      </p>
      {feedback && feedback.warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted">
          {feedback.warnings.slice(0, 8).map((warning) => (
            <li key={`${warning.line}-${warning.reason}`}>
              Line {warning.line}: {warning.reason}
            </li>
          ))}
          {feedback.warnings.length > 8 ? <li>…and {feedback.warnings.length - 8} more.</li> : null}
        </ul>
      ) : null}
      <p className="text-xs leading-5 text-muted">Fix the list below and add it again, or open the deck and add cards there.</p>
    </div>
  );
}
