"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Hash, Plus, Star, StarOff, TimerOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { inputClass } from "@/components/creator/field-group";
import {
  closeChallengeAction,
  createChallengeAction,
  setChallengeFeaturedAction,
} from "@/lib/challenges/actions";
import { daysLeft, isActive, isUpcoming, type Challenge } from "@/lib/challenges/shared";

// ---------------------------------------------------------------------------
// ChallengeAdmin — the /admin/challenges surface: a create form plus the
// full challenge list with featured/close controls. Server truth flows back
// via router.refresh() after each action (same pattern as custom pips).
// ---------------------------------------------------------------------------

export function ChallengeAdmin({ challenges }: { challenges: Challenge[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  // Tag auto-derives from the title until the admin edits it by hand.
  const [tagTouched, setTagTouched] = useState(false);

  const onCreate = (formData: FormData) => {
    startTransition(async () => {
      const result = await createChallengeAction(formData);
      if (result.ok) {
        toast.success(`Challenge created — /challenges/${result.slug}`);
        formRef.current?.reset();
        setTagTouched(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const onToggleFeatured = (challenge: Challenge) => {
    startTransition(async () => {
      const result = await setChallengeFeaturedAction(
        challenge.id,
        !challenge.featured,
      );
      if (result.ok) {
        toast.success(
          challenge.featured ? "Removed from featured." : "Now featured.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const onClose = (challenge: Challenge) => {
    startTransition(async () => {
      const result = await closeChallengeAction(challenge.id);
      if (result.ok) {
        toast.success("Challenge closed.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mt-10 flex flex-col gap-8">
      {/* Create */}
      <SurfaceCard tone="gold" className="p-6">
        <h2 className="font-display mb-4 text-lg font-semibold text-foreground">
          New challenge
        </h2>
        <form ref={formRef} action={onCreate} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Title
              </span>
              <input
                name="title"
                required
                minLength={3}
                maxLength={120}
                placeholder="Echoes of the Wild"
                className={inputClass(false)}
                autoComplete="off"
                onChange={(e) => {
                  if (tagTouched) return;
                  const tagInput =
                    formRef.current?.elements.namedItem("tag");
                  if (tagInput instanceof HTMLInputElement) {
                    tagInput.value = e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                      .slice(0, 40);
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Submission tag
              </span>
              <input
                name="tag"
                required
                pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]"
                placeholder="echoes-of-the-wild"
                className={inputClass(false)}
                autoComplete="off"
                onChange={() => setTagTouched(true)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Brief
            </span>
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={2000}
              rows={3}
              placeholder="What should creators design? Set the constraint that sparks the idea."
              className={inputClass(false)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Duration (days)
              </span>
              <input
                name="durationDays"
                type="number"
                min={1}
                max={60}
                defaultValue={14}
                className={`${inputClass(false)} w-28`}
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-muted">
              <input type="checkbox" name="featured" defaultChecked />
              Featured (gallery banner)
            </label>
            <Button type="submit" disabled={pending} className="ml-auto">
              <Plus className="h-4 w-4" aria-hidden />
              Create challenge
            </Button>
          </div>
        </form>
      </SurfaceCard>

      {/* List */}
      <div className="flex flex-col gap-3">
        {challenges.map((challenge) => {
          const active = isActive(challenge);
          const upcoming = isUpcoming(challenge);
          return (
            <SurfaceCard
              key={challenge.id}
              className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/challenges/${challenge.slug}`}
                    className="font-display text-base font-semibold text-foreground hover:underline"
                  >
                    {challenge.title}
                  </Link>
                  {active ? (
                    <Badge variant="gold">
                      {daysLeft(challenge)}d left
                    </Badge>
                  ) : upcoming ? (
                    <Badge variant="primary">Upcoming</Badge>
                  ) : (
                    <Badge variant="outline">Closed</Badge>
                  )}
                  {challenge.featured ? (
                    <Badge variant="accent">Featured</Badge>
                  ) : null}
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-subtle">
                  <Hash className="h-3 w-3" aria-hidden />
                  {challenge.tag}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => onToggleFeatured(challenge)}
                >
                  {challenge.featured ? (
                    <>
                      <StarOff className="h-4 w-4" aria-hidden /> Unfeature
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4" aria-hidden /> Feature
                    </>
                  )}
                </Button>
                {active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onClose(challenge)}
                  >
                    <TimerOff className="h-4 w-4" aria-hidden /> Close now
                  </Button>
                ) : null}
              </div>
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}
