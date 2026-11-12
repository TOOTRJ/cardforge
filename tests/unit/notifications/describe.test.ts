import { describe, expect, it } from "vitest";
import { describeNotification, notificationSentence } from "@/lib/notifications/describe";

const actor = { username: "ana", displayName: "Ana" };
const card = { slug: "storm-crow", title: "Storm Crow", ownerUsername: "me" };

describe("describeNotification — one copy source for bell, page and toast", () => {
  it("routes messages to the right inbox per side", () => {
    const base = { type: "message", actor, card: null, threadId: "t1" };
    expect(describeNotification(base, { isAdmin: false })).toEqual({
      subject: "PipGlyph team",
      body: "sent you a message.",
      href: "/messages/t1",
    });
    expect(describeNotification(base, { isAdmin: true })).toEqual({
      subject: "Ana",
      body: "replied in a conversation.",
      href: "/admin/messages/t1",
    });
    expect(describeNotification({ ...base, threadId: null }, { isAdmin: false }).href).toBe("/messages");
  });

  it("spells out credit grants with the amount and new balance", () => {
    const d = describeNotification(
      { type: "credit_grant", actor, card: null, threadId: null, payload: { amount: 25, balance: 40, note: "sorry for the outage" } },
      { isAdmin: false },
    );
    expect(d.subject).toBe("PipGlyph team");
    expect(d.body).toBe("added 25 AI credits to your account — you now have 40 (sorry for the outage).");
    expect(d.href).toBe("/dashboard/usage");
    expect(
      describeNotification({ type: "credit_grant", actor, card: null, threadId: null, payload: { amount: 1 } }, { isAdmin: false }).body,
    ).toBe("added 1 AI credit to your account.");
  });

  it("describes comp plans, including removal", () => {
    const comp = (payload: Record<string, unknown>) =>
      describeNotification({ type: "comp_plan", actor, card: null, threadId: null, payload }, { isAdmin: false }).body;
    // The legacy shape (a comp set before 0176) and an open-ended grant.
    expect(comp({ tier: "pro", expiresAt: "2026-12-01T12:00:00Z" })).toMatch(/^gave you Pro plan access until Dec 1, 2026 — enjoy\.$/);
    expect(comp({ tier: "pro", days: null, expiresAt: null })).toBe("gave you Pro plan access — enjoy.");
    expect(comp({ tier: null })).toBe("ended your complimentary plan access.");
  });

  it("banked days (0179): the admin's comp lands in the bank — the user applies them; a revoke says so", () => {
    const d = (payload: Record<string, unknown>) => describeNotification({ type: "banked_days", actor, card: null, threadId: null, payload }, { isAdmin: false });
    expect(d({ days: 14, note: "thanks for the report" })).toEqual({
      subject: "PipGlyph team",
      body: "banked 14 free days for you (thanks for the report) — start a plan and they're its free period, or apply them to the plan you have, any time from your billing page.",
      href: "/dashboard/billing#banked-days",
    });
    expect(d({ days: 1 }).body).toMatch(/^banked 1 free day for you — /);
    expect(d({ days: 7, revoked: 1, note: "given by mistake" }).body).toBe("took back 7 free days from your bank (given by mistake).");
    expect(d({ days: 7, revoked: 1 }).body).toBe("took back 7 free days from your bank.");
    expect(d({ days: 30 }).body).not.toMatch(/month/);
  });

  it("free 30 days (0176): the days and their end; a hold on a plan names the moved charge, on a trial the longer trial", () => {
    const comp = (payload: Record<string, unknown>) =>
      describeNotification({ type: "comp_plan", actor, card: null, threadId: null, payload }, { isAdmin: false }).body;
    expect(comp({ tier: "plus", days: 30, expiresAt: "2026-12-10T15:14:00Z" })).toMatch(/^gave you 30 free days of Plus — until Dec 10, 2026 — enjoy\.$/);
    expect(comp({ tier: "pro", days: 60, expiresAt: "2027-01-04T09:00:00Z", holdEndsAt: "2027-01-04T09:00:00Z", was: "active" })).toMatch(
      /^gave you 60 free days of Pro — until Jan 4, 2027 — enjoy\. They're added to the time you've paid for: your next charge moves to Jan 4, 2027\.$/,
    );
    expect(comp({ tier: "pro", days: 30, expiresAt: "2026-12-12T00:00:00Z", holdEndsAt: "2026-12-12T00:00:00Z", was: "trialing" })).toMatch(
      /^gave you 30 free days of Pro — until Dec 1[12], 2026 — enjoy\. Your free trial now runs until Dec 1[12], 2026; nothing is charged before then\.$/,
    );
    expect(comp({ tier: "plus", expiresAt: "2026-12-20T00:00:00Z", revoked: 1 })).toMatch(/^shortened your complimentary Plus access — it now ends Dec (19|20), 2026\.$/);
    // Never "a free month".
    for (const payload of [{ tier: "plus", days: 30, expiresAt: "2026-12-10T15:14:00Z" }, { tier: "pro", days: 30, holdEndsAt: "2026-12-12T00:00:00Z", was: "active" }]) {
      expect(comp(payload)).not.toMatch(/month/);
    }
  });

  it("referral_signup and referral_reward: who, what reward, where it links — never 'a free month'", () => {
    const d = (type: string, payload: Record<string, unknown>) =>
      describeNotification({ type, actor, card: null, threadId: null, payload }, { isAdmin: false });
    // referral_signup is sent ONLY when a qualified friend earned the
    // referrer no reward — never a fraud reason, never a promise. A friend
    // qualifies on their cards alone (owner 2026-11-11): no plan is named.
    expect(d("referral_signup", { referralId: "r1", outcome: "not_eligible" })).toMatchObject({
      body: "joined PipGlyph with your referral link and saved their first cards. This referral isn't eligible for a reward.",
      href: "/dashboard/referrals",
    });
    expect(d("referral_signup", { referralId: "r1", outcome: "capped_friends" }).body).toBe(
      "joined PipGlyph with your referral link and saved their first cards. You've reached this month's limit of rewarded friends, so this one earns no reward on either side.",
    );
    // v2 (0180): days into the bank, the referrer's ladder step named.
    expect(d("referral_reward", { side: "referrer", reward: "banked_days", days: 7, step: 3 })).toMatchObject({
      body: "saved their first cards — referral #3 — 7 free days are in your bank. Apply them to a plan any time from your billing page. Thanks for spreading the word!",
      href: "/dashboard/referrals",
    });
    // One day is "is", on both sides.
    expect(d("referral_reward", { side: "referrer", reward: "banked_days", days: 1, step: 1 }).body).toBe(
      "saved their first cards — referral #1 — 1 free day is in your bank. Apply them to a plan any time from your billing page. Thanks for spreading the word!",
    );
    expect(d("referral_reward", { side: "referee", reward: "banked_days", days: 1 }).body).toMatch(/^invited you to PipGlyph — 1 free day is in your bank for saving your first cards\./);
    // The friend's days are for the cards; a plan is how they are USED.
    expect(d("referral_reward", { side: "referee", reward: "banked_days", days: 7 })).toMatchObject({
      body: "invited you to PipGlyph — 7 free days are in your bank for saving your first cards. They're a plan's free time: starting a plan applies them, or apply them any time from your billing page.",
      href: "/dashboard/billing#banked-days",
    });
    expect(d("referral_reward", { side: "referrer", reward: "credits", credits: 5, step: 2 }).body).toBe(
      "saved their first cards — referral #2 — you've earned 5 AI credits. Thanks for spreading the word!",
    );
    // The 0177 shapes still read.
    expect(d("referral_reward", { side: "referrer", reward: "free_days", tier: "pro", days: 30, until: "2027-01-04T09:00:00Z", holdEndsAt: "2027-01-04T09:00:00Z" }).body).toBe(
      "saved their first card — you've earned 30 free days of Pro (until Jan 4, 2027) — added to the time you've paid for. Thanks for spreading the word!",
    );
    expect(d("referral_reward", { side: "referee", reward: "free_days", tier: "plus", days: 30, until: "2026-12-01T12:00:00Z" })).toMatchObject({
      body: "invited you to PipGlyph — you've earned 30 free days of Plus (until Dec 1, 2026) for saving your first card.",
      href: "/dashboard/billing",
    });
    for (const body of [d("referral_signup", { outcome: "capped_friends" }).body, d("referral_reward", { side: "referee", reward: "banked_days", days: 30 }).body]) {
      expect(body).not.toMatch(/free month/);
    }
  });

  it("no referral notification makes a plan a condition: the friend's cards are what earned it", () => {
    const d = (type: string, payload: Record<string, unknown>) =>
      describeNotification({ type, actor, card: null, threadId: null, payload }, { isAdmin: false }).body;
    const bodies = [
      ...["not_eligible", "capped_month", "capped_lifetime", "capped_friends", "something_new"].map((outcome) => d("referral_signup", { referralId: "r1", outcome })),
      d("referral_signup", {}),
      d("referral_reward", { side: "referrer", reward: "banked_days", days: 7, step: 1 }),
      d("referral_reward", { side: "referrer", reward: "banked_days", days: 1 }),
      d("referral_reward", { side: "referee", reward: "banked_days", days: 7 }),
      d("referral_reward", { side: "referee", reward: "banked_days", days: 1 }),
      d("referral_reward", { side: "referrer", reward: "credits", credits: 5, step: 2 }),
      d("referral_reward", { side: "referrer", reward: "credits", credits: 1, step: 4 }),
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(/started a plan|starting a plan and|and start(?:ed|ing)? |a plan started|qualified \(|card on file/);
      expect(body).not.toMatch(/free month/);
      expect(body).toMatch(/first cards/);
    }
    // Every referral_signup opens on the same words, whatever its reason.
    for (const body of bodies.slice(0, 6)) {
      expect(body.startsWith("joined PipGlyph with your referral link and saved their first cards. ")).toBe(true);
    }
    // A plan is named only as where banked days go: the way to use them.
    expect(d("referral_reward", { side: "referee", reward: "banked_days", days: 7 })).toContain("starting a plan applies them");
    expect(d("referral_reward", { side: "referrer", reward: "banked_days", days: 7, step: 1 })).toContain("Apply them to a plan any time");
  });

  it("describes card limit overrides and resets", () => {
    expect(
      describeNotification({ type: "card_limit", actor, card: null, threadId: null, payload: { limit: 2500 } }, { isAdmin: false }).body,
    ).toBe("raised your saved-card limit to 2,500.");
    expect(
      describeNotification({ type: "card_limit", actor, card: null, threadId: null, payload: { limit: null } }, { isAdmin: false }).body,
    ).toBe("reset your saved-card limit to your plan's default.");
  });

  it("keeps the social kinds and admin kinds as before", () => {
    expect(notificationSentence({ type: "like", actor, card, threadId: null }, { isAdmin: false })).toBe("Ana liked Storm Crow.");
    expect(describeNotification({ type: "comment", actor, card, threadId: null }, { isAdmin: false }).href).toBe("/card/me/storm-crow");
    expect(describeNotification({ type: "follow", actor, card: null, threadId: null }, { isAdmin: false })).toEqual({
      subject: "Ana",
      body: "started following you.",
      href: "/profile/ana",
    });
    expect(describeNotification({ type: "feedback", actor, card: null, threadId: null }, { isAdmin: true }).href).toBe("/admin/feedback");
    expect(describeNotification({ type: "moderation", actor: null, card: null, threadId: null }, { isAdmin: true })).toEqual({
      subject: "Someone",
      body: "filed a content report.",
      href: "/admin/moderation",
    });
  });
});

describe("describeNotification — render updates", () => {
  it("counts the affected cards and links to the walkthrough", () => {
    const d = describeNotification(
      { type: "render_update", actor: null, card: null, threadId: null, payload: { version: 20, count: 3 } },
      { isAdmin: false },
    );
    expect(d.subject).toBe("PipGlyph team");
    expect(d.body).toBe("updated the card frames — 3 of your cards have a newer look available. Compare each one and choose whether to update it.");
    expect(d.href).toBe("/dashboard?update-cards=1");
    expect(
      describeNotification({ type: "render_update", actor: null, card: null, threadId: null, payload: { version: 20, count: 1 } }, { isAdmin: false }).body,
    ).toMatch(/1 of your cards has a newer look/);
  });
});

describe("describeNotification — site updates", () => {
  const base = { actor: null, card: null, threadId: null } as const;
  it("announces a shipped update and links to its page", () => {
    const d = describeNotification(
      {
        ...base,
        type: "site_update",
        payload: { updateId: "u1", kind: "update", title: "Pips as icons", summary: "Type {G} and see the pip.", link: "/create" },
      },
      { isAdmin: false },
    );
    expect(d.subject).toBe("PipGlyph team");
    expect(d.body).toBe("shipped something new: Pips as icons — Type {G} and see the pip.");
    expect(d.href).toBe("/create");
  });

  it("teases an upcoming feature and falls back to /news for unsafe links", () => {
    const d = describeNotification(
      {
        ...base,
        type: "site_update",
        payload: { updateId: "u2", kind: "upcoming", title: "Smart deck building", summary: "", link: "javascript:alert(1)" },
      },
      { isAdmin: false },
    );
    expect(d.body).toBe("teased what's coming next: Smart deck building");
    expect(d.href).toBe("/news");
  });
});

describe("describeNotification — deck generated", () => {
  it("links to the deck and counts retries", () => {
    const d = describeNotification(
      {
        actor: null,
        card: null,
        threadId: null,
        type: "deck_generated",
        payload: { jobId: "j", deckId: "d", slug: "gorgon-gaze", title: "Gorgon Gaze", done: 99, failed: 1 },
      },
      { isAdmin: false },
    );
    expect(d.subject).toBe("Your deck");
    expect(d.body).toBe('"Gorgon Gaze" finished generating — 99 cards ready, 1 needs a retry.');
    expect(d.href).toBe("/deck/gorgon-gaze");
  });

  it("warns about a trial ending — honest about whether a card is on file — and links to billing", () => {
    const base = { actor: null, card: null, threadId: null, type: "trial_ending" };
    const withCard = describeNotification(
      { ...base, payload: { tier: "pro", trialEnd: "2026-09-29T12:00:00Z", hasPaymentMethod: true } },
      { isAdmin: false },
    );
    expect(withCard.subject).toBe("Your Pro trial");
    expect(withCard.body).toBe("ends on Sep 29, 2026 — your card is charged then; change or cancel any time.");
    expect(withCard.href).toBe("/dashboard/billing");

    const noCard = describeNotification(
      { ...base, payload: { tier: "plus", trialEnd: "2026-09-29T12:00:00Z", hasPaymentMethod: false } },
      { isAdmin: false },
    );
    expect(noCard.subject).toBe("Your Plus trial");
    expect(noCard.body).toBe("ends on Sep 29, 2026 — add a card to keep the plan, or it simply ends and your cards stay.");

    expect(describeNotification({ ...base, payload: {} }, { isAdmin: false })).toMatchObject({
      subject: "Your plan trial",
      body: "ends soon — add a card to keep the plan, or it simply ends and your cards stay.",
    });
  });

  it("payment received: renewals name the plan and the charge (credits are one-time), first payments and plan changes say thanks", () => {
    const base = { actor: null, card: null, threadId: null, type: "payment_received" };
    const renewal = describeNotification(
      { ...base, payload: { invoiceId: "in_1", amountCents: 1500, currency: "usd", tier: "pro", billingReason: "subscription_cycle" } },
      { isAdmin: false },
    );
    expect(renewal).toEqual({
      subject: "Your Pro plan",
      body: "renewed — $15 charged.",
      href: "/dashboard/billing",
    });
    expect(
      describeNotification({ ...base, payload: { amountCents: 600, tier: "plus", billingReason: "subscription_create" } }, { isAdmin: false }).body,
    ).toBe("$6 for Plus — thanks! Your receipt is on the billing page.");
    expect(
      describeNotification({ ...base, payload: { amountCents: 900, tier: "pro", billingReason: "subscription_update" } }, { isAdmin: false }).body,
    ).toBe("$9 for your switch to Pro — thanks!");
    expect(describeNotification({ ...base, payload: { amountCents: 1250 } }, { isAdmin: false })).toMatchObject({
      subject: "Payment received",
      body: "$12.50 — thanks! Your receipt is on the billing page.",
    });
  });

  it("checkout reminder: the trial if still available, otherwise where they left off; packs count the credits", () => {
    const base = { actor: null, card: null, threadId: null, type: "checkout_reminder" };
    expect(
      describeNotification({ ...base, payload: { kind: "subscription", tier: "pro", trialEligible: true } }, { isAdmin: false }),
    ).toEqual({
      subject: "Your Pro checkout",
      body: "wasn't finished — your banked free days are still waiting; nothing is charged until they end, cancel anytime.",
      href: "/dashboard/billing#plans",
    });
    expect(
      describeNotification({ ...base, payload: { kind: "subscription", tier: "plus", trialEligible: false } }, { isAdmin: false }).body,
    ).toBe("wasn't finished — pick up where you left off whenever you're ready.");
    expect(
      describeNotification({ ...base, payload: { kind: "pack", packCredits: 30 } }, { isAdmin: false }),
    ).toEqual({
      subject: "Your credit top-up",
      body: "wasn't finished — 30 credits are one click away.",
      href: "/dashboard/billing#packs",
    });
  });

  it("trial lapsed: the win-back offer with its deadline, linking to the plans", () => {
    const d = describeNotification(
      { actor: null, card: null, threadId: null, type: "trial_lapsed", payload: { subscriptionId: "sub_1", tier: "pro", discountPct: 20, expiresAt: "2026-10-24T12:00:00Z" } },
      { isAdmin: false },
    );
    expect(d).toEqual({
      subject: "Your Pro trial",
      body: "ended — come back by Oct 24, 2026 for 20% off your first month on a monthly plan; the discount is applied automatically at checkout.",
      href: "/dashboard/billing#plans",
    });
    // A payer whose plan ended (BA6): the same offer in its own words.
    const c = describeNotification(
      { actor: null, card: null, threadId: null, type: "trial_lapsed", payload: { subscriptionId: "sub_1", tier: "plus", discountPct: 20, expiresAt: "2026-10-24T12:00:00Z", reason: "cancelled" } },
      { isAdmin: false },
    );
    expect(c).toEqual({
      subject: "Your Plus plan",
      body: "ended — come back by Oct 24, 2026 for 20% off your first month back on a monthly plan; the discount is applied automatically at checkout.",
      href: "/dashboard/billing#plans",
    });
  });

  it("render sweep paused: the breaker's reason, linking admins to the re-bake page", () => {
    const base = { actor: null, card: null, threadId: null, type: "render_sweep_paused" };
    expect(
      describeNotification(
        { ...base, payload: { reason: "A whole batch failed (8 cards): Row update failed: boom", failed: 8, rebaked: 0 } },
        { isAdmin: true },
      ),
    ).toEqual({
      subject: "Automatic re-bake",
      body: "paused itself — A whole batch failed (8 cards): Row update failed: boom. Check the failures, then resume it.",
      href: "/admin/renders",
    });
    expect(describeNotification({ ...base, payload: {} }, { isAdmin: true }).body).toBe(
      "paused itself. Check the failures, then resume it.",
    );
  });

  it("credit refill failed (cron): the failure count and first error, linking admins to the users page", () => {
    const base = { actor: null, card: null, threadId: null, type: "credit_refill_failed" };
    const cron = {
      source: "cron",
      dedupeKey: "cron:2026-10-18",
      period: "2026-10",
      day: "2026-10-18",
      processed: 40,
      granted: 5,
      failed: 2,
      pageError: null,
      userIds: ["u-1", "u-2"],
      error: "permission denied for function grant_credits",
    };
    const d = describeNotification({ ...base, payload: cron }, { isAdmin: true });
    expect(d).toEqual({
      subject: "Credit refill",
      body: "2 grants failed — permission denied for function grant_credits. Tomorrow's run retries; check the function logs.",
      href: "/admin/users",
    });
    // The toast and the bell print the same sentence (realtime-alerts.tsx reads describeNotification).
    expect(notificationSentence({ ...base, payload: cron }, { isAdmin: true })).toBe(`${d.subject} ${d.body}`);
    expect(
      describeNotification({ ...base, payload: { ...cron, failed: 1, error: null } }, { isAdmin: true }).body,
    ).toBe("1 grant failed. Tomorrow's run retries; check the function logs.");
    expect(
      describeNotification(
        { ...base, payload: { ...cron, failed: 0, error: null, pageError: "statement timeout" } },
        { isAdmin: true },
      ).body,
    ).toBe("a profiles read failed (statement timeout). Tomorrow's run retries; check the function logs.");
    expect(describeNotification({ ...base, payload: {} }, { isAdmin: true }).body).toBe(
      "failed. Tomorrow's run retries; check the function logs.",
    );
  });

  it("credit refill failed (invoice): names the invoice and opens the account", () => {
    const base = { actor: null, card: null, threadId: null, type: "credit_refill_failed" };
    const userId = "d0000000-0000-4000-a000-000000000002";
    expect(
      describeNotification(
        { ...base, payload: { source: "invoice", dedupeKey: "invoice:in_1", invoiceId: "in_1", userId, error: "boom" } },
        { isAdmin: true },
      ),
    ).toEqual({
      subject: "Credit grant failed",
      body: "on a paid invoice (in_1) — boom. Plan credits are one-time: run scripts/grant-plan-credits-once.mjs (keyed — it grants nothing twice), never a hand grant, which the next paid invoice would double.",
      href: `/admin/users?u=${userId}`,
    });
    expect(
      describeNotification({ ...base, payload: { source: "invoice", userId: "not-a-uuid" } }, { isAdmin: true }).href,
    ).toBe("/admin/users");
  });
});

// TODO DK8.6 (migration 0149): the two deck kinds — written by triggers with
// payload { deckId, slug, title }; the card is the added card's own row.
describe("describeNotification — deck likes and cards added to decks", () => {
  const deckPayload = { deckId: "b0000000-0000-4000-a000-000000000004", slug: "artificers-arsenal", title: "Artificer's Arsenal" };

  it("deck_like: the liker liked your deck, linking the deck", () => {
    expect(
      describeNotification({ type: "deck_like", actor, card: null, threadId: null, payload: deckPayload }, { isAdmin: false }),
    ).toEqual({
      subject: "Ana",
      body: 'liked your deck "Artificer\'s Arsenal".',
      href: "/deck/artificers-arsenal",
    });
    // A payload without its words still reads, and goes to My decks.
    expect(describeNotification({ type: "deck_like", actor: null, card: null, threadId: null, payload: {} }, { isAdmin: false })).toEqual({
      subject: "Someone",
      body: "liked your deck.",
      href: "/dashboard/decks",
    });
  });

  it("challenge_winner (TODO NV12, 0172): your card's place in which challenge, linking the challenge", () => {
    const payload = { challengeId: "c", slug: "tiny-titans", title: "Tiny Titans", place: 1 };
    expect(describeNotification({ type: "challenge_winner", actor: null, card, threadId: null, payload }, { isAdmin: false })).toEqual({
      subject: "Your card Storm Crow",
      body: 'won 1st place in the "Tiny Titans" design challenge.',
      href: "/challenges/tiny-titans",
    });
    expect(describeNotification({ type: "challenge_winner", actor: null, card: null, threadId: null, payload: {} }, { isAdmin: false })).toEqual({
      subject: "Your card",
      body: "is a winner in the design challenge.",
      href: "/challenges",
    });
  });

  it("payment_failed (0174): the amount, the retry, the grace, and the billing page", () => {
    const base = { actor: null, card: null, threadId: null, type: "payment_failed" };
    expect(
      describeNotification(
        { ...base, payload: { invoiceId: "in_1", amountCents: 1500, currency: "usd", tier: "pro", nextAttemptAt: "2026-11-08T12:00:00Z", graceUntil: "2026-11-19T12:00:00Z" } },
        { isAdmin: false },
      ),
    ).toEqual({
      subject: "Your Pro payment",
      body: "of $15 didn't go through — we'll try your card again on Nov 8, 2026; your Pro perks stay on until Nov 19, 2026. Update your card to be safe.",
      href: "/dashboard/billing",
    });
    expect(describeNotification({ ...base, payload: { invoiceId: "in_2", amountCents: 600 } }, { isAdmin: false }).body).toBe(
      "of $6 didn't go through — we'll retry your card automatically; your plan perks are paused until it's paid. Update your card to restore them.",
    );
  });

  it("billing_alert (0174, admins): refund / dispute / outcome / fraud warning, linking the account", () => {
    const base = { actor: null, card: null, threadId: null, type: "billing_alert" };
    const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      describeNotification({ ...base, payload: { alert: "refund", amountCents: 400, currency: "usd", userId: user, saleKind: "pack", creditsDelta: -15 } }, { isAdmin: true }),
    ).toEqual({ subject: "Refund", body: "of $4 on a credit pack. 15 unspent credits taken back.", href: `/admin/users?u=${user}` });
    expect(
      describeNotification({ ...base, payload: { alert: "dispute", amountCents: 1500, userId: user, saleKind: "invoice", disputeReason: "fraudulent" } }, { isAdmin: true }),
    ).toEqual({ subject: "Dispute opened", body: "on $15 (a plan invoice) — fraudulent. Respond in Stripe.", href: `/admin/users?u=${user}` });
    expect(
      describeNotification({ ...base, payload: { alert: "dispute_closed", disputeStatus: "won", amountCents: 800, userId: user, saleKind: "pack", creditsDelta: 30 } }, { isAdmin: true }).body,
    ).toBe("won — $8 on a credit pack. 30 credits given back.");
    expect(describeNotification({ ...base, payload: { alert: "fraud_warning", amountCents: 800, saleKind: null } }, { isAdmin: true })).toEqual({
      subject: "Early fraud warning",
      body: "from the card network on $8 (an unmatched charge) (no account matched — see Stripe). Expect a dispute; consider a refund now.",
      href: "/admin/users",
    });
  });

  it("deck_cloned (TODO DK5.16, 0164): who copied which of your decks, linking YOUR deck (the copy starts private)", () => {
    expect(
      describeNotification({ type: "deck_cloned", actor, card: null, threadId: null, payload: deckPayload }, { isAdmin: false }),
    ).toEqual({ subject: "Ana", body: 'copied your deck "Artificer\'s Arsenal" to remix it.', href: "/deck/artificers-arsenal" });
    expect(describeNotification({ type: "deck_cloned", actor: null, card: null, threadId: null, payload: {} }, { isAdmin: false })).toEqual({
      subject: "Someone",
      body: "copied your deck to remix it.",
      href: "/dashboard/decks",
    });
  });

  it("deck_card_added, one card: who added which card to which deck, linking the deck", () => {
    const one = { ...deckPayload, cardIds: ["c1"], count: 1 };
    expect(
      notificationSentence({ type: "deck_card_added", actor, card, threadId: null, payload: one }, { isAdmin: false }),
    ).toBe('Ana added Storm Crow to "Artificer\'s Arsenal".');
    expect(
      describeNotification({ type: "deck_card_added", actor, card, threadId: null, payload: one }, { isAdmin: false }).href,
    ).toBe("/deck/artificers-arsenal");
    // No deck slug (never written so, but read defensively): the card.
    expect(
      describeNotification({ type: "deck_card_added", actor, card, threadId: null, payload: { count: 1 } }, { isAdmin: false }),
    ).toEqual({ subject: "Ana", body: "added Storm Crow to their deck.", href: "/card/me/storm-crow" });
  });

  it("deck_card_added, many cards: ONE row per deck says how many (0149 merges them)", () => {
    const many = { ...deckPayload, cardIds: Array.from({ length: 14 }, (_, i) => `c${i}`), count: 14 };
    // The row carries no single card when it stands for several.
    expect(
      describeNotification({ type: "deck_card_added", actor, card: null, threadId: null, payload: many }, { isAdmin: false }),
    ).toEqual({ subject: "Ana", body: 'added 14 of your cards to "Artificer\'s Arsenal".', href: "/deck/artificers-arsenal" });
    // The count falls back to the ids when it is missing.
    expect(
      describeNotification(
        { type: "deck_card_added", actor, card: null, threadId: null, payload: { ...deckPayload, cardIds: ["a", "b"] } },
        { isAdmin: false },
      ).body,
    ).toBe('added 2 of your cards to "Artificer\'s Arsenal".');
  });
});

// 2026-11-11: a notification's sentence is built in a component that
// hydrates (the row on /notifications), and its dates were printed in the
// RUNTIME's zone — UTC on the server, the reader's in the browser — so a
// trial ending at 03:00 UTC was "Sep 29" in the HTML and "Sep 28" in a
// Mountain-time browser: React's hydration error #418. The zone is the
// caller's to name now.
describe("describeNotification — the zone its dates are printed in", () => {
  const item = {
    actor: null,
    card: null,
    threadId: null,
    type: "trial_ending",
    payload: { tier: "pro", trialEnd: "2026-09-29T03:00:00Z", hasPaymentMethod: true },
  };

  it("prints the day of the zone it is given — the server's HTML and the hydrating render name the same one", () => {
    expect(describeNotification(item, { isAdmin: false, timeZone: "UTC" }).body).toContain("ends on Sep 29, 2026");
    expect(describeNotification(item, { isAdmin: false, timeZone: "America/Denver" }).body).toContain("ends on Sep 28, 2026");
    expect(notificationSentence(item, { isAdmin: false, timeZone: "UTC" })).toContain("Sep 29, 2026");
  });

  it("with no zone it is the runtime's own — a toast in the browser, an email on the server", () => {
    const runtime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
      new Date("2026-09-29T03:00:00Z"),
    );
    expect(describeNotification(item, { isAdmin: false }).body).toContain(`ends on ${runtime}`);
  });

  it("the row that is server-rendered names the zone; every date in the module goes through it", async () => {
    const { readFileSync } = await import("node:fs");
    const row = readFileSync("components/notifications/notification-row.tsx", "utf8");
    expect(row).toContain("const timeZone = useViewerTimeZone();");
    expect(row).toContain("describeNotification(item, { isAdmin, timeZone })");
    const source = readFileSync("lib/notifications/describe.ts", "utf8");
    expect(source).not.toMatch(/formatShortDate|toLocale(Date|Time)String|\.toLocaleString\(\s*\)|new Intl\.DateTimeFormat/);
    expect(source).toContain('const day = (value: string) => formatDateIn(value, "short", opts.timeZone);');
  });
});
