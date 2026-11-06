"use client";

// Admin user billing controls — grant credits, bank free days (the comp
// since owner 2026-11-06), staff access with no end, override the
// saved-card cap. Each form calls its server action in a transition and
// router.refresh()es so the server-rendered snapshot above reflects the
// new values immediately.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format/dates";
import { FREE_DAYS_UNIT_DAYS, MAX_FREE_DAYS_EXACT, MIN_ADMIN_BANK_DAYS } from "@/lib/billing/free-days";
import type { BankEntryDetail } from "@/lib/billing/day-bank";
import type { PlanGrantRow } from "@/lib/billing/plan-grants";
import { Button } from "@/components/ui/button";
import {
  adminBankDaysAction,
  adminBillingHealthAction,
  adminGrantCreditsAction,
  adminGrantFreeDaysAction,
  adminResyncSubscriptionAction,
  adminRevokeBankedDaysAction,
  adminRevokeFreeDaysAction,
  adminSetCardLimitAction,
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
  // One idempotency id per fill-in — see adminGrantCreditsAction.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

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
        requestId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Granted ${parsed} credits — new balance ${result.balance}.`);
      setAmount("");
      setNote("");
      // Fresh idempotency id: the NEXT grant must not be deduped against this one.
      setRequestId(crypto.randomUUID());
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

const TIER_NAME = { plus: "Plus", pro: "Pro" } as const;

/**
 * Bank free days (owner 2026-11-06: the comp): a whole number of days, at
 * least MIN_ADMIN_BANK_DAYS, and a note. Tier-less, no credits — the user's
 * first checkout applies the bank as its free period, later ones wait for
 * their "Apply banked days" (a card on file either way).
 */
export function BankDaysForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  // One idempotency id per fill-in — a double submit banks once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  function submit() {
    const parsed = Number(days);
    if (!Number.isInteger(parsed) || parsed < MIN_ADMIN_BANK_DAYS || parsed > MAX_FREE_DAYS_EXACT) {
      toast.error(`Enter a whole number of days from ${MIN_ADMIN_BANK_DAYS} to ${MAX_FREE_DAYS_EXACT}.`);
      return;
    }
    startTransition(async () => {
      const result = await adminBankDaysAction({ userId, days: parsed, note: note.trim() || null, requestId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.created ? `${result.days} free days banked.` : `Already banked (${result.days} days) — nothing added twice.`, {
        description: "They apply at the user's next checkout, or when they press Apply on their billing page.",
      });
      setNote("");
      setRequestId(crypto.randomUUID());
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
        <FieldLabel>Free days</FieldLabel>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_ADMIN_BANK_DAYS}
          max={MAX_FREE_DAYS_EXACT}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className={`${inputClass} w-28`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Note (optional)</FieldLabel>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className={`${inputClass} w-56`}
          placeholder="Why — the user sees it"
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Bank free days
      </Button>
    </form>
  );
}

const BANK_SOURCE_LABEL: Record<BankEntryDetail["source"], string> = {
  signup: "signup",
  referral_friend: "referral (friend)",
  referral_step: "referral (ladder)",
  admin: "admin",
  promo: "promotion",
};
const BANK_STATUS_LABEL: Record<BankEntryDetail["status"], string> = {
  banked: "banked",
  reserved: "reserved (a checkout or an application in flight)",
  applied: "applied",
  revoked: "revoked",
};

/** The user's bank, newest first; a BANKED entry can be taken back. */
export function BankEntriesList({ rows, loadError }: { rows: BankEntryDetail[]; loadError: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revoke(entryId: string, days: number) {
    const reason = window.prompt(`Take back these ${days} banked days? Add a short reason the user will see (optional).`, "");
    if (reason === null) return;
    startTransition(async () => {
      const result = await adminRevokeBankedDaysAction({ entryId, reason: reason.trim() || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.days} banked days revoked.`);
      router.refresh();
    });
  }

  if (loadError) return <p className="text-sm text-danger">The bank couldn&apos;t be read (logged).</p>;
  if (rows.length === 0) return <p className="text-sm text-subtle">Nothing banked yet.</p>;
  const banked = rows.filter((r) => r.status === "banked").reduce((sum, r) => sum + r.days, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground">
        <span className="tabular-nums">{banked}</span> day{banked === 1 ? "" : "s"} banked
      </p>
      <ul className="flex flex-col divide-y divide-border/50 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground">
                {row.days} day{row.days === 1 ? "" : "s"}
                <span className="text-subtle"> · {BANK_SOURCE_LABEL[row.source] ?? row.source} · {BANK_STATUS_LABEL[row.status] ?? row.status}</span>
              </span>
              <span className="text-xs text-subtle">
                {formatUtcDateTime(row.createdAt)}
                {row.appliedAt ? ` → applied ${formatUtcDateTime(row.appliedAt)}${row.appliedVia === "checkout" ? " at checkout" : row.appliedVia === "plan_hold" ? " to their plan" : ""}` : ""}
                {row.revokedAt ? ` → revoked ${formatUtcDateTime(row.revokedAt)}${row.revokeReason ? ` (${row.revokeReason})` : ""}` : ""}
                {row.note ? ` · ${row.note}` : ""}
              </span>
            </div>
            {row.status === "banked" ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => revoke(row.id, row.days)}>
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Staff access with no end (owner 2026-11-06: the one comp that is not
 * banked days) — an account with no Stripe plan.
 */
export function StaffAccessForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState<"plus" | "pro">("plus");
  const [note, setNote] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await adminGrantFreeDaysAction({ userId, tier, units: null, note: note.trim() || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${TIER_NAME[tier]} with no end date (staff).`, { description: [result.stripeNote, result.warning].filter(Boolean).join(" ") });
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
        <FieldLabel>Plan</FieldLabel>
        <select value={tier} onChange={(e) => setTier(e.target.value as "plus" | "pro")} className={`${inputClass} w-28`}>
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Note (optional)</FieldLabel>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className={`${inputClass} w-56`}
          placeholder="Why — kept with the grant"
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Give staff access (no end)
      </Button>
    </form>
  );
}

const APPLIED_AS_LABEL: Record<PlanGrantRow["appliedAs"], string> = {
  overlay: "perks overlay",
  subscription_hold: "next charge moved",
  below_plan: "below their plan — no change",
};

const SOURCE_LABEL: Record<PlanGrantRow["source"], string> = {
  comp: "comp",
  referral_friend: "referral (friend)",
  referral_referrer: "referral (referrer)",
  promo: "promotion",
  day_bank: "banked days applied",
};

/** The user's free-days grants, newest first; the newest applied one can be
 *  revoked (the ones under it are folded into the overlay's remaining time). */
export function PlanGrantsList({ rows, loadError }: { rows: PlanGrantRow[]; loadError: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const newestApplied = rows.find((row) => row.status === "applied")?.id ?? null;

  function revoke(grantId: string) {
    if (!window.confirm("Revoke these free days? The overlay shrinks by them and a held Stripe trial moves back (it may end — and charge — now).")) return;
    startTransition(async () => {
      const result = await adminRevokeFreeDaysAction({ grantId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Free days revoked.", { description: [result.note, result.warning].filter(Boolean).join(" ") });
      router.refresh();
    });
  }

  if (loadError) return <p className="text-sm text-danger">The grants couldn&apos;t be read (logged).</p>;
  if (rows.length === 0) return <p className="text-sm text-subtle">No free days given yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border/50 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground">
              {row.days != null
                ? `${row.days} day${row.days === 1 ? "" : "s"} of ${TIER_NAME[row.tier]} (banked days)`
                : row.units == null
                  ? `${TIER_NAME[row.tier]}, no end (staff)`
                  : `${row.units * FREE_DAYS_UNIT_DAYS} days of ${TIER_NAME[row.tier]}`}
              <span className="text-subtle"> · {SOURCE_LABEL[row.source]} · {APPLIED_AS_LABEL[row.appliedAs]}</span>
            </span>
            <span className="text-xs text-subtle">
              {formatUtcDateTime(row.startsAt)}
              {row.endsAt ? ` → ${formatUtcDateTime(row.endsAt)}` : ""}
              {row.grantedBy?.username ? ` · by @${row.grantedBy.username}` : ""}
              {row.note ? ` · ${row.note}` : ""}
              {row.status === "failed" && row.stripeError ? ` · ${row.stripeError}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                row.status === "applied"
                  ? "text-xs text-success"
                  : row.status === "failed"
                    ? "text-xs text-danger"
                    : "text-xs text-subtle"
              }
            >
              {row.status}
            </span>
            {row.id === newestApplied ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => revoke(row.id)}>
                Revoke
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
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


// ---------------------------------------------------------------------------
// Subscription resync — rewrite the profile from the customer's live Stripe
// state (lib/stripe/subscription-sync.ts, the same code the webhook runs).
// ---------------------------------------------------------------------------

/** What the resync found — including a pending cancellation, so "Synced"
 *  can never hide that the plan is on its way out. */
export function resyncToast(result: {
  tier: string;
  status: string | null;
  subscriptionId: string | null;
  unresolvedPrice: boolean;
  endsAt: string | null;
}): string {
  if (!result.subscriptionId) return "Synced: no live subscription in Stripe.";
  const ending = result.endsAt
    ? ` · cancelled, ends ${formatUtcDate(result.endsAt)}`
    : "";
  return `Synced: ${result.tier} · ${result.status}${ending}${
    result.unresolvedPrice ? " (price not mapped — kept tier)" : ""
  }`;
}

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
      if (result.nothingFound) {
        // Not "Synced": nothing was read, so nothing was written (normal for
        // a customer who only ever bought credit packs).
        toast("Stripe has no subscription for this customer — the profile was left as it was.");
        router.refresh();
        return;
      }
      toast.success(resyncToast(result));
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
