"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PauseCircle, PlayCircle, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { setToolPausedAction, setToolReleaseAction } from "@/lib/tools/admin-actions";
import type { PlanTier } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

type Choice = "beta" | PlanTier;

const CHOICES: { value: Choice; title: string; who: string }[] = [
  { value: "beta", title: "Beta", who: "Admins and the testers below" },
  { value: "pro", title: "Pro", who: "Pro subscribers, plus testers" },
  { value: "plus", title: "Plus and Pro", who: "Every paid plan, plus testers" },
  { value: "free", title: "Everyone", who: "Every signed-in account" },
];

/**
 * Who a tool is open to: Beta → Pro → Plus and Pro → Everyone, one radio
 * group, saved through a confirm (a release reaches real users at once),
 * and the pause switch beside it. An unbuilt tool can't be released.
 */
export function ReleaseControls({
  slug,
  toolName,
  built,
  releaseTier,
  paused,
}: {
  slug: string;
  toolName: string;
  built: boolean;
  releaseTier: PlanTier | null;
  paused: boolean;
}) {
  const router = useRouter();
  const current: Choice = releaseTier ?? "beta";
  const [choice, setChoice] = useState<Choice>(current);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const target = CHOICES.find((c) => c.value === choice)!;
  const changed = choice !== current;

  function save() {
    startTransition(async () => {
      const result = await setToolReleaseAction(slug, choice === "beta" ? null : choice);
      setConfirming(false);
      if (!result.ok) {
        adminErrorToast("tool release", result.error);
        setChoice(current);
        return;
      }
      toast.success(choice === "beta" ? `${toolName} is back in beta.` : `${toolName} is open to ${target.title}.`);
      router.refresh();
    });
  }

  function togglePause() {
    startTransition(async () => {
      const result = await setToolPausedAction(slug, !paused);
      if (!result.ok) {
        adminErrorToast("tool pause", result.error);
        return;
      }
      toast.success(paused ? `${toolName} is running again.` : `${toolName} is paused: admins only.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-foreground">Who can open it</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {CHOICES.map((c) => {
            const off = !built && c.value !== "beta";
            const selected = choice === c.value;
            return (
              <label
                key={c.value}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-bright/60",
                  selected ? "border-gold/60 bg-gold/10" : "border-border hover:border-border-strong",
                  off && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name={`release-${slug}`}
                  value={c.value}
                  checked={selected}
                  disabled={off}
                  onChange={() => setChoice(c.value)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
                  {c.title}
                  {c.value === current ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-strong">Now</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted">{c.who}</span>
              </label>
            );
          })}
        </div>
        {!built ? (
          <p className="text-xs text-subtle">
            Not built yet — it stays in beta until its page ships. You can enrol testers now; they&apos;re told it
            opens on their Tools page.
          </p>
        ) : null}
        {changed ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={() => setConfirming(true)}>
              <Rocket className="h-4 w-4" aria-hidden />
              {choice === "beta" ? "Move back to beta" : `Release to ${target.title}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChoice(current)}>
              Cancel
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
          paused ? "border-danger/40 bg-danger/5" : "border-border/70",
        )}
      >
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{paused ? "Paused" : "Kill switch"}</p>
          <p className="text-xs text-muted">
            {paused
              ? "Only admins can open it. Testers and plans keep their access for when you resume."
              : "Pause closes the tool to everyone but admins, at once, without losing who has access."}
          </p>
        </div>
        <Button type="button" size="sm" variant={paused ? "primary" : "outline"} onClick={togglePause} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : paused ? (
            <PlayCircle className="h-4 w-4" aria-hidden />
          ) : (
            <PauseCircle className="h-4 w-4" aria-hidden />
          )}
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {choice === "beta" ? `Move ${toolName} back to beta?` : `Release ${toolName} to ${target.title}?`}
            </DialogTitle>
            <DialogDescription>
              {choice === "beta"
                ? "Only admins and testers will be able to open it. Everyone else loses access straight away."
                : `${target.who} can open it straight away, and it shows on their Tools page.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {choice === "beta" ? "Move to beta" : "Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
