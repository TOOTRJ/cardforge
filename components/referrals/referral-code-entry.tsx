"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/ui/local-date";
import { inputClass } from "@/components/ui/field-classes";
import { claimReferralCodeAction } from "@/lib/referrals/claim-actions";

// ---------------------------------------------------------------------------
// "Joined because of a friend?" — a new account types its friend's code (or
// pastes their link) on the Refer a friend page (owner 2026-11-11). Shown
// only while the account is young and has no referral (the page decides);
// the server judges the rest and says, in words, why a code is not taken.
// ---------------------------------------------------------------------------

export function ReferralCodeEntry({ until, friendGets }: { until: string; friendGets: string }) {
  const router = useRouter();
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (pending || !code.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await claimReferralCodeAction({ code });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Your friend's code is added.");
      setCode("");
      router.refresh();
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-3">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary-bright" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Joined because of a friend?</h2>
          <p className="text-sm text-muted">
            Add their referral code or link and you can both earn a reward — {friendGets} for you once your cards are
            saved.
            You can add it until <LocalDate iso={until} />.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          Your friend&apos;s referral code or link
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={id}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={300}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${inputClass(Boolean(error))} min-w-0 flex-1 basis-40 font-mono`}
          />
          <Button type="submit" size="sm" disabled={pending || !code.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Add code
          </Button>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
