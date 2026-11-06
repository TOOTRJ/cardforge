// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));
vi.mock("@/lib/cards/actions", () => ({ recordCardShareAction: vi.fn(async () => {}) }));

import { ShareTargets } from "@/components/cards/share-targets";

// ---------------------------------------------------------------------------
// The share dialog with and without the viewer's referral (TODO SG1): every
// link carries `ref` plus its `via`, the text gains the friend's line, the
// Copy link row shows the clean address and says the link is theirs; a
// visitor (or the program off) gets the plain links and words of before.
// ---------------------------------------------------------------------------

const URL_ = "https://pipglyph.com/card/dev_free/hedge-witchs-familiar";
const ON = { enabled: true, friendGets: "7 free days", cardsRequired: 5, windowDays: 30, signupDays: 7, code: "ab12cd34" };

afterEach(() => cleanup());

function hrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of screen.getAllByRole("link")) {
    const label = a.textContent?.trim() ?? "";
    out[label] = a.getAttribute("href") ?? "";
  }
  return out;
}

describe("ShareTargets with the viewer's referral", () => {
  it("every network link carries via AND ref, and the prefilled text names what the friend gets", () => {
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={ON} />);
    const h = hrefs();
    const x = new URL(h.X);
    const xUrl = new URL(x.searchParams.get("url") ?? "");
    expect(xUrl.searchParams.get("via")).toBe("x");
    expect(xUrl.searchParams.get("ref")).toBe("ab12cd34");
    expect(x.searchParams.get("text")).toBe(
      "Hedge Witch's Familiar — a custom Magic card I forged on PipGlyph\nJoin with my link and you get 7 free days toward a plan once you've saved your first cards and started one.",
    );
    const reddit = new URL(new URL(h.Reddit).searchParams.get("url") ?? "");
    expect(reddit.searchParams.get("ref")).toBe("ab12cd34");
    expect(reddit.searchParams.get("via")).toBe("reddit");
    const wa = new URL(h.WhatsApp).searchParams.get("text") ?? "";
    expect(wa).toContain("ref=ab12cd34");
    expect(wa).toContain("7 free days");
    // The dialog says what the links carry.
    expect(screen.getByText(/These links carry your referral link/)).toBeTruthy();
    // Copy link: the row shows the CLEAN address and says the link is the viewer's.
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(copy.textContent).toContain("Copy link (with your referral link)");
    expect(copy.textContent).toContain(URL_);
    expect(copy.textContent).not.toContain("via=");
    expect(copy.getAttribute("title")).toMatch(/your referral code/);
  });

  it("a visitor (no referral) shares the plain links and words of before", () => {
    render(<ShareTargets open onOpenChange={() => {}} title="Hedge Witch's Familiar" url={URL_} itemId="c1" referral={null} />);
    const h = hrefs();
    const xUrl = new URL(new URL(h.X).searchParams.get("url") ?? "");
    expect(xUrl.searchParams.get("via")).toBe("x");
    expect(xUrl.searchParams.has("ref")).toBe(false);
    expect(new URL(h.X).searchParams.get("text")).toBe("Hedge Witch's Familiar — a custom Magic card I forged on PipGlyph");
    expect(screen.queryByText(/These links carry your referral link/)).toBeNull();
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(copy.textContent).toContain("Copy link");
    expect(copy.textContent).not.toContain("with your referral link");
    expect(copy.textContent).toContain(URL_);
  });

  it("the program OFF (or a code-less answer) is a plain share even for a signed-in viewer", () => {
    render(
      <ShareTargets open onOpenChange={() => {}} title="T" url={URL_} itemId="c1" referral={{ enabled: false, friendGets: null, cardsRequired: null, windowDays: null, signupDays: null, code: null }} />,
    );
    expect(new URL(new URL(hrefs().X).searchParams.get("url") ?? "").searchParams.has("ref")).toBe(false);
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
