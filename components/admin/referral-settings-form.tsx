"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { adminSaveReferralSettingsAction } from "@/lib/admin/referral-settings-actions";
import {
  MAX_REWARD_DAYS,
  friendRewardPhrase,
  rewardStepPhrase,
  type ReferralSettings,
  type RewardStep,
} from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral program's settings, v2 (owner 2026-11-06): ON / OFF, the
// activation bar (cards within a window; the card on file is the rule, not
// a setting), what the friend gets (days banked), the referrer's LADDER by
// qualified-referral count with its tail, and the friends-per-month cap.
// Saved whole through adminSaveReferralSettingsAction; a confirm step names
// what changes. Rewards already given are untouched (the settings are read
// at grant time).
// ---------------------------------------------------------------------------

const inputClass =
  "h-9 rounded-control border border-border bg-elevated px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">{children}</span>;
}

const clampInt = (value: string, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

function StepFields({ label, value, onChange }: { label: string; value: RewardStep; onChange: (next: RewardStep) => void }) {
  return (
    <fieldset className="flex flex-wrap items-end gap-2">
      <legend className="sr-only">{label}</legend>
      <label className="flex flex-col gap-1">
        <Label>{label}</Label>
        <select
          value={value.kind}
          className={`${inputClass} w-32`}
          onChange={(e) => {
            const next = e.target.value as RewardStep["kind"];
            onChange(next === "days" ? { kind: "days", days: 7 } : next === "credits" ? { kind: "credits", amount: 5 } : { kind: "none" });
          }}
        >
          <option value="days">Free days</option>
          <option value="credits">AI credits</option>
          <option value="none">Nothing</option>
        </select>
      </label>
      {value.kind === "days" ? (
        <label className="flex flex-col gap-1">
          <Label>Days</Label>
          <input
            type="number"
            min={1}
            max={MAX_REWARD_DAYS}
            step={1}
            value={value.days}
            className={`${inputClass} w-24`}
            onChange={(e) => onChange({ kind: "days", days: clampInt(e.target.value, 1, MAX_REWARD_DAYS, 7) })}
          />
        </label>
      ) : value.kind === "credits" ? (
        <label className="flex flex-col gap-1">
          <Label>Credits</Label>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={value.amount}
            className={`${inputClass} w-24`}
            onChange={(e) => onChange({ kind: "credits", amount: clampInt(e.target.value, 1, 1000, 5) })}
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
      `Qualifies: ${draft.activation.cardsRequired} cards within ${draft.activation.windowDays} days + a card on file`,
      `Friend gets: ${friendRewardPhrase(draft)}`,
      `Ladder: ${draft.ladder.map((s, i) => `${i + 1}: ${rewardStepPhrase(s)}`).join(", ")}; then ${rewardStepPhrase(draft.tail)} each`,
      `Cap: ${draft.caps.friendsPerMonth} rewarded friends a month`,
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

  function setStep(index: number, step: RewardStep) {
    setDraft({ ...draft, ladder: draft.ladder.map((s, i) => (i === index ? step : s)) });
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
        A referral qualifies when the friend has saved the cards below within the window AND started a plan with a card
        on file (their banked days make it free). Rewards are DAYS INTO THE BANK (tier-less, no AI credits; the user
        applies them with a card on file) or AI credits at once — changed here, never with a deploy. The referrer climbs
        the ladder by qualified referral; past its last step every further referral earns the tail. OFF pauses new
        signups and rewards (a friend who qualifies meanwhile waits, up to 30 days); what was already given stays. A
        friends cap of 0 means nobody is rewarded.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <Label>Cards to save</Label>
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={draft.activation.cardsRequired}
            className={`${inputClass} w-24`}
            onChange={(e) => setDraft({ ...draft, activation: { ...draft.activation, cardsRequired: clampInt(e.target.value, 1, 50, 5) } })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <Label>Within (days)</Label>
          <input
            type="number"
            min={7}
            max={365}
            step={1}
            value={draft.activation.windowDays}
            className={`${inputClass} w-24`}
            onChange={(e) => setDraft({ ...draft, activation: { ...draft.activation, windowDays: clampInt(e.target.value, 7, 365, 30) } })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <Label>Friend gets (days)</Label>
          <input
            type="number"
            min={0}
            max={MAX_REWARD_DAYS}
            step={1}
            value={draft.friend.days}
            className={`${inputClass} w-24`}
            onChange={(e) => setDraft({ ...draft, friend: { days: clampInt(e.target.value, 0, MAX_REWARD_DAYS, 7) } })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <Label>Rewarded friends a month</Label>
          <input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={draft.caps.friendsPerMonth}
            className={`${inputClass} w-28`}
            onChange={(e) => setDraft({ ...draft, caps: { friendsPerMonth: clampInt(e.target.value, 0, 1000, 5) } })}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">The referrer&apos;s ladder</h4>
        <ol className="flex flex-col gap-2">
          {draft.ladder.map((step, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <span className="w-24 pb-2 text-sm tabular-nums text-muted">{`Referral ${i + 1}`}</span>
              <StepFields label={`Referral ${i + 1} reward`} value={step} onChange={(next) => setStep(i, next)} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove referral ${i + 1} from the ladder`}
                onClick={() => setDraft({ ...draft, ladder: draft.ladder.filter((_, j) => j !== i) })}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-3">
          {draft.ladder.length < 50 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraft({ ...draft, ladder: [...draft.ladder, { kind: "days", days: 7 }] })}
            >
              <Plus aria-hidden />
              Add a step
            </Button>
          ) : null}
          <StepFields label="Every further referral" value={draft.tail} onChange={(tail) => setDraft({ ...draft, tail })} />
        </div>
      </div>

      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}
