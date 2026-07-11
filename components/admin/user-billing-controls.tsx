"use client";

// Admin user billing controls — grant credits, comp a plan, override the
// saved-card cap. Each form calls its server action in a transition and
// router.refresh()es so the server-rendered snapshot above reflects the
// new values immediately.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  adminGrantCreditsAction,
  adminSetCardLimitAction,
  adminSetCompTierAction,
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
