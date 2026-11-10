"use client";

import type { Ref } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPips } from "@/components/cards/color-pip";
import { collectionDeckType } from "@/lib/tools/collection/archetypes";
import { describeSupport } from "@/lib/tools/collection/commander-scores";
import type { CommanderSuggestion, SuggestResult } from "@/lib/tools/collection/suggestions";
import { PrintingPicture } from "./printing-tile";

// ---------------------------------------------------------------------------
// "Suggest a commander"'s answer (owner decision 2026-11-09): the AI's
// ranked shortlist of the user's OWN commanders — what each deck would be
// about and why their cards support it — beside the CODE's numbers
// (describeSupport), never numbers the model wrote. "Build this" picks the
// commander and the deck type in the build bar.
// ---------------------------------------------------------------------------

type Pip = "W" | "U" | "B" | "R" | "G" | "C";
const pipsOf = (identity: readonly string[]): Pip[] =>
  identity.length === 0 ? ["C"] : (identity.filter((c) => "WUBRG".includes(c)) as Pip[]);

export function CommanderSuggestions({
  result,
  savedAt,
  headingId,
  headingRef,
  onBuild,
  onDismiss,
}: {
  result: SuggestResult;
  savedAt: string;
  headingId: string;
  headingRef?: Ref<HTMLHeadingElement>;
  onBuild: (suggestion: CommanderSuggestion) => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-base font-semibold text-foreground focus:outline-none"
          >
            <Sparkles className="h-4 w-4 text-primary-bright" aria-hidden />
            Suggested for your collection
          </h3>
          <p className="text-xs text-subtle">
            Ranked by the AI from {new Date(savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. The
            numbers are counted from your cards. This browser keeps it for a week.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          <X aria-hidden />
          Dismiss<span className="sr-only"> the suggestions</span>
        </Button>
      </div>
      {result.overview ? <p className="text-sm leading-6 text-foreground">{result.overview}</p> : null}
      <ol className="flex min-w-0 flex-col gap-3">
        {result.suggestions.map((s, i) => {
          const type = collectionDeckType(s.deckType);
          return (
            <li key={s.commanderId} className="flex min-w-0 gap-3 rounded-lg border border-border bg-surface/40 p-3">
              <div className="w-16 shrink-0 sm:w-20">
                <PrintingPicture imageUrl={s.imageUrl} name={s.name} size="small" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h4 className="min-w-0 font-medium text-foreground">
                    {i + 1}. {s.name}
                  </h4>
                  <ColorPips colors={pipsOf(s.colorIdentity)} label={`Colours: ${s.colorIdentity.join(", ") || "colourless"}`} />
                  {type ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{type.label}</span>
                  ) : null}
                </div>
                {s.pitch ? (
                  <p className="text-sm leading-6 text-foreground">
                    <span className="text-muted">The deck: </span>
                    {s.pitch}
                  </p>
                ) : null}
                {s.why ? (
                  <p className="text-sm leading-6 text-foreground">
                    <span className="text-muted">Why your cards: </span>
                    {s.why}
                  </p>
                ) : null}
                <p className="text-xs leading-5 text-muted">{describeSupport(s.support)}</p>
                {s.keyCards.length > 0 ? (
                  <p className="text-xs leading-5 text-foreground">
                    <span className="text-muted">Key cards you own: </span>
                    {s.keyCards.map((k) => k.name).join(", ")}
                  </p>
                ) : null}
                {s.gaps ? <p className="text-xs leading-5 text-ember">Short of: {s.gaps}</p> : null}
                <div>
                  <Button size="sm" variant="secondary" onClick={() => onBuild(s)}>
                    Build this<span className="sr-only">: {s.name}</span>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
