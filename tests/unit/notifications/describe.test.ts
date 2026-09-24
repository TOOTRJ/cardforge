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
    expect(
      describeNotification(
        { type: "comp_plan", actor, card: null, threadId: null, payload: { tier: "pro", expiresAt: "2026-12-01T12:00:00Z" } },
        { isAdmin: false },
      ).body,
    ).toMatch(/^gave you Pro plan access until Dec 1, 2026 — enjoy\.$/);
    expect(
      describeNotification({ type: "comp_plan", actor, card: null, threadId: null, payload: { tier: null } }, { isAdmin: false }).body,
    ).toBe("ended your complimentary plan access.");
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

  it("payment received: renewals name the plan and the refill, first payments and plan changes say thanks", () => {
    const base = { actor: null, card: null, threadId: null, type: "payment_received" };
    const renewal = describeNotification(
      { ...base, payload: { invoiceId: "in_1", amountCents: 1500, currency: "usd", tier: "pro", billingReason: "subscription_cycle" } },
      { isAdmin: false },
    );
    expect(renewal).toEqual({
      subject: "Your Pro plan",
      body: "renewed — $15 charged; your monthly AI credits are refilled.",
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
      body: "wasn't finished — your 7-day free trial is still waiting; nothing is charged until it ends, cancel anytime.",
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
      body: "ended — come back by Oct 24, 2026 for 20% off your first month; the discount is applied automatically at checkout.",
      href: "/dashboard/billing#plans",
    });
  });
});

