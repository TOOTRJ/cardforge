import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Gift, UserPlus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalDate } from "@/components/ui/local-date";
import { ReferralLinkBox } from "@/components/referrals/referral-link-box";
import { ReferralLadder } from "@/components/referrals/referral-ladder";
import { ReferralCodeEntry } from "@/components/referrals/referral-code-entry";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getMyReferralDashboard } from "@/lib/referrals/queries";
import { friendRewardPhrase, ladderRewardFor, rewardStepPhrase } from "@/lib/referrals/settings";
import type { ReferralRow } from "@/lib/referrals/summary";
import { ladderProgressLine, ladderProgressOf } from "@/lib/referrals/ladder-progress";
import { buildLadderView } from "@/lib/referrals/ladder-view";
import { REFERRAL_STATUS_LABELS, type ReferralStatus } from "@/lib/referrals/rules";

export const metadata: Metadata = {
  title: "Refer a friend",
  description: "Share your referral link: when a friend joins and saves their first cards, you both earn a reward.",
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// /dashboard/referrals (v2, owner 2026-11-06; the layout owner 2026-11-11) —
// the viewer's referral link, the ladder they climb, their days bank, and
// the friends who used the link (lib/referrals/queries.ts: their own rows
// through the column grant). A blocked referral reads "Not eligible"; the
// reason is the admins' alone.
//
// THE FRAME is the dashboard's wide one (it was capped at 1024 px, the
// width of a page of forms, and left a third of a wide window empty). Extra
// width is a second column, never longer lines: from `xl` the page is the
// LADDER and the friends on the left, and a rail on the right with the link,
// how it works and the bank. Below `xl` it is one column in the order a
// phone needs — the link first (it is why the page is opened), then the
// ladder, the numbers and the friends, then the rest. Three grid children
// place themselves: the link (top of the rail), the main column (spanning
// both rail rows) and the rest of the rail.
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<ReferralStatus, "default" | "primary" | "accent" | "gold" | "outline" | "danger"> = {
  signed_up: "outline",
  first_card: "primary",
  cards_saved: "primary",
  rewarded: "gold",
  capped: "default",
  blocked: "default",
  expired: "default",
};

/** The reward cell when nothing was recorded for the viewer. A friend whose
 *  cards are saved has qualified (owner 2026-11-11: no plan is waited for)
 *  and the reward is being checked — "pending", not a promise: the check
 *  can still find the referral not eligible. */
function noRewardText(status: ReferralStatus): string {
  if (status === "signed_up") return "Waiting for their cards";
  if (status === "first_card" || status === "cards_saved") return "Cards saved — reward pending";
  if (status === "capped") return "None — this month's limit of rewarded friends was reached";
  return "—";
}

export default async function ReferralsPage() {
  if (!isBillingEnabled()) notFound();
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/referrals")}`);

  const dashboard = await getMyReferralDashboard();
  if (!dashboard) redirect("/login");
  const { link, rows, summary, joinedThrough, settings, bank, codeEntry } = dashboard;
  const friendGets = friendRewardPhrase(settings);
  const firstStep = rewardStepPhrase(ladderRewardFor(settings, 1));
  const { cardsRequired, windowDays } = settings.activation;
  const progress = ladderProgressOf(summary);

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Account"
        title="Refer a friend"
        description={
          settings.enabled
            ? `Give a friend ${friendGets} toward a plan — and earn ${firstStep} for your first referral, more for each one after.`
            : "The referral program is paused right now."
        }
      />

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* 1. The link: first on a phone, the top of the rail on a wide screen. */}
        <section aria-labelledby="referral-link" className="min-w-0 xl:col-start-2 xl:row-start-1">
          <SurfaceCard tone={settings.enabled ? "gold" : "default"} className="flex flex-col gap-4 p-6">
            <h2 id="referral-link" className="font-display text-lg font-semibold text-foreground">
              Your link
            </h2>
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
          </SurfaceCard>
        </section>

        {/* 2. The main column: the ladder, the numbers, the friends. */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          {settings.enabled ? (
            <section aria-labelledby="referral-ladder">
              <SurfaceCard className="flex flex-col gap-5 p-6">
                <div className="flex flex-col gap-1">
                  <h2 id="referral-ladder" className="font-display text-lg font-semibold text-foreground">
                    Your ladder
                  </h2>
                  {/* SG4: the rung against the ladder's length, and what the
                      next referral earns — the same sentence the share
                      dialog carries. */}
                  <p className="text-sm text-muted">{ladderProgressLine(progress)}</p>
                </div>
                <ReferralLadder view={buildLadderView(settings, summary.rewardsEarned)} progress={progress} />
              </SurfaceCard>
            </section>
          ) : null}

          <section aria-labelledby="referral-stats">
            <h2 id="referral-stats" className="sr-only">
              Your referrals in numbers
            </h2>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Friends joined" value={String(summary.joined)} />
              <Stat label="Saved their cards" value={String(summary.cardsSaved)} />
              <Stat label="Rewards earned" value={String(summary.rewardsEarned)} />
              <Stat label="Rewarded this month" value={`${summary.friendsThisMonth} of ${summary.friendsPerMonth}`} />
            </dl>
          </section>

          <section aria-labelledby="referral-list">
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
        </div>

        {/* 3. The rest of the rail: how it works, the bank, the small print. */}
        <aside className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-2" aria-label="How referrals work">
          {settings.enabled ? (
            <SurfaceCard className="flex flex-col gap-4 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">How it works</h2>
              <ol className="flex flex-col gap-3 text-sm text-muted">
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">1. Share your link.</span> A friend opens it and creates
                  an account.
                </li>
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">{`2. They save ${cardsRequired} cards`}</span>
                  {`, each with its own artwork, within ${windowDays} days of signing up.`}
                </li>
                <li className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <span className="font-semibold text-foreground">3. You both get your reward.</span>
                  {` ${friendGets} go into their bank, and you get your next step on the ladder. Nobody has to start a plan or add a card to earn it.`}
                </li>
              </ol>
            </SurfaceCard>
          ) : null}

          <section aria-labelledby="referral-bank">
            <SurfaceCard className="flex flex-col gap-3 p-5">
              <div className="flex items-start gap-3">
                <Gift className="mt-0.5 h-5 w-5 shrink-0 text-gold-strong" aria-hidden />
                <div className="min-w-0">
                  <h2 id="referral-bank" className="text-sm font-semibold text-foreground">
                    Banked free days
                  </h2>
                  <p className="text-sm text-muted">
                    {bank.banked > 0
                      ? `${bank.banked} day${bank.banked === 1 ? "" : "s"} waiting${bank.reserved > 0 ? ` (${bank.reserved} being applied)` : ""}.`
                      : "Nothing banked right now — rewards land here."}
                  </p>
                </div>
              </div>
              <Button asChild variant="secondary" size="sm" className="self-start">
                <Link href="/dashboard/billing#banked-days">{bank.banked > 0 ? "Apply them on your billing page" : "Your billing page"}</Link>
              </Button>
            </SurfaceCard>
          </section>

          {/* A new account whose browser lost its friend's link types the code. */}
          {codeEntry.open && codeEntry.until ? (
            <SurfaceCard className="p-5">
              <ReferralCodeEntry until={codeEntry.until} friendGets={friendGets} />
            </SurfaceCard>
          ) : null}

          {joinedThrough ? (
            <p className="text-sm text-muted" data-testid="referral-joined-through">
              You joined through {joinedThrough.username ? `@${joinedThrough.username}` : "a friend"}&apos;s link
              {joinedThrough.status === "signed_up"
                ? ` — save ${cardsRequired} cards, each with its own artwork, to get ${friendGets}.`
                : joinedThrough.status === "first_card" || joinedThrough.status === "cards_saved"
                  ? " — your cards are saved, and your reward is being checked."
                  : joinedThrough.rewarded === true
                    ? " — your free days are in your bank."
                    : joinedThrough.rewarded == null && (joinedThrough.status === "rewarded" || joinedThrough.status === "capped" || joinedThrough.status === "blocked")
                      ? " — your reward is on its way."
                      : "."}
            </p>
          ) : null}

          {settings.enabled ? (
            <p className="text-xs leading-5 text-subtle">
              Banked days are a plan&apos;s free time. Starting a plan applies them all — that is when a card is asked
              for — and days earned later are applied from your billing page whenever you like. The plan bills at its
              usual price when the days end unless you cancel. A friend&apos;s card counts when it has artwork of its
              own; the same picture on several cards counts once. Up to {summary.friendsPerMonth} rewarded friends a
              month; past that, the extra friends that month earn nobody a reward. New accounts only, and one reward
              per email address.
            </p>
          ) : null}
        </aside>
      </div>
    </DashboardShell>
  );
}

function RewardText({ row }: { row: ReferralRow }) {
  if (!row.reward) return <>{noRewardText(row.status)}</>;
  const label =
    row.reward === "credits" ? "AI credits" : row.reward === "banked_days" ? "Free days (banked)" : "Free days";
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <Gift className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
      {label}
      {row.ladderStep != null ? <span className="text-subtle">{` · referral #${row.ladderStep}`}</span> : null}
    </span>
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
