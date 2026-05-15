"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Coins,
  Gem,
  Loader2,
  Paintbrush,
  Quote,
  Scale,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import {
  AI_ACTIONS,
  type AIAction,
  type CardAssistantRequest,
  type CardContext,
  type Suggestion,
} from "@/lib/ai/schemas";

// ---------------------------------------------------------------------------
// Props — the suggestion's effects are applied through `onApply` patches so
// the parent form can route each field via setValue(..., { shouldDirty: true }).
// ---------------------------------------------------------------------------

export type CardFieldPatch = {
  title?: string;
  cost?: string;
  card_type?: string;
  supertype?: string;
  subtypes_text?: string;
  rarity?: string;
  color_identity?: readonly string[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
};

type AIAssistantPanelProps = {
  cardContext: CardContext;
  onApply: (patch: CardFieldPatch) => void;
  configured: boolean;
};

// NDJSON stream event shapes — mirrors the encoder in
// lib/ai/card-assistant.ts. The three variants are mutually exclusive,
// but using a single permissive shape keeps the parser tiny.
type StreamEvent =
  | { partial: Record<string, unknown>; action: AIAction }
  | { done: Suggestion }
  | { error: string };

// ---------------------------------------------------------------------------
// Action metadata — label, icon, helper copy shown on the button row.
// ---------------------------------------------------------------------------

type ActionMeta = {
  label: string;
  helper: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const ACTION_META: Record<AIAction, ActionMeta> = {
  improve_wording: {
    label: "Improve wording",
    helper: "Clean up rules text.",
    icon: Wand2,
  },
  suggest_cost: {
    label: "Suggest cost",
    helper: "Mana-style cost for this card.",
    icon: Coins,
  },
  suggest_rarity: {
    label: "Suggest rarity",
    helper: "Common → Mythic, with reasoning.",
    icon: Gem,
  },
  generate_flavor: {
    label: "Generate flavor",
    helper: "Short, evocative flavor text.",
    icon: Quote,
  },
  generate_art_prompt: {
    label: "Art prompt",
    helper: "Prompt for an external image generator.",
    icon: Paintbrush,
  },
  check_balance: {
    label: "Check balance",
    helper: "Honest read on power level.",
    icon: Scale,
  },
  generate_from_concept: {
    label: "From concept",
    helper: "Draft a full card from one sentence.",
    icon: Sparkles,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIAssistantPanel({
  cardContext,
  onApply,
  configured,
}: AIAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  // Which action is currently streaming. Null when idle.
  const [activeAction, setActiveAction] = useState<AIAction | null>(null);
  // In-flight partial object — grows as the model emits tokens. Cleared
  // either on completion (after `suggestion` is set) or on error.
  const [streamingPartial, setStreamingPartial] = useState<
    Record<string, unknown> | null
  >(null);
  // Completed suggestion. Apply / Discard only render once this is set.
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [concept, setConcept] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Abort the in-flight stream when the user starts another action or
  // discards the result mid-stream. Stored in a ref so consecutive
  // clicks don't pile up overlapping streams.
  const abortRef = useRef<AbortController | null>(null);

  const isStreaming = activeAction !== null;

  const runAction = async (action: AIAction) => {
    if (!configured) {
      setError("AI assistant isn't configured on this deployment.");
      return;
    }
    if (action === "generate_from_concept" && concept.trim().length === 0) {
      setError("Give the assistant a concept to riff on.");
      return;
    }

    // Tear down any previous in-flight stream so its partial updates
    // can't bleed into the new run.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setSuggestion(null);
    setStreamingPartial({});
    setActiveAction(action);

    const body: CardAssistantRequest = {
      action,
      card: cardContext,
      concept: action === "generate_from_concept" ? concept.trim() : undefined,
    };

    try {
      const response = await fetch("/api/ai/card-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Pre-stream errors (401 / 429 / 503) are returned as JSON, not
      // NDJSON — the route handler keeps the two channels separate so
      // the client doesn't need to peek at the status before parsing.
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const msg = body?.error ?? "AI request failed.";
        setError(msg);
        toast.error(msg);
        return;
      }

      if (!response.body) {
        setError("AI response had no body.");
        return;
      }

      // Stream loop: read chunks, split on `\n`, parse each line.
      // Partial JSON across chunk boundaries is held in `buffer` and
      // consumed on the next iteration.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The last segment may be a partial line; defer it to the next round.
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            // A malformed line is non-fatal — keep streaming and let the
            // next event recover.
            continue;
          }
          if ("partial" in event && event.partial) {
            setStreamingPartial(event.partial);
          } else if ("done" in event && event.done) {
            setSuggestion(event.done as Suggestion);
            setStreamingPartial(null);
          } else if ("error" in event && event.error) {
            setError(event.error);
            toast.error(event.error);
            setStreamingPartial(null);
          }
        }
      }
    } catch (err) {
      // AbortError fires when the user kicks off a new action mid-stream
      // or unmounts the form. Either way it's a user-driven cancel — no
      // need to surface a toast.
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "AI request failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      // Only clear if we're still the controlling controller — a follow-up
      // runAction call would have replaced abortRef.current already.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setActiveAction(null);
      }
    }
  };

  const discard = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSuggestion(null);
    setStreamingPartial(null);
    setActiveAction(null);
    setError(null);
  };

  return (
    <SurfaceCard className="flex flex-col gap-4 border-primary/30 bg-linear-to-br from-primary/[0.04] to-transparent p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-primary">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="font-display text-sm font-semibold tracking-wide text-foreground">
              Forge AI
            </span>
            <span className="text-xs text-muted">
              Suggestions never overwrite your fields without an explicit apply.
            </span>
          </div>
        </div>
        <Badge variant={configured ? "primary" : "outline"}>
          {open ? "Hide" : configured ? "AI ready" : "Not configured"}
        </Badge>
      </button>

      {open ? (
        <>
          {!configured ? (
            <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground">
              The AI assistant is off because{" "}
              <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>{" "}
              isn&apos;t set. Add it to <code className="font-mono text-xs">.env.local</code>{" "}
              to enable these buttons.
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {AI_ACTIONS.map((action) => {
              const meta = ACTION_META[action];
              const Icon = meta.icon;
              const busy = activeAction === action;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => runAction(action)}
                  disabled={!configured || isStreaming}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border bg-background/40 p-3 text-left transition-colors",
                    "hover:border-border-strong hover:bg-elevated",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    busy && "border-primary/60",
                  )}
                  aria-busy={busy}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="h-4 w-4 text-primary" aria-hidden />
                    )}
                    {meta.label}
                  </span>
                  <span className="text-xs leading-5 text-muted">{meta.helper}</span>
                </button>
              );
            })}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Concept (for &quot;From concept&quot;)
            </span>
            <textarea
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
              rows={2}
              placeholder="A storm-fearing siren who heals her allies but takes damage from rain."
              className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              disabled={!configured || isStreaming}
            />
          </label>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          {/* While streaming, show a progressive preview of whatever fields
              the model has emitted so far. Apply is disabled until the
              `done` event lands and `suggestion` is set. */}
          {streamingPartial && activeAction ? (
            <StreamingSuggestionPreview
              action={activeAction}
              partial={streamingPartial}
              onCancel={discard}
            />
          ) : null}

          {suggestion ? (
            <SuggestionCard
              suggestion={suggestion}
              onApply={onApply}
              onDiscard={discard}
            />
          ) : null}
        </>
      ) : null}
    </SurfaceCard>
  );
}

// ---------------------------------------------------------------------------
// Suggestion preview + apply controls
// ---------------------------------------------------------------------------

function SuggestionCard({
  suggestion,
  onApply,
  onDiscard,
}: {
  suggestion: Suggestion;
  onApply: (patch: CardFieldPatch) => void;
  onDiscard: () => void;
}) {
  const meta = ACTION_META[suggestion.action];
  const Icon = meta.icon;

  return (
    <SurfaceCard className="flex flex-col gap-3 border-primary/40 bg-background/60 p-4">
      <header className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          {meta.label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          aria-label="Discard suggestion"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Discard
        </Button>
      </header>
      <SuggestionBody suggestion={suggestion} onApply={onApply} />
    </SurfaceCard>
  );
}

function SuggestionBody({
  suggestion,
  onApply,
}: {
  suggestion: Suggestion;
  onApply: (patch: CardFieldPatch) => void;
}) {
  const applyButton = (
    label: string,
    patch: CardFieldPatch,
    afterApply?: () => void,
  ) => (
    <Button
      type="button"
      size="sm"
      onClick={() => {
        onApply(patch);
        toast.success("Applied to card.");
        afterApply?.();
      }}
    >
      <Check className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );

  const copyButton = (text: string) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Copied to clipboard.");
        } catch {
          toast.error("Could not copy — try selecting + Cmd/Ctrl+C.");
        }
      }}
    >
      <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
      Copy
    </Button>
  );

  switch (suggestion.action) {
    case "improve_wording": {
      const { rules_text, reasoning } = suggestion.data;
      return (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-line rounded-md border border-border/60 bg-surface/60 p-3 text-sm text-foreground">
            {rules_text}
          </p>
          <p className="text-xs italic leading-5 text-muted">{reasoning}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {copyButton(rules_text)}
            {applyButton("Apply to rules text", { rules_text })}
          </div>
        </div>
      );
    }

    case "suggest_cost": {
      const { cost, reasoning } = suggestion.data;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-border/60 bg-elevated px-3 py-1 font-mono text-sm text-foreground">
              {cost}
            </span>
          </div>
          <p className="text-xs italic leading-5 text-muted">{reasoning}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {copyButton(cost)}
            {applyButton("Apply cost", { cost })}
          </div>
        </div>
      );
    }

    case "suggest_rarity": {
      const { rarity, reasoning } = suggestion.data;
      return (
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-elevated px-3 py-1 text-sm font-medium capitalize text-foreground">
            {rarity}
          </span>
          <p className="text-xs italic leading-5 text-muted">{reasoning}</p>
          <div className="flex justify-end">
            {applyButton(`Apply ${rarity}`, { rarity })}
          </div>
        </div>
      );
    }

    case "generate_flavor": {
      const { flavor_text } = suggestion.data;
      return (
        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-border/60 bg-surface/60 p-3 text-sm italic leading-6 text-muted">
            {flavor_text}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {copyButton(flavor_text)}
            {applyButton("Apply to flavor text", { flavor_text })}
          </div>
        </div>
      );
    }

    case "generate_art_prompt": {
      const { art_prompt } = suggestion.data;
      return (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-line rounded-md border border-border/60 bg-surface/60 p-3 text-xs leading-5 text-foreground">
            {art_prompt}
          </p>
          <p className="text-xs text-muted">
            Paste this into your favorite image generator. Spellwright doesn&apos;t
            generate images itself.
          </p>
          <div className="flex justify-end">{copyButton(art_prompt)}</div>
        </div>
      );
    }

    case "check_balance": {
      const { risk_level, summary, concerns, suggestions } = suggestion.data;
      const riskTone =
        risk_level === "high"
          ? "bg-danger/15 text-danger border-danger/40"
          : risk_level === "medium"
            ? "bg-accent/15 text-accent border-accent/40"
            : "bg-primary/15 text-primary border-primary/30";
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider",
                riskTone,
              )}
            >
              {risk_level} risk
            </span>
            <p className="text-sm text-foreground">{summary}</p>
          </div>
          {concerns.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Concerns
              </span>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {concerns.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Suggestions
              </span>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-subtle">
            This panel is read-only — apply nothing automatically.
          </p>
        </div>
      );
    }

    case "generate_from_concept": {
      const draft = suggestion.data;
      const fullPatch: CardFieldPatch = {
        title: draft.title,
        cost: draft.cost ?? "",
        card_type: draft.card_type,
        supertype: draft.supertype ?? "",
        subtypes_text: draft.subtypes.join(", "),
        rarity: draft.rarity,
        color_identity: draft.color_identity,
        rules_text: draft.rules_text,
        flavor_text: draft.flavor_text ?? "",
        power: draft.power ?? "",
        toughness: draft.toughness ?? "",
      };

      return (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <DraftRow label="Title" value={draft.title} />
            <DraftRow label="Cost" value={draft.cost ?? "—"} mono />
            <DraftRow label="Type" value={draft.card_type} />
            {draft.supertype ? (
              <DraftRow label="Supertype" value={draft.supertype} />
            ) : null}
            {draft.subtypes.length > 0 ? (
              <DraftRow label="Subtypes" value={draft.subtypes.join(", ")} />
            ) : null}
            <DraftRow label="Rarity" value={draft.rarity} />
            <DraftRow
              label="Color identity"
              value={
                draft.color_identity.length > 0
                  ? draft.color_identity.join(", ")
                  : "—"
              }
            />
            {draft.power || draft.toughness ? (
              <DraftRow
                label="P / T"
                value={`${draft.power ?? "—"} / ${draft.toughness ?? "—"}`}
              />
            ) : null}
          </dl>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Rules text
            </span>
            <p className="whitespace-pre-line rounded-md border border-border/60 bg-surface/60 p-3 text-sm text-foreground">
              {draft.rules_text}
            </p>
          </div>
          {draft.flavor_text ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Flavor text
              </span>
              <p className="rounded-md border border-border/60 bg-surface/60 p-3 text-sm italic leading-6 text-muted">
                {draft.flavor_text}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            Applying replaces every field above on your card. Anything you don&apos;t
            want, edit afterward.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {applyButton("Replace card with this draft", fullPatch)}
          </div>
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// StreamingSuggestionPreview — shown while the model is still emitting
// tokens. Renders whatever scalar / array fields are present on the
// partial in a stable visual order, with Apply intentionally absent.
// ---------------------------------------------------------------------------

function StreamingSuggestionPreview({
  action,
  partial,
  onCancel,
}: {
  action: AIAction;
  partial: Record<string, unknown>;
  onCancel: () => void;
}) {
  const meta = ACTION_META[action];
  const Icon = meta.icon;

  // Only show fields that have actual visible content. A partial may
  // include `key: undefined` mid-stream as the schema starts populating —
  // hiding empties keeps the layout from flashing entries that vanish.
  const visible = Object.entries(partial).filter(([, value]) => {
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null;
  });

  return (
    <SurfaceCard className="flex flex-col gap-3 border-primary/40 bg-background/60 p-4">
      <header className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          {meta.label}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="primary" className="gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Streaming
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Cancel
          </Button>
        </div>
      </header>
      <div className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <p className="text-xs text-subtle">Waiting for the first token…</p>
        ) : (
          visible.map(([key, value]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-subtle">
                {key.replace(/_/g, " ")}
              </span>
              <span className="whitespace-pre-line text-sm leading-6 text-foreground/90">
                {typeof value === "string"
                  ? value
                  : Array.isArray(value)
                    ? value.filter(Boolean).join(", ")
                    : String(value)}
              </span>
            </div>
          ))
        )}
      </div>
      <p className="text-[11px] italic text-subtle">
        Apply will appear once the model finishes.
      </p>
    </SurfaceCard>
  );
}

function DraftRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span
        className={cn(
          "truncate text-sm capitalize text-foreground",
          mono ? "font-mono normal-case" : "",
        )}
      >
        {value}
      </span>
    </div>
  );
}
