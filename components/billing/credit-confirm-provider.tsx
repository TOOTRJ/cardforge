"use client";

// ---------------------------------------------------------------------------
// CreditConfirmProvider — every action that spends AI credits asks first.
//
//   const confirmSpend = useCreditConfirm();
//   if (!(await confirmSpend({ cost: 3, title: "Generate 3 cards?" }))) return;
//
// The dialog says exactly what the action costs and what the balance will
// be afterwards. The balance shown is the live one: seeded from the credits
// bus (the header chip's number) and refreshed from /api/me the moment the
// dialog opens, so a stale tab still shows the truth before spending.
// Not enough credits → the upgrade modal opens instead and the promise
// resolves false. Billing off → nothing is charged, so nothing to confirm.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { subscribeCredits } from "@/components/billing/credits-bus";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { isBillingEnabled } from "@/lib/billing/flags";

export type CreditSpendRequest = {
  /** Credits the action will reserve (refunded per failed step). */
  cost: number;
  /** Question form: "Generate 3 cards?" */
  title: string;
  /** What the user gets for it. */
  description?: string;
  /** Button label; defaults to "Use N credits". */
  confirmLabel?: string;
};

type CreditConfirmContextValue = {
  confirmSpend: (request: CreditSpendRequest) => Promise<boolean>;
};

const CreditConfirmContext = createContext<CreditConfirmContextValue | null>(null);

export function useCreditConfirm(): (request: CreditSpendRequest) => Promise<boolean> {
  const value = useContext(CreditConfirmContext);
  // Outside the provider (tests, stories) nothing to confirm with — allow.
  return value?.confirmSpend ?? (async () => true);
}

type Viewer = { signedIn: boolean; credits: number; isAdmin: boolean };

async function fetchViewer(): Promise<Viewer | null> {
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user: { credits?: number; isAdmin?: boolean } | null;
    };
    if (!data.user) return { signedIn: false, credits: 0, isAdmin: false };
    return {
      signedIn: true,
      credits: typeof data.user.credits === "number" ? data.user.credits : 0,
      isAdmin: data.user.isAdmin === true,
    };
  } catch {
    return null;
  }
}

type Pending = {
  request: CreditSpendRequest;
  resolve: (ok: boolean) => void;
};

export function CreditConfirmProvider({ children }: { children: React.ReactNode }) {
  const upgrade = useUpgradeModal();
  const [pending, setPending] = useState<Pending | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);
  // Last balance the app broadcast — what the dialog shows before /api/me
  // answers (usually identical; the fetch is the tie-breaker).
  const busBalanceRef = useRef<number | null>(null);
  useEffect(() => subscribeCredits((balance) => { busBalanceRef.current = balance; }), []);

  const settle = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const confirmSpend = useCallback(
    (request: CreditSpendRequest): Promise<boolean> => {
      if (!isBillingEnabled() || request.cost <= 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        // A second request while one is open: answer the first "no" so
        // nothing runs unconfirmed, then show the new one.
        setPending((current) => {
          current?.resolve(false);
          return { request, resolve };
        });
        setViewer(
          busBalanceRef.current === null
            ? null
            : { signedIn: true, credits: busBalanceRef.current, isAdmin: false },
        );
        setLoadingViewer(true);
        void fetchViewer().then((fresh) => {
          setLoadingViewer(false);
          if (!fresh) return;
          setViewer(fresh);
          if (!fresh.signedIn) return;
          if (!fresh.isAdmin && fresh.credits < request.cost) {
            // Not enough: the upgrade modal is the answer, not a disabled button.
            settle(false);
            upgrade.open("credits");
          }
        });
      });
    },
    [settle, upgrade],
  );

  const value = useMemo(() => ({ confirmSpend }), [confirmSpend]);
  const request = pending?.request ?? null;
  const cost = request?.cost ?? 0;
  const balance = viewer?.credits ?? null;
  const unlimited = viewer?.isAdmin === true;
  const remaining = balance === null ? null : Math.max(0, balance - cost);
  const short = !unlimited && balance !== null && balance < cost;

  return (
    <CreditConfirmContext.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
        {request ? (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden />
                {request.title}
              </DialogTitle>
              {request.description ? <DialogDescription>{request.description}</DialogDescription> : null}
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2">
              <CostTile label="Uses" value={`${cost}`} unit={cost === 1 ? "credit" : "credits"} tone="accent" />
              <CostTile
                label="You have"
                value={unlimited ? "∞" : balance === null ? "…" : `${balance}`}
                unit={unlimited ? "admin" : balance === 1 ? "credit" : "credits"}
                loading={loadingViewer && balance === null}
              />
              <CostTile
                label="After"
                value={unlimited ? "∞" : remaining === null ? "…" : `${remaining}`}
                unit={unlimited ? "admin" : remaining === 1 ? "credit" : "credits"}
                tone={short ? "danger" : undefined}
              />
            </div>
            <p className="text-xs leading-5 text-muted">
              {cost > 1
                ? "Charged one credit per card as each one finishes — a card that fails to generate is refunded automatically."
                : "Refunded automatically if the generation fails."}
            </p>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => settle(true)} disabled={short}>
                <Coins className="h-4 w-4" aria-hidden />
                {request.confirmLabel ?? `Use ${cost} ${cost === 1 ? "credit" : "credits"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </CreditConfirmContext.Provider>
  );
}

function CostTile({
  label,
  value,
  unit,
  tone,
  loading,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "accent" | "danger";
  loading?: boolean;
}) {
  return (
    <div
      className={
        tone === "accent"
          ? "flex flex-col gap-0.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2"
          : tone === "danger"
            ? "flex flex-col gap-0.5 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2"
            : "flex flex-col gap-0.5 rounded-lg border border-border/60 bg-elevated/30 px-3 py-2"
      }
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className="flex items-baseline gap-1">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
        ) : (
          <span className={`font-display text-xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : "text-foreground"}`}>{value}</span>
        )}
        <span className="text-[11px] text-subtle">{unit}</span>
      </span>
    </div>
  );
}
