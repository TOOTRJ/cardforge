"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/creator/field-group";
import { setChallengeWinnersAction } from "@/lib/challenges/actions";
import { WINNER_PLACES, placeLabel } from "@/lib/challenges/winners-shared";

// ---------------------------------------------------------------------------
// The winners picker of ONE closed challenge (TODO NV12, migration 0172):
// three places, each a choice among the challenge's public entries — most
// liked first, the likes in every option, so the admin decides with them in
// view. Save sends all three (set_challenge_winners); a newly named maker is
// notified by the database.
// ---------------------------------------------------------------------------

export type WinnerEntryOption = {
  id: string;
  title: string;
  ownerUsername: string | null;
  likes: number;
  /** A winner today whose card is no longer a public entry (gone private,
   *  lost the tag) or past the list's length: listed so the picker SHOWS it
   *  and can clear it — never a choice for an empty place. */
  stale?: boolean;
};

export function ChallengeWinnersEditor({
  challengeId,
  entries,
  initial,
}: {
  challengeId: string;
  entries: WinnerEntryOption[];
  /** The card in 1st, 2nd and 3rd place today (null = empty). */
  initial: [string | null, string | null, string | null];
}) {
  const router = useRouter();
  const baseId = useId();
  const [places, setPlaces] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = places.some((id, i) => id !== initial[i]);

  if (entries.length === 0 && !initial.some(Boolean)) {
    return (
      <p className="text-sm text-muted">
        No public entries — there is no one to name.
      </p>
    );
  }

  const pick = (index: number, id: string | null) => {
    setError(null);
    setPlaces((current) => {
      const next = [...current] as typeof current;
      // A card takes one place: picking it here empties the place it held.
      for (let i = 0; i < next.length; i++)
        if (id && next[i] === id) next[i] = null;
      next[index] = id;
      return next;
    });
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await setChallengeWinnersAction(challengeId, places);
      if (result.ok) {
        toast.success("Winners saved.");
        router.refresh();
      } else {
        setError(result.error);
        adminErrorToast("challenges", result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {WINNER_PLACES.map((place, index) => {
          const id = `${baseId}-${place}`;
          return (
            <label
              key={place}
              htmlFor={id}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {placeLabel(place)}
              </span>
              <select
                id={id}
                value={places[index] ?? ""}
                onChange={(e) => pick(index, e.target.value || null)}
                className={inputClass(false)}
                disabled={pending}
              >
                <option value="">— None —</option>
                {entries.map((entry) =>
                  // A stale winner is offered only where it stands today.
                  entry.stale && places[index] !== entry.id ? null : (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                      {entry.ownerUsername ? ` · @${entry.ownerUsername}` : ""}
                      {entry.stale
                        ? " · no longer an entry"
                        : ` · ${entry.likes} like${entry.likes === 1 ? "" : "s"}`}
                    </option>
                  ),
                )}
              </select>
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">
          Entries are sorted by likes. Each newly named maker gets a
          notification.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={pending || !changed}
        >
          <Trophy className="h-4 w-4" aria-hidden />
          Save winners
        </Button>
      </div>
    </div>
  );
}
