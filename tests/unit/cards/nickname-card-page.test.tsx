import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NicknameLine } from "@/components/cards/card-detail-content";
import { nicknamePageLine } from "@/lib/cards/nickname";
import { getFrameProfile } from "@/lib/cards/template-layout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// TODO 6.3 (owner Round 80): the card page's line under its H1 says
// "Printed as" only where the card's frame PRINTS the nickname; on a frame
// that prints none (the 2003 frame, a borderless frame) the card shows its
// name, and the nickname is "Also known as".
// ---------------------------------------------------------------------------

const text = (nickname: string | null, template: string) =>
  renderToStaticMarkup(<NicknameLine nickname={nickname} frameStyle={{ template }} />).replace(/<[^>]+>/g, "");

describe("the card page's nickname line", () => {
  it("\"Printed as\" on a frame that prints the plate", () => {
    expect(text("Wakandan War Panther", "m15")).toBe("Printed as “Wakandan War Panther”");
    expect(text("Summoner’s Rift", "m15land")).toBe("Printed as “Summoner’s Rift”");
  });

  it("\"Also known as\" on a frame that prints none", () => {
    for (const template of ["modern", "retro", "m15borderless", "m15token", "saga"]) {
      expect(text("Wakandan War Panther", template), template).toBe("Also known as “Wakandan War Panther”");
    }
  });

  it("nothing without a nickname", () => {
    expect(text(null, "m15")).toBe("");
    expect(text("  ", "m15")).toBe("");
    expect(nicknamePageLine(null, getFrameProfile("m15"))).toBeNull();
  });
});
