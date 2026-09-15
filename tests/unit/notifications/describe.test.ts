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
