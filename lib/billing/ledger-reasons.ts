// Human labels for credit_ledger.reason. The raw column is an audit string:
// "admin_grant: <note the admin typed>", "spend:<job>:<step>:<uuid>",
// "refund", "pack_purchase", … The ledger on /dashboard/usage used to print
// it verbatim, which showed users the admin's internal note. Everything
// after the first colon is treated as private detail and never rendered.

const LABELS: Record<string, string> = {
  admin_grant: "Credits added by the PipGlyph team",
  signup: "Welcome credits",
  monthly_refill: "Monthly credits",
  refill: "Monthly credits",
  pack_purchase: "Credit pack",
  subscription: "Plan credits",
  upgrade: "Plan upgrade",
  refund: "Refund",
  spend: "AI generation",
};

export function describeLedgerReason(reason: string | null | undefined): string {
  if (!reason) return "Credit adjustment";
  const head = reason.split(":")[0]?.trim().toLowerCase() ?? "";
  const known = LABELS[head];
  if (known) return known;
  // Unknown prefix: humanise the identifier only (underscores → spaces).
  return head.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || "Credit adjustment";
}
