import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Coins, Sparkles, TriangleAlert } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AI_ACTION_COST, type AiActionLabel } from "@/lib/ai/rate-limit";
import { isBillingEnabled } from "@/lib/billing/flags";

export const metadata: Metadata = {
  title: "AI usage",
  description: "Every AI generation event, its credit cost, and any errors.",
};

// ---------------------------------------------------------------------------
// /dashboard/usage — the credit-usage ledger. One row per event that used
// (or would use, while billing is off) AI credits: batch generation jobs
// with their per-step outcomes and errors, single-card generations, and —
// once billing is live — the raw credit ledger.
// ---------------------------------------------------------------------------

type JobStepLite = {
  key?: string;
  label?: string;
  status?: string;
  error?: string;
};

const JOB_KIND_LABELS: Record<string, string> = {
  set: "Set generation",
  deck: "Deck generation",
  deck_remix: "Deck remix",
};

const ACTION_LABELS: Partial<Record<AiActionLabel, string>> = {
  generate_random_card: "Single card generation",
  remix_card: "Card remix",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function UsagePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/usage")}`);

  const supabase = await createClient();
  const [jobsResult, callsResult, ledgerResult] = await Promise.all([
    supabase
      .from("ai_generation_jobs")
      .select("id, kind, status, request, steps, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("card_ai_calls")
      .select("id, action, created_at")
      .in("action", ["generate_random_card", "remix_card"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, balance_after, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const jobs = jobsResult.data ?? [];
  const calls = callsResult.data ?? [];
  const ledger = ledgerResult.data ?? [];
  const billingOn = isBillingEnabled();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Account"
        title="AI usage"
        description={
          billingOn
            ? "Every event that used AI credits — what ran, what it cost, and any errors."
            : "Every AI generation event and what it would cost in credits. Credits aren't charged while billing is off."
        }
      />

      {/* ---- Batch generations (jobs) ---- */}
      <section className="mt-8 flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Batch generations
        </h2>
        {jobs.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No batch generations yet"
            description="Set, deck, and deck-remix generations will show up here with their credit cost and per-step results."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((jobRow) => {
              const steps = (Array.isArray(jobRow.steps)
                ? jobRow.steps
                : []) as JobStepLite[];
              const cardSteps = steps.filter(
                (step) =>
                  step.key?.startsWith("card:") || step.key?.startsWith("remix:"),
              );
              const done = cardSteps.filter((s) => s.status === "done").length;
              const failures = steps.filter((s) => s.status === "failed");
              const pending = steps.filter((s) => s.status === "pending").length;
              const request = (jobRow.request ?? {}) as Record<string, unknown>;
              const theme =
                typeof request.theme === "string" && request.theme
                  ? request.theme
                  : null;
              return (
                <SurfaceCard key={jobRow.id} className="flex flex-col gap-2 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {JOB_KIND_LABELS[jobRow.kind] ?? jobRow.kind}
                      </span>
                      <Badge
                        variant={
                          jobRow.status === "done"
                            ? "primary"
                            : jobRow.status === "failed"
                              ? "outline"
                              : "outline"
                        }
                      >
                        {jobRow.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted">
                      {formatWhen(jobRow.created_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" aria-hidden />
                      {done} credit{done === 1 ? "" : "s"} used ({done} card
                      {done === 1 ? "" : "s"} generated)
                    </span>
                    {theme ? <span>Theme: “{theme}”</span> : null}
                    {pending > 0 ? (
                      <span>{pending} step{pending === 1 ? "" : "s"} pending</span>
                    ) : null}
                  </div>
                  {failures.length > 0 ? (
                    <ul className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
                      {failures.map((step) => (
                        <li key={step.key} className="flex items-start gap-1.5">
                          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          <span>
                            <span className="font-medium">{step.label}</span>
                            {step.error ? ` — ${step.error}` : " — failed"}
                            {" "}(no credit charged for failed cards)
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </SurfaceCard>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Single-card events ---- */}
      <section className="mt-10 flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Single-card generations
        </h2>
        {calls.length === 0 ? (
          <p className="text-sm text-muted">
            No single-card generations or remixes yet.
          </p>
        ) : (
          <SurfaceCard className="divide-y divide-border p-0">
            {calls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span className="text-foreground">
                  {ACTION_LABELS[call.action as AiActionLabel] ?? call.action}
                </span>
                <span className="flex items-center gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Coins className="h-3 w-3" aria-hidden />
                    {AI_ACTION_COST[call.action as AiActionLabel] ?? 1} credit
                  </span>
                  {formatWhen(call.created_at)}
                </span>
              </div>
            ))}
          </SurfaceCard>
        )}
      </section>

      {/* ---- Credit ledger (billing live) ---- */}
      {billingOn || ledger.length > 0 ? (
        <section className="mt-10 flex flex-col gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Credit ledger
          </h2>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted">No credit movements yet.</p>
          ) : (
            <SurfaceCard className="divide-y divide-border p-0">
              {ledger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <span className="text-foreground">{entry.reason}</span>
                  <span className="flex items-center gap-4 text-xs text-muted">
                    <span
                      className={
                        entry.delta < 0 ? "text-danger" : "text-primary-bright"
                      }
                    >
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </span>
                    <span>balance {entry.balance_after}</span>
                    {formatWhen(entry.created_at)}
                  </span>
                </div>
              ))}
            </SurfaceCard>
          )}
        </section>
      ) : null}
    </DashboardShell>
  );
}
