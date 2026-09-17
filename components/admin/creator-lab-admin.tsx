"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { setCreatorLabModeAction } from "@/lib/creator/lab-actions";
import {
  CREATOR_LAB_MODES,
  CREATOR_LAB_MODE_LABELS,
  type CreatorLabMode,
} from "@/lib/creator/lab-shared";
import { cn } from "@/lib/utils";

export function CreatorLabAdmin({ mode: initial }: { mode: CreatorLabMode }) {
  const [mode, setMode] = useState<CreatorLabMode>(initial);
  const [pending, startTransition] = useTransition();

  const choose = (next: CreatorLabMode) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const result = await setCreatorLabModeAction(next);
      if (!result.ok) {
        setMode(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`Creator lab: ${CREATOR_LAB_MODE_LABELS[next]}.`);
    });
  };

  return (
    <SurfaceCard className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <FlaskConical className="h-4 w-4 text-accent" aria-hidden />
          Canvas creator (click-to-edit live preview)
        </span>
        <p className="text-sm leading-6 text-muted">
          A second create walkthrough: the live card sits in the middle of
          the page and clicking a region — title, art, rules, stats, set
          icon — opens that field. Same form, same save rules, same AI.
          The current stepper is untouched; this only decides who is
          offered the switch.
        </p>
      </div>
      <div role="radiogroup" aria-label="Who can use the canvas creator" className="flex flex-col gap-2">
        {CREATOR_LAB_MODES.map((option) => (
          <label
            key={option}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
              mode === option
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-elevated/30 text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="creator-lab-mode"
              value={option}
              checked={mode === option}
              onChange={() => choose(option)}
              disabled={pending}
              className="accent-[var(--color-primary)]"
            />
            {CREATOR_LAB_MODE_LABELS[option]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm" disabled={mode === "off"}>
          <Link href="/create?lab=1">Open the canvas creator</Link>
        </Button>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
        ) : null}
        <span className="text-xs text-subtle">
          With &ldquo;Admins only&rdquo;, the switch appears on /create for
          admin accounts; nobody else sees a thing.
        </span>
      </div>
    </SurfaceCard>
  );
}
