"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { adminSaveReferralSettingsAction } from "@/lib/admin/referral-settings-actions";
import { rewardPhrase, type ReferralSettings, type RewardSpec } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral program's settings (owner 2026-11-05): ON / OFF, what the
// friend and the referrer get — free 30 days of a tier (lib/billing/free-days.ts),
// AI credits, or nothing — and the caps. Saved whole through
// adminSaveReferralSettingsAction; a confirm step names what changes.
// Rewards already given are untouched (the settings are read at grant time).
// ---------------------------------------------------------------------------

const inputClass =
  "h-9 rounded-control border border-border bg-elevated px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">{children}</span>;
}

function RewardFields({
  label,
  value,
  onChange,
  allowOwn,
}: {
  label: string;
  value: RewardSpec;
  onChange: (next: RewardSpec) => void;
  /** The referrer's side may say "their own plan's tier". */
  allowOwn: boolean;
}) {
  const kind = value.kind;
  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">{label}</legend>
      <label className="flex flex-col gap-1">
        <Label>{label}</Label>
        <select
          value={kind}
          className={`${inputClass} w-36`}
          onChange={(e) => {
            const next = e.target.value as RewardSpec["kind"];
            onChange(
              next === "free_days"
                ? { kind: "free_days", tier: allowOwn ? "own" : "plus", units: 1 }
                : next === "credits"
                  ? { kind: "credits", amount: 20 }
                  : { kind: "none" },
            );
          }}
        >
          <option value="free_days">Free days</option>
          <option value="credits">AI credits</option>
          <option value="none">Nothing</option>
        </select>
      </label>
      {value.kind === "free_days" ? (
        <>
          <label className="flex flex-col gap-1">
            <Label>Plan</Label>
            <select
              value={value.tier}
              className={`${inputClass} w-32`}
              onChange={(e) => onChange({ ...value, tier: e.target.value as "plus" | "pro" | "own" })}
            >
              {allowOwn ? <option value="own">Their own plan</option> : null}
              <option value="plus">Plus</option>
              <option value="pro">Pro</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <Label>Length</Label>
            <select
              value={String(value.units)}
              className={`${inputClass} w-40`}
              onChange={(e) => onChange({ ...value, units: Number(e.target.value) })}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  {n * 30} days
                </option>
              ))}
            </select>
          </label>
        </>
      ) : value.kind === "credits" ? (
        <label className="flex flex-col gap-1">
          <Label>Credits</Label>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={value.amount}
            className={`${inputClass} w-28`}
            onChange={(e) => onChange({ kind: "credits", amount: Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))) })}
          />
        </label>
      ) : null}
    </fieldset>
  );
}

export function ReferralSettingsForm({ initial }: { initial: ReferralSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ReferralSettings>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function save() {
    const summary = [
      `Program: ${draft.enabled ? "ON" : "OFF"}`,
      `Friend gets: ${rewardPhrase(draft.friend)}`,
      `Referrer gets: ${rewardPhrase(draft.referrer, { ownTierWord: "their own plan" })}`,
      `Caps: ${draft.caps.perMonth} rewards a month, ${draft.caps.lifetime} ever, ${draft.caps.friendsPerMonth} rewarded friends a month`,
    ].join("\n");
    if (!window.confirm(`Save these referral settings?\n\n${summary}\n\nRewards already given are not changed.`)) return;
    startTransition(async () => {
      const result = await adminSaveReferralSettingsAction(draft);
      if (!result.ok) {
        adminErrorToast("referral settings", result.error);
        return;
      }
      toast.success("Referral settings saved.", { description: summary.replace(/\n/g, " · ") });
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-4 border-t border-border/50 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Program settings</h3>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          {draft.enabled ? "Referrals are ON" : "Referrals are OFF (paused)"}
        </label>
      </div>
      <p className="text-xs leading-5 text-muted">
        What each side gets when a referred friend saves their first card — changed here, never with a deploy. Free days
        are the same mechanism as a comp: added to a paying plan&apos;s time, a perks overlay otherwise, with the plan&apos;s
        normal AI credits. OFF pauses new signups and rewards; what was already given stays.
      </p>
      <RewardFields label="Friend gets" value={draft.friend} onChange={(friend) => setDraft({ ...draft, friend })} allowOwn={false} />
      <RewardFields label="Referrer gets" value={draft.referrer} onChange={(referrer) => setDraft({ ...draft, referrer })} allowOwn />
      <div className="flex flex-wrap items-end gap-3">
        {(
          [
            ["perMonth", "Referrer rewards a month"],
            ["lifetime", "Referrer rewards ever"],
            ["friendsPerMonth", "Rewarded friends a month"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1">
            <Label>{label}</Label>
            <input
              type="number"
              min={0}
              max={key === "lifetime" ? 1000 : 100}
              step={1}
              value={draft.caps[key]}
              className={`${inputClass} w-28`}
              onChange={(e) =>
                setDraft({ ...draft, caps: { ...draft.caps, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })
              }
            />
          </label>
        ))}
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}
