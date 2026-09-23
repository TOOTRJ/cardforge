import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  activityDigestEmail,
  checkoutReminderEmail,
  newsletterEmail,
  teamMessageEmail,
  trialEndingEmail,
  welcomeEmail,
} from "@/lib/email/messages";
import { isUnsubscribeToken, parseEmailList, unsubscribeLinks } from "@/lib/email/lists";
import { escapeHtml, renderEmailLayout } from "@/lib/email/layout";
import { verifySvixSignature } from "@/lib/email/webhook-signature";

const recipient = {
  email: "someone@example.com",
  unsubscribeToken: "11111111-2222-4333-8444-555555555555",
};

describe("email builders", () => {
  it("every list email carries the one-click unsubscribe headers + footer link", () => {
    const emails = [
      welcomeEmail(recipient, { displayName: "Forge", username: "forge" }),
      teamMessageEmail(recipient, { threadId: "t1", subject: "Hi", body: "Hello" }),
      activityDigestEmail(recipient, {
        lines: [{ subject: "Ann", body: "liked Bolt.", href: "/card/ann/bolt" }],
        total: 1,
      }),
      newsletterEmail(recipient, {
        kind: "update",
        title: "New frames",
        summary: "Three new eras.",
        body: null,
        linkHref: "/news",
      }),
      trialEndingEmail(recipient, {
        plan: "Pro",
        trialEndsAt: "2026-09-29T12:00:00Z",
        hasPaymentMethod: true,
        priceLabel: "$15 / month",
      }),
      checkoutReminderEmail(recipient, { kind: "subscription", plan: "Pro", priceLabel: "$15 / month", trialEligible: true }),
      checkoutReminderEmail(recipient, { kind: "pack", credits: 30, priceLabel: "$8" }),
    ];
    for (const email of emails) {
      expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(email.headers?.["List-Unsubscribe"]).toMatch(
        /^<https?:\/\/.+\/api\/email\/unsubscribe\?token=.+&list=(account|activity|newsletter)>$/,
      );
      expect(email.html).toContain("/unsubscribe?token=");
      expect(email.text).toContain("Unsubscribe:");
      expect(email.html).toContain("Fan Content");
      expect(email.to).toBe(recipient.email);
    }
  });

  it("escapes user-supplied content", () => {
    const email = teamMessageEmail(recipient, {
      threadId: "t1",
      subject: "<script>alert(1)</script>",
      body: "Line one\n<b>bold</b>",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Line one<br>&lt;b&gt;");
  });

  it("digest collapses long lists into 'and N more'", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      subject: `User ${i}`,
      body: "liked your card.",
      href: "/notifications",
    }));
    const email = activityDigestEmail(recipient, { lines, total: 20 });
    expect(email.subject).toBe("20 new notifications on PipGlyph");
    expect(email.html).toContain("and 8 more");
    expect(email.html).not.toContain("User 19");
  });

  it("digest links straight to the Activity digest switch in settings", () => {
    const email = activityDigestEmail(recipient, {
      lines: [{ subject: "Ann", body: "liked Bolt.", href: "/card/ann/bolt" }],
      total: 1,
    });
    expect(email.html).toContain("Turn off <strong>Activity digest</strong>");
    expect(email.html).toMatch(/href="https?:\/\/[^"]+\/settings#email"/);
    expect(email.text).toContain('Turn off "Activity digest" in your email settings:');
    expect(email.text).toContain("/settings#email");
  });

  it("trial-ending email says what happens on the date: charged (card on file) or simply ends (no card)", () => {
    const converts = trialEndingEmail(recipient, {
      plan: "Pro",
      trialEndsAt: "2026-09-29T12:00:00Z",
      hasPaymentMethod: true,
      priceLabel: "$15 / month",
    });
    expect(converts.subject).toBe("Your PipGlyph Pro trial ends September 29, 2026");
    expect(converts.html).toContain("your card is charged $15 / month");
    expect(converts.html).toContain("/dashboard/billing");
    expect(converts.text).toContain("cancel any time before the date and you won't be charged");
    expect(converts.text).not.toContain("<strong>");

    const ends = trialEndingEmail(recipient, {
      plan: "Plus",
      trialEndsAt: "2026-09-29T12:00:00Z",
      hasPaymentMethod: false,
      priceLabel: null,
    });
    expect(ends.subject).toBe("Your PipGlyph Plus trial ends September 29, 2026 — add a card to keep it");
    expect(ends.html).toContain("nothing is charged");
    expect(ends.html).toContain("To keep Plus, add a card before the date");
    expect(ends.headers?.["List-Unsubscribe"]).toContain("list=account");
  });

  it("checkout reminder: trial copy only while eligible, 'nothing was charged' always, packs count the credits", () => {
    const trial = checkoutReminderEmail(recipient, { kind: "subscription", plan: "Pro", priceLabel: "$15 / month", trialEligible: true });
    expect(trial.subject).toBe("Your PipGlyph Pro trial is still waiting");
    expect(trial.html).toContain("nothing was charged");
    expect(trial.html).toContain("7-day free trial");
    expect(trial.html).toContain("/dashboard/billing#plans");
    expect(trial.text).toContain("Start the Pro trial");

    const lapsed = checkoutReminderEmail(recipient, { kind: "subscription", plan: "Plus", priceLabel: null, trialEligible: false });
    expect(lapsed.subject).toBe("Finish upgrading to PipGlyph Plus");
    expect(lapsed.html).not.toContain("free trial");
    expect(lapsed.html).toContain("cancel any time");

    const pack = checkoutReminderEmail(recipient, { kind: "pack", credits: 30, priceLabel: "$8" });
    expect(pack.subject).toBe("Your 30 PipGlyph credits are waiting");
    expect(pack.html).toContain("<strong>30 AI credits</strong> ($8)");
    expect(pack.html).toContain("/dashboard/billing#packs");
  });

  it("newsletter uses the marketing sender's postal address when set", () => {
    const email = newsletterEmail(recipient, {
      kind: "upcoming",
      title: "Soon",
      summary: "Teaser",
      body: "Para one\n\nPara two",
      linkHref: null,
    });
    expect(email.html).toContain("See what&#39;s coming".replace("&#39;", "'"));
    expect(email.html).toContain("Para one");
    expect(email.html).toContain("Para two");
  });
});

describe("email lists", () => {
  it("parses list names and tokens strictly", () => {
    expect(parseEmailList("newsletter")).toBe("newsletter");
    expect(parseEmailList("auth")).toBeNull();
    expect(isUnsubscribeToken(recipient.unsubscribeToken)).toBe(true);
    expect(isUnsubscribeToken("nope")).toBe(false);
    expect(isUnsubscribeToken(42)).toBe(false);
  });

  it("builds page + one-click links from the same token", () => {
    const links = unsubscribeLinks(recipient.unsubscribeToken, "activity");
    expect(links.page).toContain(`/unsubscribe?token=${recipient.unsubscribeToken}&list=activity`);
    expect(links.oneClick).toContain("/api/email/unsubscribe?token=");
  });
});

describe("layout", () => {
  it("renders a full document with preheader and CTA", () => {
    const html = renderEmailLayout({
      siteUrl: "https://pipglyph.com",
      preheader: "Preview line",
      heading: "Hello",
      paragraphs: ["Body"],
      cta: { label: "Go", url: "https://pipglyph.com/create" },
      footerNote: "Why",
    });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("Preview line");
    expect(html).toContain('href="https://pipglyph.com/create"');
    expect(html).toContain("pipglyph-medallion-512.png");
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("verifySvixSignature", () => {
  const secretBytes = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const rawBody = '{"type":"email.bounced"}';
  const id = "msg_1";
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const sign = (body: string) =>
    createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");

  it("accepts a matching v1 signature among several", () => {
    expect(
      verifySvixSignature({
        rawBody,
        id,
        timestamp,
        signature: `v1,AAAA v1,${sign(rawBody)}`,
        secret,
        now,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body, a stale timestamp, or missing headers", () => {
    expect(
      verifySvixSignature({ rawBody: rawBody + " ", id, timestamp, signature: `v1,${sign(rawBody)}`, secret, now }),
    ).toBe(false);
    expect(
      verifySvixSignature({ rawBody, id, timestamp, signature: `v1,${sign(rawBody)}`, secret, now: now + 10 * 60 * 1000 }),
    ).toBe(false);
    expect(verifySvixSignature({ rawBody, id: null, timestamp, signature: "v1,x", secret, now })).toBe(false);
  });
});
