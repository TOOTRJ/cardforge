// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// The profile page's "Unlisted cards" section (admins only, debugging —
// components/admin/profile-unlisted-cards.tsx). For anyone but an admin the
// reader answers null and the section is NOTHING: no heading, no empty box.
// For an admin it lists the creator's unlisted cards, each a link to the
// card's own page, with the frame facts a frame report needs.
// ---------------------------------------------------------------------------

const reader = vi.hoisted(() => ({ list: vi.fn(), overrides: vi.fn() }));
vi.mock("@/lib/admin/unlisted-cards", () => ({
  ADMIN_UNLISTED_PARAM: "unlisted",
  listUnlistedCardsForAdmin: reader.list,
}));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: reader.overrides }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: (card: { title: string }) => ({ title: card.title }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => {
    // `scroll` is the router's, not an anchor's attribute.
    const anchor = { ...rest };
    delete anchor.scroll;
    return (
      <a href={href} {...anchor}>
        {children}
      </a>
    );
  },
}));
// The tile draws through CardTile (the one tile nesting); here it is the
// body the section hands it and the picture's title.
vi.mock("@/components/cards/card-tile", () => ({
  CardTile: ({ body, thumbnail }: { body: (slot: { children: ReactNode }) => ReactElement; thumbnail: { title: string; renderedThumbUrl: string | null } }) =>
    body({ children: <span data-thumb={thumbnail.renderedThumbUrl ?? ""} data-title={thumbnail.title} /> }),
}));
vi.mock("@/components/cards/card-grid", () => ({
  CARD_GRID_SIZES: "sizes",
  CardGrid: ({ children }: { children: ReactNode }) => <div data-testid="grid">{children}</div>,
}));

import {
  ProfileUnlistedCards,
  ProfileUnlistedCardsView,
  unlistedCardsHref,
} from "@/components/admin/profile-unlisted-cards";
import type { AdminUnlistedCards } from "@/lib/admin/unlisted-cards";
import type { Card } from "@/types/card";

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "c1",
    slug: "night-ferry",
    title: "Night Ferry",
    visibility: "unlisted",
    frame_style: { template: "m15nyx" },
    layout_version: 74,
    updated_at: "2026-11-10T03:00:00+00:00",
    rendered_image_url: "https://x/render/c1.png",
    rendered_thumb_url: "https://x/render/c1.thumb.webp",
    rendered_back_thumb_url: null,
    ...over,
  }) as Card;

const read = (cards: Card[], over: Partial<Extract<AdminUnlistedCards, { ok: true }>> = {}): AdminUnlistedCards => ({
  ok: true,
  cards,
  total: cards.length,
  page: 1,
  pageSize: 24,
  ...over,
});

const props = { ownerId: "owner-1", ownerUsername: "ember sphinx", displayName: "Ember", page: 1 };

beforeEach(() => {
  reader.overrides.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  reader.list.mockReset();
  reader.overrides.mockReset();
});

describe("ProfileUnlistedCards — who gets the section", () => {
  it("is nothing at all for a viewer the reader refuses (anyone but an admin)", async () => {
    reader.list.mockResolvedValue(null);
    expect(await ProfileUnlistedCards(props)).toBeNull();
    expect(reader.list).toHaveBeenCalledWith("owner-1", 1);
    // …and nothing else is read for them.
    expect(reader.overrides).not.toHaveBeenCalled();
  });

  it("asks the gated reader for this creator's page, and draws its answer", async () => {
    reader.list.mockResolvedValue(read([card()]));
    const element = await ProfileUnlistedCards({ ...props, page: 3 });
    expect(reader.list).toHaveBeenCalledWith("owner-1", 3);
    expect(reader.overrides).toHaveBeenCalledTimes(1);
    render(element!);
    expect(screen.getByRole("heading", { level: 2, name: "Unlisted cards" })).toBeTruthy();
  });

  it("reads no frame overrides when there is nothing to draw", async () => {
    reader.list.mockResolvedValue(read([]));
    render((await ProfileUnlistedCards(props))!);
    expect(reader.overrides).not.toHaveBeenCalled();
    reader.list.mockResolvedValue({ ok: false });
    await ProfileUnlistedCards(props);
    expect(reader.overrides).not.toHaveBeenCalled();
  });

  it("is a server component whose only way to the cards is the gated reader", () => {
    const source = readFileSync("components/admin/profile-unlisted-cards.tsx", "utf8");
    expect(source).not.toMatch(/^["']use client["']/m);
    expect(source).toContain("const result = await listUnlistedCardsForAdmin(ownerId, page);");
    expect(source).toContain("if (!result) return null;");
    for (const banned of ["@/lib/supabase/admin", "@/lib/supabase/server", "createClient", "createPublicClient", ".from("]) {
      expect(source, banned).not.toContain(banned);
    }
  });
});

describe("ProfileUnlistedCardsView — what an admin sees", () => {
  it("says who it is for and what it is, with the count", () => {
    render(<ProfileUnlistedCardsView result={read([card(), card({ id: "c2", slug: "lamplighter", title: "Lamplighter" })])} ownerUsername="ember_sphinx" displayName="Ember" />);
    const section = screen.getByTestId("profile-unlisted-cards");
    expect(section.getAttribute("aria-labelledby")).toBe("unlisted-cards-heading");
    expect(section.id).toBe("unlisted-cards");
    expect(within(section).getByText("Admin only")).toBeTruthy();
    expect(within(section).getByText("2 unlisted cards")).toBeTruthy();
    expect(section.textContent).toContain("Only admins see this section, and only for debugging.");
    expect(section.textContent).toContain("Private cards are never shown.");
    expect(section.textContent).toContain("Showing 1–2 of 2, most recently edited first.");
  });

  it("each card is a link to its own page, named unlisted, with its picture's thumb", () => {
    render(<ProfileUnlistedCardsView result={read([card()])} ownerUsername="ember_sphinx" displayName="Ember" />);
    const link = screen.getByRole("link", { name: "Open Night Ferry (unlisted)" });
    expect(link.getAttribute("href")).toBe("/card/ember_sphinx/night-ferry");
    expect(link.querySelector("[data-thumb]")?.getAttribute("data-thumb")).toBe("https://x/render/c1.thumb.webp");
    expect(screen.getByText("1 unlisted card")).toBeTruthy();
  });

  it("names the frame the card is stored on, the layout it was baked at and when it was last edited (UTC, said so)", () => {
    render(
      <ProfileUnlistedCardsView
        result={read([card(), card({ id: "c2", slug: "b", title: "Unbaked", frame_style: {} as Card["frame_style"], layout_version: null })])}
        ownerUsername="ember_sphinx"
        displayName="Ember"
      />,
    );
    const text = screen.getByTestId("grid").textContent ?? "";
    expect(text).toContain("m15nyx · layout v74");
    expect(text).toContain("no frame · not baked");
    expect(text).toContain("Edited Nov 10, 2026 UTC");
  });

  it("no unlisted cards: one line, by name — the section still shows, so an admin knows it looked", () => {
    render(<ProfileUnlistedCardsView result={read([])} ownerUsername="ember_sphinx" displayName="Ember" />);
    expect(screen.getByRole("status").textContent).toBe("Ember has no unlisted cards.");
    expect(screen.getByText("0 unlisted cards")).toBeTruthy();
    expect(screen.queryByTestId("grid")).toBeNull();
  });

  it("a failed read says so and shows no count — never “no unlisted cards”", () => {
    render(<ProfileUnlistedCardsView result={{ ok: false }} ownerUsername="ember_sphinx" displayName="Ember" />);
    expect(screen.getByRole("status").textContent).toBe("Couldn’t load the unlisted cards. Reload the page to try again.");
    expect(screen.queryByText(/unlisted cards?$/)).toBeNull();
    expect(screen.getByTestId("profile-unlisted-cards").textContent).not.toContain("has no unlisted cards");
  });

  it("pages with links in the address: page 2 of 3 goes back to the bare profile and on to ?unlisted=3", () => {
    const cards = Array.from({ length: 24 }, (_, i) => card({ id: `c${i}`, slug: `s${i}`, title: `Card ${i}` }));
    render(<ProfileUnlistedCardsView result={read(cards, { total: 60, page: 2 })} ownerUsername="ember_sphinx" displayName="Ember" />);
    const nav = screen.getByRole("navigation", { name: "Unlisted card pages" });
    expect(nav.textContent).toContain("Page 2 of 3");
    expect(within(nav).getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/profile/ember_sphinx#unlisted-cards");
    expect(within(nav).getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/profile/ember_sphinx?unlisted=3#unlisted-cards");
    expect(screen.getByTestId("profile-unlisted-cards").textContent).toContain("Showing 25–48 of 60");
  });

  it("one page has no pager; the last page has no Next", () => {
    const { unmount } = render(<ProfileUnlistedCardsView result={read([card()])} ownerUsername="ember_sphinx" displayName="Ember" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    unmount();
    render(<ProfileUnlistedCardsView result={read([card()], { total: 49, page: 3 })} ownerUsername="ember_sphinx" displayName="Ember" />);
    const nav = screen.getByRole("navigation", { name: "Unlisted card pages" });
    expect(within(nav).queryByRole("link", { name: "Next" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/profile/ember_sphinx?unlisted=2#unlisted-cards");
  });

  it("a page past the end says so and leads back to the first", () => {
    render(<ProfileUnlistedCardsView result={read([], { total: 30, page: 9 })} ownerUsername="ember_sphinx" displayName="Ember" />);
    expect(screen.getByRole("status").textContent).toBe("This page is past the last unlisted card.");
    expect(screen.getByRole("link", { name: "Back to the first page" }).getAttribute("href")).toBe("/profile/ember_sphinx#unlisted-cards");
  });

  it("the address is escaped like the profile's own", () => {
    expect(unlistedCardsHref("ember sphinx", 1)).toBe("/profile/ember%20sphinx#unlisted-cards");
    expect(unlistedCardsHref("ember sphinx", 4)).toBe("/profile/ember%20sphinx?unlisted=4#unlisted-cards");
  });
});

describe("the profile page mounts it for a signed-in viewer only", () => {
  const page = readFileSync("app/(marketing)/profile/[username]/page.tsx", "utf8");

  it("under `viewer ?`, in its own Suspense with no fallback — a signed-out visitor costs no read and sees nothing", () => {
    const mount = page.slice(page.indexOf("{viewer ? (\n        <Suspense fallback={null}>\n          <ProfileUnlistedCards"));
    expect(mount.startsWith("{viewer ? (")).toBe(true);
    expect(mount.slice(0, mount.indexOf(") : null}"))).toContain("page={parseUnlistedPage(rawSearch[ADMIN_UNLISTED_PARAM])}");
    // Mounted once, and nowhere outside that guard.
    expect(page.match(/<ProfileUnlistedCards\b/g)).toHaveLength(1);
  });

  it("the page itself never reaches for the service client or an unlisted list of its own", () => {
    expect(page).not.toContain("@/lib/supabase/admin");
    expect(page).not.toContain("listUnlistedCardsForAdmin");
    expect(page).not.toMatch(/visibility["']?,\s*["']unlisted/);
  });
});
