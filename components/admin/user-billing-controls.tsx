"use client";

// Admin user billing controls — grant credits, comp a plan, override the
// saved-card cap. Each form calls its server action in a transition and
// router.refresh()es so the server-rendered snapshot above reflects the
// new values immediately.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  adminBillingHealthAction,
  adminGrantCreditsAction,
  adminResyncSubscriptionAction,
  adminSetCardLimitAction,
  adminSetCompTierAction,
  type BillingHealthIssue,
} from "@/lib/admin/user-actions";

const inputClass =
  "h-9 rounded-control border border-border bg-elevated px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">
      {children}
    </span>
  );
}

export function GrantCreditsForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    const parsed = Number(amount);
    if (!Number.isInteger(parsed) || parsed < 1) {
      toast.error("Enter a whole number of credits (1 or more).");
      return;
    }
    startTransition(async () => {
      const result = await adminGrantCreditsAction({
        userId,
        amount: parsed,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Granted ${parsed} credits — new balance ${result.balance}.`);
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <FieldLabel>Amount</FieldLabel>
        <input
          type="number"
          min={1}
          max={10000}
          step={1}
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} w-28`}
          placeholder="25"
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <FieldLabel>Note (optional)</FieldLabel>
        <input
          type="text"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
          placeholder="Why the grant — lands in the ledger reason"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Grant credits
      </Button>
    </form>
  );
}

export function CompTierForm({
  userId,
  compTier,
  compExpiresAt,
}: {
  userId: string;
  compTier: "plus" | "pro" | null;
  compExpiresAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState<"" | "plus" | "pro">(compTier ?? "");
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const [expiry, setExpiry] = useState(
    compExpiresAt ? toLocalInputValue(compExpiresAt) : "",
  );

  function submit() {
    const expiresAt = tier && expiry ? new Date(expiry).toISOString() : null;
    startTransition(async () => {
      const result = await adminSetCompTierAction({
        userId,
        tier: tier === "" ? null : tier,
        expiresAt,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        tier === ""
          ? "Comp cleared."
          : `Comped ${tier === "plus" ? "Plus" : "Pro"}${expiresAt ? " until the set expiry" : ", no expiry"}.`,
      );
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <FieldLabel>Comp tier</FieldLabel>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as "" | "plus" | "pro")}
          className={`${inputClass} w-32`}
        >
          <option value="">None</option>
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Expires (optional)</FieldLabel>
        <input
          type="datetime-local"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          disabled={tier === ""}
          className={`${inputClass} disabled:opacity-50`}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Save comp
      </Button>
    </form>
  );
}

export function CardLimitForm({
  userId,
  cardLimitOverride,
}: {
  userId: string;
  cardLimitOverride: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [limit, setLimit] = useState(
    cardLimitOverride != null ? String(cardLimitOverride) : "",
  );

  function submit(value: number | null) {
    startTransition(async () => {
      const result = await adminSetCardLimitAction({ userId, limit: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        value == null ? "Override cleared — tier cap applies." : `Card cap set to ${value}.`,
      );
      if (value == null) setLimit("");
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = Number(limit);
        if (!Number.isInteger(parsed) || parsed < 1) {
          toast.error("Enter a whole number (1 or more).");
          return;
        }
        submit(parsed);
      }}
    >
      <label className="flex flex-col gap-1">
        <FieldLabel>Saved-card cap</FieldLabel>
        <input
          type="number"
          min={1}
          max={100000}
          step={1}
          required
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className={`${inputClass} w-32`}
          placeholder="500"
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Set override
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending || cardLimitOverride == null}
        onClick={() => submit(null)}
      >
        Clear override
      </Button>
    </form>
  );
}

/** ISO timestamp → "YYYY-MM-DDTHH:mm" in the viewer's local time. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Subscription resync — rewrite the profile from the customer's live Stripe
// state (lib/stripe/subscription-sync.ts, the same code the webhook runs).
// ---------------------------------------------------------------------------

export function ResyncSubscriptionButton({
  userId,
  hasStripeCustomer,
}: {
  userId: string;
  hasStripeCustomer: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await adminResyncSubscriptionAction({ userId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.subscriptionId
          ? `Synced: ${result.tier} · ${result.status}${
              result.unresolvedPrice ? " (price not mapped — kept tier)" : ""
            }`
          : "Synced: no live subscription in Stripe.",
      );
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending || !hasStripeCustomer}
      title={
        hasStripeCustomer
          ? "Rewrite tier/status from the customer's live Stripe subscriptions"
          : "No Stripe customer yet"
      }
      onClick={submit}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden />
      )}
      Resync from Stripe
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Billing health check — on demand (it calls Stripe per customer), lists
// every profile whose tier/status disagrees with its live subscription.
// ---------------------------------------------------------------------------

const PROBLEM_LABEL: Record<BillingHealthIssue["problem"], string> = {
  "active-but-free": "Paying but on the free tier",
  "tier-mismatch": "Tier differs from Stripe",
  "status-mismatch": "Live/lapsed differs from Stripe",
  "unmapped-price": "Price can't be mapped to a tier",
};

export function BillingHealthPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { checked: number; issues: BillingHealthIssue[]; truncated: boolean }
    | null
  >(null);

  function run() {
    startTransition(async () => {
      const outcome = await adminBillingHealthAction();
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setResult({
        checked: outcome.checked,
        issues: outcome.issues,
        truncated: outcome.truncated,
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={run}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ShieldAlert className="h-4 w-4" aria-hidden />
          )}
          Run billing health check
        </Button>
        {result ? (
          <span className="text-xs text-muted">
            Checked {result.checked} Stripe customer{result.checked === 1 ? "" : "s"}
            {result.truncated ? " (newest 100 — rerun after fixing)" : ""} ·{" "}
            {result.issues.length === 0
              ? "no mismatches"
              : `${result.issues.length} mismatch${result.issues.length === 1 ? "" : "es"}`}
          </span>
        ) : null}
      </div>
      {result && result.issues.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/40 rounded-lg border border-danger/40 bg-danger/5">
          {result.issues.map((issue) => (
            <li
              key={issue.userId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <Link
                href={`/admin/users?u=${issue.userId}`}
                className="font-medium text-primary-bright hover:underline"
              >
                {issue.username ? `@${issue.username}` : issue.userId.slice(0, 8)}
              </Link>
              <span className="text-foreground">{PROBLEM_LABEL[issue.problem]}</span>
              <span className="text-xs text-muted">
                profile {issue.profileTier} · {issue.profileStatus ?? "—"} — Stripe{" "}
                {issue.stripeTier ?? "?"} · {issue.stripeStatus ?? "none"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
