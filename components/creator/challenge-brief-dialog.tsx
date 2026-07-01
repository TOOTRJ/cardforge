"use client";

// "view the brief" on the creator's challenge banner opens the challenge rules
// in a modal instead of navigating away from the half-finished card. Links out
// to the full challenge page for the leaderboard + entries.

import Link from "next/link";
import { CalendarClock, Trophy } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { daysLeft, type Challenge } from "@/lib/challenges/shared";

export function ChallengeBriefDialog({ challenge }: { challenge: Challenge }) {
  const remaining = daysLeft(challenge);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-primary-bright underline-offset-2 hover:underline"
        >
          view the brief
        </button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-gold-strong" aria-hidden />
            {challenge.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {remaining} day{remaining === 1 ? "" : "s"} left
            </span>
            <code className="rounded bg-elevated/70 px-1 py-0.5 font-mono text-[11px] text-foreground">
              {challenge.tag}
            </code>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-2 text-sm leading-6 text-muted">
          <p className="whitespace-pre-line">{challenge.description}</p>
        </div>
        <DialogFooter className="px-5 pb-5 pt-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </DialogClose>
          <Button asChild>
            <Link href={`/challenges/${challenge.slug}`}>
              Open challenge page
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
