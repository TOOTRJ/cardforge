import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Gift, UserPlus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalDate } from "@/components/ui/local-date";
import { ReferralLinkBox } from "@/components/referrals/referral-link-box";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getMyReferralDashboard } from "@/lib/referrals/queries";
import { rewardPhrase } from "@/lib/referrals/settings";
import type { ReferralRow } from "@/lib/referrals/summary";
import {
  REFERRAL_ACTIVATION_WINDOW_DAYS,
  REFERRAL_STATUS_LABELS,
  type ReferralStatus,
} from "@/lib/referrals/rules";

export const metadata: Metadata = {
  title: "Refer a friend",
  description: "Share your referral link: a friend who saves their first card gets free days of Plus, and so do you.",
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// /dashboard/referrals — the viewer's referral link and the friends who used
// it (lib/referrals/queries.ts: their own rows through 0164's column grant).
// A blocked referral reads "Not eligible"; the reason is the admins' alone.
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<ReferralStatus, "default" | "primary" | "accent" | "gold" | "outline" | "danger"> = {
  signed_up: "outline",
  first_card: "primary",
  rewarded: "gold",
  capped: "default",
  blocked: "default",
  expired: "default",
};

const REWARD_LABEL = {
  free_days: "Free days",
  credits: "AI credits",
} as const;

/** The reward cell when no month was recorded for the viewer. */
function noRewardText(status: ReferralStatus): string {
  if (status === "signed_up") return "Waiting for their first card";
  // Claimed only once both emails are confirmed; the hourly sweep finishes it.
  if (status === "first_card") return "Pending — waiting on a confirmed email";
  if (status === "capped") return "None for you — they still got theirs";
  return "—";
}

export default async function ReferralsPage() {
  if (!isBillingEnabled()) notFound();
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/referrals")}`);

  const dashboard = await getMyReferralDashboard();
  if (!dashboard) redirect("/login");
  const { link, rows, summary, joinedThrough, settings } = dashboard;
  // What each side gets — the settings' words (lib/referrals/settings.ts).
  const friendGets = rewardPhrase(settings.friend);
  const youGet = rewardPhrase(settings.referrer, { ownTierWord: "your plan" });
  const freeDays = settings.friend.kind === "free_days" || settings.referrer.kind === "free_days";

  return (
    <DashboardShell readable>
      <PageHeader
        eyebrow="Account"
        title="Refer a friend"
        description={
          settings.enabled
            ? `Give a friend ${friendGets} — and get ${youGet} yourself when they save their first card.`
            : "The referral program is paused right now."
        }
      />

      <section className="mt-8">
        <SurfaceCard className="flex flex-col gap-5 p-6">
          {!settings.enabled ? (
            <p className="text-sm text-muted">
              The referral program is paused: links don&apos;t count for now, and no new rewards are given. Rewards you
              already earned stay on your account.
            </p>
          ) : link ? (
            <ReferralLinkBox link={link} friendGets={friendGets} />
          ) : (
            <p className="text-sm text-muted">Your referral link couldn&apos;t be loaded. Refresh the page to try again.</p>
          )}
          {settings.enabled ? (
            <>
              <ol className="grid gap-3 text-sm text-muted sm:grid-cols-3">
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">1. Share your link.</span> A friend opens it and creates an account.
                </li>
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">2. They save their first card</span> within {REFERRAL_ACTIVATION_WINDOW_DAYS} days.
                </li>
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">3. You both get your reward</span> as soon as you&apos;ve both
                  confirmed your email: {friendGets} for them, {youGet} for you.
                </li>
              </ol>
              <p className="text-xs leading-5 text-subtle">
                You can earn up to {summary.monthlyCap} rewards a month and {summary.lifetimeCap} in all; past that your friends
                still get theirs. New accounts only, and one reward per email address.
                {freeDays
                  ? " Free days come with the plan's normal AI credits; on a paid plan they are added to the time you've paid for, so your next charge moves out by the same days."
                  : ""}
              </p>
            </>
          ) : null}
        </SurfaceCard>
      </section>

      <section className="mt-6" aria-labelledby="referral-stats">
        <h2 id="referral-stats" className="sr-only">
          Your referrals in numbers
        </h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          <Stat label="Friends joined" value={String(summary.joined)} />
          <Stat label="Saved a first card" value={String(summary.activated)} />
          <Stat label="Rewards earned" value={`${summary.rewardsEarned} of ${summary.lifetimeCap}`} />
          <Stat label="This month" value={`${summary.thisMonth} of ${summary.monthlyCap}`} />
        </dl>
        {summary.lifetimeReached ? (
          <p className="mt-3 text-sm text-muted">
            You&apos;ve earned every reward the program gives — thank you! Friends who join with your link still get
            theirs.
          </p>
        ) : null}
      </section>

      <section className="mt-6" aria-labelledby="referral-list">
        <h2 id="referral-list" className="mb-3 font-display text-lg font-semibold text-foreground">
          Friends who joined
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No one yet"
            description="When someone signs up with your link, they show up here. You'll get a notification when your reward arrives."
          />
        ) : (
          <SurfaceCard className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="px-4 py-3 font-medium">Friend</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Joined</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Your reward</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border/50">
                    <td className="px-4 py-3 text-foreground">
                      {row.username ? (
                        <Link href={`/profile/${row.username}`} className="hover:underline">
                          @{row.username}
                        </Link>
                      ) : row.accountDeleted ? (
                        <span className="text-muted">A deleted account</span>
                      ) : (
                        "A new member"
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted sm:table-cell">
                      <LocalDate iso={row.signedUpAt} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[row.status]}>{REFERRAL_STATUS_LABELS[row.status]}</Badge>
                      {/* On a phone the reward column is hidden: the reward reads under the badge. */}
                      <span className="mt-1.5 block text-xs text-muted sm:hidden">
                        <RewardText row={row} />
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">
                      <RewardText row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfaceCard>
        )}
      </section>

      {joinedThrough ? (
        <p className="mt-6 text-sm text-muted">
          You joined through {joinedThrough.username ? `@${joinedThrough.username}` : "a friend"}&apos;s link
          {joinedThrough.status === "signed_up"
            ? ` — save your first card to get ${friendGets}.`
            : joinedThrough.status === "first_card"
              ? " — your reward is on its way once both of you have confirmed your email."
              : joinedThrough.status === "rewarded" || joinedThrough.status === "capped"
                ? " — your reward is on your account."
                : "."}
        </p>
      ) : null}
    </DashboardShell>
  );
}

function RewardText({ row }: { row: ReferralRow }) {
  return row.reward ? (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <Gift className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
      {REWARD_LABEL[row.reward]}
    </span>
  ) : (
    <>{noRewardText(row.status)}</>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/60 p-4">
      <dt className="text-[11px] uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
