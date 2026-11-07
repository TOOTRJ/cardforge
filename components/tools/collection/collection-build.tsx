"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Crown, Hammer, Minus, Plus, Sparkles, Undo2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass } from "@/components/ui/field-classes";
import { ChipGroup } from "@/components/ui/chip-group";
import { ColorPips } from "@/components/cards/color-pip";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { cn } from "@/lib/utils";
import type { Visibility } from "@/types/card";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import { draftCollectionDeckAction, saveCollectionDeckAction } from "@/lib/tools/collection/actions";
import {
  ROLE_LABELS,
  ROLE_ORDER,
  ROLE_TARGETS,
  type CommanderDraft,
  type DeckRole,
  type DraftBasic,
} from "@/lib/tools/collection/builder";
import { COMMANDER_DECK_SIZE } from "@/lib/tools/collection/limits";
import { collectionViewHref } from "@/lib/tools/collection/views";
import { PrintingPicture } from "./printing-tile";

const n = (value: number) => value.toLocaleString("en-US");
type Pip = "W" | "U" | "B" | "R" | "G" | "C";
const pipsOf = (identity: readonly string[]): Pip[] =>
  identity.length === 0 ? ["C"] : (identity.filter((c) => "WUBRG".includes(c)) as Pip[]);

type DraftSource = "rules" | "ai";

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

export function CollectionBuild({
  commanders,
  initialCommanderId,
  credits,
  aiAvailable,
  collectionSize,
}: {
  commanders: CollectionCard[];
  initialCommanderId: string | null;
  credits: number | null;
  aiAvailable: boolean;
  collectionSize: number;
}) {
  const legal = commanders.filter((c) => c.commanderLegal);
  const [commanderId, setCommanderId] = useState<string | null>(
    legal.find((c) => c.id === initialCommanderId)?.id ?? null,
  );
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<CommanderDraft | null>(null);
  const [source, setSource] = useState<DraftSource>("rules");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(credits);
  const [working, setWorking] = useState<DraftSource | null>(null);
  const ids = { filter: useId(), legend: useId() };
  useLeaveWarning(working === "ai");

  if (collectionSize === 0 || commanders.length === 0) {
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
  const shown = filter.trim()
    ? commanders.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : commanders;

  const draftWithRules = async () => {
    if (!commanderId) return;
    setWorking("rules");
    setError(null);
    try {
      const result = await draftCollectionDeckAction({ commanderId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(result.draft);
      setSource("rules");
      setTruncated(result.truncated);
    } catch {
      setError("The draft didn't finish. Try again.");
    } finally {
      setWorking(null);
    }
  };

  const draftWithAi = async () => {
    if (!commanderId) return;
    setWorking("ai");
    setError(null);
    try {
      const response = await fetch("/api/tools/collection-builder/ai-build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commanderId }),
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
      setDraft(body.draft);
      setSource("ai");
      setTruncated(Boolean(body.truncated));
    } catch {
      setError("The AI build didn't answer. If a credit was taken it comes back by itself.");
    } finally {
      setWorking(null);
    }
  };

  const aiOff = !aiAvailable
    ? "AI isn't available right now."
    : balance !== null && balance < 1
      ? "You're out of AI credits."
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby={ids.legend} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={ids.legend} className="font-display text-xl font-semibold text-foreground">
              Pick your commander
            </h2>
            <p className="text-sm text-muted">
              {n(legal.length)} commander{legal.length === 1 ? "" : "s"} in your collection. The deck is drafted from cards
              you own in its colours.
            </p>
          </div>
          {commanders.length > 8 ? (
            <div className="flex w-full min-w-0 flex-col gap-1 sm:w-64">
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
        </div>

        <fieldset className="min-w-0">
          <legend className="sr-only">Commander</legend>
          <div className="@container">
            <div className="grid grid-cols-3 gap-3 @xl:grid-cols-4 @3xl:grid-cols-6 @5xl:grid-cols-8">
              {shown.map((card) => {
                const off = !card.commanderLegal;
                const active = card.id === commanderId;
                return (
                  <label
                    key={card.id}
                    className={cn(
                      "group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg p-1",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-bright/60",
                      active && "bg-primary/15 ring-2 ring-primary",
                      off && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="commander"
                      value={card.id}
                      checked={active}
                      // Reachable, its reason in its name; never picked.
                      aria-disabled={off || undefined}
                      aria-label={off ? `${card.name} (not legal in Commander)` : card.name}
                      onChange={() => {
                        if (off) return;
                        setCommanderId(card.id);
                        setDraft(null);
                        setError(null);
                      }}
                      className="sr-only"
                    />
                    <PrintingPicture imageUrl={card.imageUrl} name={card.name} size="small" />
                    <span className="truncate text-xs font-medium text-foreground">{card.name}</span>
                    {off ? <span className="text-[11px] leading-4 text-subtle">Not legal in Commander</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
          {shown.length === 0 ? <p className="text-sm text-muted">No commander is called that.</p> : null}
        </fieldset>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {commander ? (
              <>
                <ColorPips colors={pipsOf(commander.colorIdentity)} label={`Colours: ${commander.colorIdentity.join(", ") || "colourless"}`} />
                <p className="min-w-0 truncate text-sm text-foreground">
                  <span className="text-muted">Commander:</span> {commander.name}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Pick a commander above.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={draftWithRules} disabled={!commander || working !== null}>
              <Hammer aria-hidden />
              {working === "rules" ? "Drafting…" : draft ? "Draft again" : "Draft a deck"}
            </Button>
            <Button
              onClick={aiOff ? undefined : draftWithAi}
              disabled={!commander || working !== null}
              aria-disabled={aiOff ? true : undefined}
              aria-describedby={aiOff ? `${ids.legend}-ai-off` : undefined}
              className={aiOff ? "opacity-50" : undefined}
            >
              <Sparkles aria-hidden />
              {working === "ai" ? "Building with AI…" : "Build with AI · 1 credit"}
            </Button>
          </div>
        </div>
        <p className="-mt-2 text-xs text-subtle">
          &ldquo;Draft a deck&rdquo; is free and follows the rules. &ldquo;Build with AI&rdquo; reads your cards and plans around
          your commander{balance !== null ? ` — you have ${n(balance)} credit${balance === 1 ? "" : "s"}` : ""}.
          {aiOff ? <span id={`${ids.legend}-ai-off`}> {aiOff}</span> : null}
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
      </section>

      {draft ? (
        <DraftReview key={`${draft.commander.cardId}-${source}-${draft.total}-${draft.picks.length}`} draft={draft} source={source} truncated={truncated} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

function DraftReview({ draft, source, truncated }: { draft: CommanderDraft; source: DraftSource; truncated: boolean }) {
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
      toast.success(`${result.title} is saved as a deck.`);
    });
  };

  const maxCurve = Math.max(1, ...draft.curve);

  return (
    <section aria-labelledby={ids.heading} className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={ids.heading} className="font-display text-xl font-semibold text-foreground">
            Your draft
          </h2>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            {source === "ai" ? "Built with AI" : "Drafted by the rules"}
          </span>
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
