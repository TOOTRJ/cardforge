// Human labels for credit_ledger.reason. The raw column is an audit string:
// "admin_grant: <note the admin typed>", "subscription_refill", "refund",
// "pack_purchase", or — for spends — the AI action label the caller passed
// to consume_credits (lib/ai/rate-limit.ts AiActionLabel). The ledger on
// /dashboard/usage used to print it verbatim, which showed users the admin's
// internal note. Everything after the first colon is treated as private
// detail and never rendered. tests/unit/billing/ledger-reasons.test.ts keeps
// this table in step with the labels the code actually writes.

const LABELS: Record<string, string> = {
  // Grants
  admin_grant: "Credits added by the PipGlyph team",
  signup_grant: "Welcome credits",
  subscription_refill: "Monthly plan credits",
  trial_grant: "Free-trial credits",
  pack_purchase: "Credit pack",
  refund: "Refund",
  // Spends — one per AiActionLabel
  generate_deck: "AI deck generation",
  generate_deck_cards: "AI deck generation",
  generate_random_card: "AI card generation",
  generate_from_concept: "AI card generation",
  fill_card: "AI card fill",
  generate_card_ideas: "Card ideas",
  generate_deck_ideas: "Deck ideas",
  analyze_deck: "Deck analysis",
  remix_card: "AI remix",
  remix_art: "AI art remix",
  generate_random_art: "AI art",
  generate_art_prompt: "AI art prompt",
  generate_flavor: "AI flavor text",
  improve_wording: "AI wording",
  suggest_cost: "AI cost suggestion",
  suggest_rarity: "AI rarity suggestion",
  check_balance: "AI balance check",
};

export const LEDGER_REASON_LABELS: Readonly<Record<string, string>> = LABELS;

export function describeLedgerReason(reason: string | null | undefined): string {
  if (!reason) return "Credit adjustment";
  const head = reason.split(":")[0]?.trim().toLowerCase() ?? "";
  const known = LABELS[head];
  if (known) return known;
  // Unknown prefix: humanise the identifier only (underscores → spaces).
  return head.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || "Credit adjustment";
}
