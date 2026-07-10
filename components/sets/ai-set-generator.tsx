"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FieldGroup, inputClass } from "@/components/creator/field-group";

// ---------------------------------------------------------------------------
// AiSetGenerator — "Generate a set with AI" panel. Two homes:
//   - /dashboard/sets (no setId): plans a brand-new private set
//   - /set/[slug]/edit (setId): generates cards INTO that set
//
// Drives the client-stepped job pipeline: POST /api/ai/jobs plans the whole
// set's text in one cohesive batch, then the panel advances one step per
// request (a card's creation + art, or the set icon) with live progress.
// Card count is capped server-side (3/generation until subscriptions;
// admins exempt) — maxCards mirrors that cap in the UI.
// ---------------------------------------------------------------------------

const STYLE_PRESETS = [
  "Anime",
  "Pixel art",
  "Oil painting",
  "Watercolor",
  "Comic book",
  "Dark fantasy",
];

type JobStep = {
  key: string;
  label: string;
  status: "pending" | "done" | "failed";
  error?: string;
};

type JobPayload = {
  id: string;
  status: "generating" | "done" | "failed" | "cancelled";
  steps: JobStep[];
};

export function AiSetGenerator({
  aiConfigured,
  maxCards,
  setId,
}: {
  aiConfigured: boolean;
  /** Per-generation card cap for this user (3, or higher for admins). */
  maxCards: number;
  /** Present on a set's edit page — generate into that set. */
  setId?: string;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [size, setSize] = useState(Math.min(3, maxCards));
  const [phase, setPhase] = useState<"idle" | "planning" | "stepping" | "done">(
    "idle",
  );
  const [steps, setSteps] = useState<JobStep[]>([]);
  const busy = phase === "planning" || phase === "stepping";

  const runJob = async () => {
    setPhase("planning");
    setSteps([]);
    try {
      const planResponse = await fetch("/api/ai/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "set",
          theme: theme.trim() || undefined,
          style: style.trim() || undefined,
          size,
          set_id: setId,
        }),
      });
      const planPayload = await planResponse.json().catch(() => null);
      if (!planResponse.ok || !planPayload?.ok) {
        toast.error(planPayload?.error ?? "Set planning failed. Try again.");
        setPhase("idle");
        return;
      }

      let job: JobPayload = planPayload.job;
      const setSlug: string = planPayload.setSlug;
      setSteps(job.steps);
      setPhase("stepping");

      // Advance one step per request until nothing is pending. A failed
      // step is recorded and skipped — the user can retry from the list.
      while (job.status === "generating" && job.steps.some((s) => s.status === "pending")) {
        const stepResponse = await fetch(`/api/ai/jobs/${job.id}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const stepPayload = await stepResponse.json().catch(() => null);
        if (!stepResponse.ok || !stepPayload?.ok) {
          toast.error(stepPayload?.error ?? "Generation step failed.");
          break;
        }
        job = stepPayload.job;
        setSteps(job.steps);
      }

      const failures = job.steps.filter((s) => s.status === "failed").length;
      const successes = job.steps.filter((s) => s.status === "done").length;
      setPhase("done");
      if (successes > 0) {
        toast.success(
          failures > 0
            ? `Set generated with ${failures} failed step${failures === 1 ? "" : "s"} — you can retry them below.`
            : "Set generated — every card is a private draft you can polish and publish.",
        );
        if (setId) {
          router.refresh();
        } else if (setSlug) {
          router.push(`/set/${setSlug}/edit`);
        }
      } else {
        toast.error("Generation didn't produce any cards. Try again.");
      }
    } catch {
      toast.error("Network error during generation.");
      setPhase("idle");
    }
  };

  if (!aiConfigured) return null;

  return (
    <SurfaceCard className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          {setId ? "Generate cards into this set" : "Generate a set with AI"}
        </h2>
        <p className="text-sm leading-6 text-muted">
          AI plans a cohesive mini-set — balanced rarities, matching art
          {setId ? "" : ", a set icon,"} and one shared world — as private
          drafts you can edit before publishing.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup label="Theme" helper="The set's world or story.">
          <input
            type="text"
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            maxLength={300}
            placeholder="e.g. deep-sea clockwork empire"
            className={inputClass(false)}
            disabled={busy}
          />
        </FieldGroup>
        <FieldGroup label="Cards" helper={`Up to ${maxCards} per generation.`}>
          <select
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className={inputClass(false)}
            disabled={busy}
          >
            {Array.from({ length: maxCards }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} card{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </FieldGroup>
      </div>

      <FieldGroup label="Art style" helper="Applied to every card's art.">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STYLE_PRESETS.map((preset) => {
              const active = style.toLowerCase() === preset.toLowerCase();
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={busy}
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
            placeholder="e.g. stained glass"
            className={inputClass(false)}
            disabled={busy}
          />
        </div>
      </FieldGroup>

      {steps.length > 0 ? (
        <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-3">
          {steps.map((step) => (
            <li
              key={step.key}
              className="flex items-center gap-2 text-sm text-muted"
            >
              {step.status === "done" ? (
                <Check className="h-3.5 w-3.5 text-primary-bright" aria-hidden />
              ) : step.status === "failed" ? (
                <TriangleAlert className="h-3.5 w-3.5 text-danger" aria-hidden />
              ) : phase === "stepping" &&
                steps.find((s) => s.status === "pending")?.key === step.key ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-accent"
                  aria-hidden
                />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-border" />
              )}
              <span
                className={
                  step.status === "done" ? "text-foreground" : undefined
                }
              >
                {step.label}
              </span>
              {step.status === "failed" && step.error ? (
                <span className="truncate text-xs text-danger">
                  {step.error}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted">
          1 credit per card · cards land as private drafts
        </span>
        <Button type="button" onClick={runJob} disabled={busy}>
          {phase === "planning" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Designing set…
            </>
          ) : phase === "stepping" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Painting cards…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate set
            </>
          )}
        </Button>
      </div>
    </SurfaceCard>
  );
}
