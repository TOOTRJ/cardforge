// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));
vi.mock("@/lib/cards/actions", () => ({ recordCardShareAction: vi.fn(async () => {}) }));

import { ShareTargets } from "@/components/cards/share-targets";

// ---------------------------------------------------------------------------
// The share dialog with and without the viewer's referral (TODO SG1): every
// link carries `ref` plus its `via`, the text gains the friend's line, the
// Copy link row shows the clean address and says the link is theirs; a
// visitor (or the program off) gets the plain links and words of before.
// The friend's line promises their days for the CARDS alone (owner
// 2026-11-11: no plan), and the card's own line says "I forged" only where
// the sharer made the card (`own`: the creator's post-save prompt) — a card
// page does not know whose card its visitor is sharing.
// ---------------------------------------------------------------------------

const URL_ = "https://pipglyph.com/card/dev_free/hedge-witchs-familiar";
const ON = { enabled: true, friendGets: "7 free days", cardsRequired: 5, windowDays: 30, signupDays: 7, code: "ab12cd34", ladder: null };

afterEach(() => cleanup());

function hrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of screen.getAllByRole("link")) {
    const label = a.textContent?.trim() ?? "";
    out[label] = a.getAttribute("href") ?? "";
  }
  return out;
}

/** The message each network's form is prefilled with (the ones that take a text). */
function prefilled(): Record<"X" | "Bluesky" | "WhatsApp" | "Telegram", string> {
  const h = hrefs();
  const text = (label: string) => new URL(h[label]).searchParams.get("text") ?? "";
  return { X: text("X"), Bluesky: text("Bluesky"), WhatsApp: text("WhatsApp"), Telegram: text("Telegram") };
}

const FRIEND_LINE = "Join with my link and you get 7 free days toward a plan once you've saved your first cards.";

describe("ShareTargets with the viewer's referral", () => {
  it("every network link carries via AND ref, and the prefilled text names what the friend gets", () => {
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={ON} />);
    const h = hrefs();
    const x = new URL(h.X);
    const xUrl = new URL(x.searchParams.get("url") ?? "");
    expect(xUrl.searchParams.get("via")).toBe("x");
    expect(xUrl.searchParams.get("ref")).toBe("ab12cd34");
    expect(x.searchParams.get("text")).toBe(`Hedge Witch's Familiar — a custom Magic card on PipGlyph\n${FRIEND_LINE}`);
    // The friend's days are for their cards: no plan is asked of them.
    for (const text of Object.values(prefilled())) {
      expect(text).toContain(FRIEND_LINE);
      expect(text).not.toMatch(/and started one|start(?:ed)? a plan|card on file/);
    }
    const reddit = new URL(new URL(h.Reddit).searchParams.get("url") ?? "");
    expect(reddit.searchParams.get("ref")).toBe("ab12cd34");
    expect(reddit.searchParams.get("via")).toBe("reddit");
    const wa = new URL(h.WhatsApp).searchParams.get("text") ?? "";
    expect(wa).toContain("ref=ab12cd34");
    expect(wa).toContain("7 free days");
    // The dialog says what the links carry: the friend's days for their
    // cards, and the sharer's next reward.
    const said = screen.getByText(/These links carry your referral link/).textContent ?? "";
    expect(said).toContain(
      "These links carry your referral link: a friend who joins through one gets 7 free days toward a plan once they save their first cards, and you earn your next reward.",
    );
    expect(said).not.toMatch(/and start one|and so do you|card on file/);
    // Copy link: the row shows the CLEAN address and says the link is the viewer's.
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(copy.textContent).toContain("Copy link (with your referral link)");
    expect(copy.textContent).toContain(URL_);
    expect(copy.textContent).not.toContain("via=");
    expect(copy.getAttribute("title")).toMatch(/your referral code/);
  });

  it("names the viewer's rung and the next reward when the answer carries a ladder (SG4) — and nothing of it without one", () => {
    render(
      <ShareTargets
        open
        onOpenChange={() => {}}
        title="T"
        url={URL_}
        itemId="c1"
        referral={{ ...ON, ladder: { rewardsEarned: 2, ladderLength: 10, nextRewardPhrase: "+7 free days", pastLadder: false } }}
      />,
    );
    expect(screen.getByText(/2 of 10 referrals rewarded — next: \+7 free days\./)).toBeTruthy();
    cleanup();
    render(<ShareTargets open onOpenChange={() => {}} title="T" url={URL_} itemId="c1" referral={ON} />);
    expect(screen.queryByText(/referrals rewarded/)).toBeNull();
  });

  it("a visitor (no referral) shares the plain links and words of before", () => {
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} />);
    const h = hrefs();
    const xUrl = new URL(new URL(h.X).searchParams.get("url") ?? "");
    expect(xUrl.searchParams.get("via")).toBe("x");
    expect(xUrl.searchParams.has("ref")).toBe(false);
    expect(new URL(h.X).searchParams.get("text")).toBe("Hedge Witch's Familiar — a custom Magic card on PipGlyph");
    expect(screen.queryByText(/These links carry your referral link/)).toBeNull();
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(copy.textContent).toContain("Copy link");
    expect(copy.textContent).not.toContain("with your referral link");
    expect(copy.textContent).toContain(URL_);
  });

  it("the program OFF (or a code-less answer) is a plain share even for a signed-in viewer", () => {
    render(
      <ShareTargets open onOpenChange={() => {}} title="T" url={URL_} itemId="c1" referral={{ enabled: false, friendGets: null, cardsRequired: null, windowDays: null, signupDays: null, code: null, ladder: null }} />,
    );
    expect(new URL(new URL(hrefs().X).searchParams.get("url") ?? "").searchParams.has("ref")).toBe(false);
  });

  it("own: the maker's own card says 'I forged' in every prefilled message — with the friend's line after it on a referral link", () => {
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} own />);
    const plain = prefilled();
    const mine = "Hedge Witch's Familiar — a custom Magic card I forged on PipGlyph";
    expect(plain.X).toBe(mine);
    expect(plain.Telegram).toBe(mine);
    expect(plain.Bluesky.split("\n")[0]).toBe(mine);
    expect(plain.WhatsApp.split("\n")[0]).toBe(mine);
    cleanup();

    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={ON} own />);
    const referred = prefilled();
    expect(referred.X).toBe(`${mine}\n${FRIEND_LINE}`);
    expect(referred.Telegram).toBe(`${mine}\n${FRIEND_LINE}`);
    expect(referred.Bluesky.startsWith(`${mine}\n${FRIEND_LINE}\n`)).toBe(true);
    expect(referred.WhatsApp.startsWith(`${mine}\n${FRIEND_LINE}\n`)).toBe(true);
  });

  it("not own (the default, or said so): the message claims nothing about who made the card", () => {
    const anyones = "Hedge Witch's Familiar — a custom Magic card on PipGlyph";
    for (const own of [undefined, false]) {
      render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} own={own} />);
      const texts = prefilled();
      expect(texts.X).toBe(anyones);
      expect(texts.Telegram).toBe(anyones);
      expect(texts.Bluesky.split("\n")[0]).toBe(anyones);
      expect(texts.WhatsApp.split("\n")[0]).toBe(anyones);
      for (const text of Object.values(texts)) expect(text).not.toMatch(/I forged/);
      cleanup();
    }
    // …with the viewer's referral too: the friend's line follows the same words.
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={ON} />);
    expect(prefilled().Telegram).toBe(`${anyones}\n${FRIEND_LINE}`);
  });

  it("the Discord message says 'I made' only on the maker's own card", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
    const copy = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy a Discord-formatted message" }));
      await waitFor(() => expect(copied.length).toBeGreaterThan(0));
      return copied.pop() as string;
    };
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} own />);
    expect((await copy()).split("\n")[0]).toBe("**Hedge Witch's Familiar** — a custom Magic card I made on PipGlyph");
    cleanup();
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} />);
    expect((await copy()).split("\n")[0]).toBe("**Hedge Witch's Familiar** — a custom Magic card on PipGlyph");
    cleanup();
    render(<ShareTargets open onOpenChange={() => {}} title="Goblin Rush" url="https://pipglyph.com/deck/goblin-rush" entity="deck" itemId="d1" referral={null} />);
    expect((await copy()).split("\n")[0]).toBe("**Goblin Rush** — a custom Magic deck on PipGlyph");
  });

  it("a deck's message is the deck's own words, whoever shares it", () => {
    const deckUrl = "https://pipglyph.com/deck/goblin-rush";
    const words = "Goblin Rush — a Magic deck with custom cards on PipGlyph";
    for (const own of [undefined, false, true]) {
      render(<ShareTargets open onOpenChange={() => {}} title="Goblin Rush" url={deckUrl} entity="deck" itemId="d1" referral={null} own={own} />);
      const texts = prefilled();
      expect(texts.X).toBe(words);
      expect(texts.Telegram).toBe(words);
      for (const text of Object.values(texts)) expect(text).not.toMatch(/I forged|custom Magic card/);
      cleanup();
    }
    render(<ShareTargets open onOpenChange={() => {}} title="Goblin Rush" url={deckUrl} entity="deck" itemId="d1" referral={ON} own />);
    expect(prefilled().X).toBe(`${words}\n${FRIEND_LINE}`);
  });

  it("the post-save prompt leads with the card's own picture (SG2)", () => {
    render(
      <ShareTargets
        open
        onOpenChange={() => {}}
        title="T"
        url={URL_}
        itemId="c1"
        referral={null}
        picture={{ src: "https://pipglyph.com/api/cards/c1/og", alt: "T, your new card" }}
      />,
    );
    expect((screen.getByRole("img", { name: "T, your new card" }) as HTMLImageElement).src).toBe("https://pipglyph.com/api/cards/c1/og");
  });
});

describe("who says the card is their own", () => {
  /** Every `<ShareTargets … />` in a source file: its props, line by line. */
  const dialogsIn = (file: string): string[][] => {
    const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
    const found: string[][] = [];
    lines.forEach((line, at) => {
      if (line.trim() !== "<ShareTargets") return;
      const indent = line.slice(0, line.indexOf("<"));
      const end = lines.findIndex((l, i) => i > at && l === `${indent}/>`);
      expect(end, `${file}: the dialog opened on line ${at + 1} has no closing line`).toBeGreaterThan(at);
      found.push(lines.slice(at + 1, end).map((l) => l.trim()));
    });
    return found;
  };
  const saysOwn = (props: string[]) => props.some((prop) => /^own(?:$|[\s=])/.test(prop));

  it("the creator's post-save prompt does: the card just published is its maker's", () => {
    const dialogs = dialogsIn("components/creator/card-creator-form.tsx");
    expect(dialogs).toHaveLength(1);
    expect(saysOwn(dialogs[0])).toBe(true);
    expect(dialogs[0]).toContain('heading="Your card is live"');
  });

  it("a page anyone can open does not: its visitor may be sharing someone else's card", () => {
    for (const file of ["components/cards/card-detail-content.tsx", "components/gallery/trending-share-button.tsx", "app/(marketing)/deck/[slug]/page.tsx"]) {
      const dialogs = dialogsIn(file);
      expect(dialogs.length, file).toBeGreaterThanOrEqual(1);
      for (const props of dialogs) expect(saysOwn(props), file).toBe(false);
    }
  });
});
