"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field-classes";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { grantInterestedAction, grantToolAccessAction } from "@/lib/tools/admin-actions";
import type { ToolInterested } from "@/lib/tools/admin-queries";
import { formatShortDate } from "@/lib/format/dates";
import { GRANT_LENGTHS, PersonLabel, grantDaysOf } from "./testers-panel";

/** The waiting list ("Notify me"): let one person in, or everyone waiting. */
export function InterestPanel({
  slug,
  toolName,
  interested,
}: {
  slug: string;
  toolName: string;
  interested: ToolInterested[];
}) {
  const router = useRouter();
  const lengthId = useId();
  const [length, setLength] = useState("30");
  const [pending, startTransition] = useTransition();
  const waiting = interested.filter((p) => !p.hasAccess);

  function run(action: () => Promise<{ ok: true; data: { granted: number } } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        adminErrorToast("tool waiting list", result.error);
        return;
      }
      toast.success(
        result.data.granted === 0
          ? "Everyone waiting is already in."
          : `${result.data.granted} ${result.data.granted === 1 ? "person is" : "people are"} in the ${toolName} beta.`,
      );
      router.refresh();
    });
  }

  if (interested.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        Nobody has pressed Notify me yet. The tool&apos;s card on the Tools hub collects them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={lengthId} className="text-xs font-medium text-muted">Access ends</label>
          <select id={lengthId} value={length} onChange={(e) => setLength(e.target.value)} className={inputClass(false)}>
            {GRANT_LENGTHS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          disabled={pending || waiting.length === 0}
          onClick={() => run(() => grantInterestedAction({ slug, expiresInDays: grantDaysOf(length) }))}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UsersRound className="h-4 w-4" aria-hidden />}
          Let all {waiting.length} waiting in
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60">
        {interested.map((person) => (
          <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <PersonLabel person={person} />
            <span className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-subtle sm:inline">Asked {formatShortDate(person.createdAt)}</span>
              {person.hasAccess ? (
                <span className="text-xs text-gold-strong">Tester</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      grantToolAccessAction({
                        slug,
                        userIds: [person.id],
                        expiresInDays: grantDaysOf(length),
                        note: "From the interest list",
                      }),
                    )
                  }
                >
                  Let in<span className="sr-only"> {person.username ?? person.displayName ?? "user"}</span>
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
