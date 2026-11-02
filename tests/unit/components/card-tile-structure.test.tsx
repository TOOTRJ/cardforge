// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 5.17: a two-faced tile's "2 faces" button is NEVER a descendant of the
// tile's link or of a role="button" tile body — on every gallery-style
// surface. Interactive content nested in a link is invalid HTML (axe
// "nested-interactive", serious) and read unreliably by assistive tech.
//
// ONE component nests the two (components/cards/card-tile.tsx): the body is
// an empty element UNDER the picture, before it in the document, and the
// picture lets the pointer through to it. Each wrapper is rendered here with
// the REAL CardTile / CardHoverEffect / BakedCardThumbnail / BakedCardFlip;
// the profile page's tile (a function inside a server page) and any wrapper
// added later are held by the source scan at the end.
// ---------------------------------------------------------------------------

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/components/cards/quick-like-button", () => ({
  QuickLikeButton: () => <button type="button">Like</button>,
}));
vi.mock("@/components/gallery/trending-share-button", () => ({
  TrendingShareButton: () => <button type="button">Share</button>,
}));
vi.mock("@/components/cards/render-update", () => ({ RenderUpdateBadge: () => null }));
vi.mock("@/lib/cards/preview-data", () => ({
  cardToPreviewData: (row: { title: string; frame_style: unknown }) => ({ title: row.title, frameStyle: row.frame_style }),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="live-preview" />,
}));

import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { TrendingCardsSection } from "@/components/gallery/trending-cards-section";
import { DashboardCardTile, type DashboardCard } from "@/components/creator/dashboard-card-tile";
import { LikedCardTile } from "@/components/creator/liked-card-tile";
import type { CardWithStats } from "@/lib/cards/queries";

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;
const ID = "11111111-1111-4111-8111-111111111111";

const card = (overrides: Record<string, unknown> = {}) =>
  ({
    id: ID,
    slug: "village-elder",
    title: "Village Elder",
    visibility: "public",
    card_type: "creature",
    rarity: "rare",
    subtypes: [],
    frame_style: { template: "m15dfcfront" },
    likes_count: 0,
    liked_by_viewer: false,
    parent_card_id: null,
    source_scryfall_id: null,
    updated_at: "2026-10-12T10:00:00Z",
    created_at: "2026-10-12T10:00:00Z",
    owner: { username: "kesh", display_name: "Kesh", avatar_url: null },
    rendered_image_url: `${RENDERS}/${ID}.png?v=1`,
    rendered_thumb_url: `${RENDERS}/${ID}.thumb.webp?v=1`,
    rendered_back_image_url: `${RENDERS}/${ID}.back.png?v=1`,
    rendered_back_thumb_url: `${RENDERS}/${ID}.back.thumb.webp?v=1`,
    ...overrides,
  }) as unknown as DashboardCard & CardWithStats;
const oneFaced = () =>
  card({ frame_style: { template: "m15" }, rendered_back_image_url: null, rendered_back_thumb_url: null });

/** What a browser's media queries answer: a mouse (the tilt on) or a phone. */
function media(hover: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? false : hover,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  router.push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const INTERACTIVE = "a[href], button, [role=button], [role=link], input, select, textarea, [tabindex]";

/** No control of the rendered tree sits inside another control. */
function expectNoNestedControls(root: Element) {
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
    const outer = el.parentElement?.closest(INTERACTIVE);
    expect(outer, `${el.outerHTML.slice(0, 90)} is inside ${outer?.outerHTML.slice(0, 60)}`).toBeFalsy();
  }
}

type Wrapper = {
  name: string;
  /** How the tile's body is found. */
  bodyRole: "link" | "button";
  bodyName: string;
  render: (c: DashboardCard & CardWithStats) => ReactNode;
};

const WRAPPERS: Wrapper[] = [
  {
    name: "GalleryCardTile (gallery rows, browse, hubs, feed, challenges, a card page's related rows)",
    bodyRole: "link",
    bodyName: "Open Village Elder",
    render: (c) => <GalleryCardTile card={c} isAuthed={false} />,
  },
  {
    name: "TrendingCardsSection (the trending row, plain and hero)",
    bodyRole: "link",
    bodyName: "Open Village Elder",
    render: (c) => <TrendingCardsSection cards={[c]} isAuthed={false} variant="hero" />,
  },
  {
    name: "LikedCardTile (My Cards, Liked — with selection)",
    bodyRole: "link",
    bodyName: "Open Village Elder",
    render: (c) => (
      <LikedCardTile card={c} selection={{ isSelected: false, selectMode: false, onToggle: vi.fn() }} />
    ),
  },
  {
    name: "DashboardCardTile (My Cards, regular)",
    bodyRole: "button",
    bodyName: "View Village Elder",
    render: (c) => <DashboardCardTile card={c} isSelected={false} selectMode={false} onToggle={vi.fn()} />,
  },
  {
    name: "DashboardCardTile (My Cards, compact)",
    bodyRole: "button",
    bodyName: "View Village Elder",
    render: (c) => (
      <DashboardCardTile card={c} density="compact" isSelected={false} selectMode={false} onToggle={vi.fn()} />
    ),
  },
];

describe.each([
  { pointer: "a mouse (the 3D tilt on)", hover: true },
  { pointer: "no hovering pointer (a phone; reduced motion renders the same tree)", hover: false },
])("a two-faced tile's button is outside the tile's body — $pointer", ({ hover }) => {
  beforeEach(() => media(hover));

  it.each(WRAPPERS)("$name", async ({ bodyRole, bodyName, render: draw }) => {
    const { container } = render(<>{draw(card())}</>);
    const button = screen.getByRole("button", { name: "Show back face of Village Elder" });
    const body = screen.getByRole(bodyRole, { name: bodyName });

    // The rule itself.
    expect(button.closest("a")).toBeNull();
    expect(button.closest("[role=button]")).toBeNull();
    expect(body.contains(button)).toBe(false);
    expectNoNestedControls(container);

    // The body: ONE empty element filling the tile's box, under the picture.
    expect(body.getAttribute("data-tile-body")).toBe("under");
    expect(body.childNodes).toHaveLength(0);
    const box = body.parentElement!;
    expect(box.classList.contains("card-hover-effect")).toBe(true);
    expect(box.firstElementChild).toBe(body);
    expect(box.contains(button)).toBe(true);
    for (const cls of ["absolute", "inset-0", "card-corners"]) expect(body.classList.contains(cls)).toBe(true);
    // …the picture lets the pointer through to it; the button alone takes its own.
    const picture = button.closest("[data-testid=baked-card-flip]")!.parentElement!;
    expect(picture.classList.contains("pointer-events-none")).toBe(true);
    expect(button.classList.contains("pointer-events-auto")).toBe(true);
    if (hover) {
      // Inside the tilt: nothing but the button can be hit there.
      const rotor = button.closest(".card-hover-rotor")!;
      expect(rotor.classList.contains("pointer-events-none")).toBe(true);
      expect(rotor.contains(body)).toBe(false);
    }

    // Keyboard order: the body, then "2 faces", then whatever follows the tile.
    const stops = Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE));
    expect(stops.indexOf(button)).toBe(stops.indexOf(body) + 1);

    // A press turns the tile and never reaches the body.
    const onBody = vi.fn();
    body.addEventListener("click", onBody);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onBody).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(within(container).getByTestId("baked-card-flip").getAttribute("data-face")).toBe("back");
    expect(screen.getByRole("button", { name: "Show front face of Village Elder" })).toBe(button);
  });

  it.each(WRAPPERS)("a ONE-faced tile keeps its body AROUND the picture — $name", ({ bodyRole, bodyName, render: draw }) => {
    const { container } = render(<>{draw(oneFaced())}</>);
    const body = screen.getByRole(bodyRole, { name: bodyName });
    expect(body.getAttribute("data-tile-body")).toBeNull();
    expect(body.firstElementChild?.classList.contains("card-hover-effect")).toBe(true);
    expect(body.querySelector("img")).toBeTruthy();
    expect(body.classList.contains("block")).toBe(true);
    expect(container.querySelector("[data-testid=two-faces-button]")).toBeNull();
    expect(container.querySelector("[data-testid=card-tile-shell]")).toBeNull();
    expect(container.querySelector(".pointer-events-none img")).toBeNull();
    expectNoNestedControls(container);
  });
});

describe("the dashboard tile's body still opens or selects (TODO 5.17)", () => {
  beforeEach(() => media(false));

  it("a click or Enter on the body opens the card; in select mode it toggles; the \"2 faces\" button does neither", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DashboardCardTile card={card()} isSelected={false} selectMode={false} onToggle={onToggle} />,
    );
    const body = screen.getByRole("button", { name: "View Village Elder" });
    await act(async () => {
      fireEvent.click(body);
    });
    expect(router.push).toHaveBeenCalledWith(`/go/card/${ID}`);
    await act(async () => {
      fireEvent.keyDown(body, { key: "Enter" });
    });
    expect(router.push).toHaveBeenCalledTimes(2);
    const flip = screen.getByRole("button", { name: "Show back face of Village Elder" });
    for (const key of ["Enter", " "]) {
      await act(async () => {
        fireEvent.keyDown(flip, { key });
        fireEvent.click(flip);
      });
    }
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();

    rerender(<DashboardCardTile card={card()} isSelected={false} selectMode onToggle={onToggle} />);
    await act(async () => {
      // (the corner checkbox carries the same name: take the body)
      const bodies = screen.getAllByRole("button", { name: "Select Village Elder" });
      fireEvent.click(bodies.find((el) => el.hasAttribute("data-tile-body"))!);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("the liked tile's link still selects on a modified click, and the button never does", async () => {
    const onToggle = vi.fn();
    render(<LikedCardTile card={card()} selection={{ isSelected: false, selectMode: false, onToggle }} />);
    const link = screen.getByRole("link", { name: "Open Village Elder" });
    await act(async () => {
      fireEvent.click(link, { metaKey: true });
    });
    expect(onToggle).toHaveBeenCalledWith(ID, { meta: true, shift: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show back face of Village Elder" }), { metaKey: true });
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("every wrapper goes through CardTile (source scan)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) files.push(path);
    }
  };
  walk("app");
  walk("components");
  const read = (path: string) => readFileSync(path, "utf8");

  it("only CardTile asks BakedCardThumbnail for the \"2 faces\" button", () => {
    const asking = files.filter((path) => /\bbackFaceButton\b/.test(read(path)));
    expect(asking.sort()).toEqual(["components/cards/baked-card-thumbnail.tsx", "components/cards/card-tile.tsx"]);
  });

  it("a back thumb reaches a tile only through CardTile's `thumbnail` — never as a JSX prop of a hand-nested BakedCardThumbnail", () => {
    const handNested = files.filter((path) => /renderedBackThumbUrl=\{/.test(read(path)));
    expect(handNested).toEqual([]);
    // The seven tile wrappers, by name: a new one joins this list AND uses CardTile.
    const passing = files.filter((path) => /renderedBackThumbUrl:/.test(read(path)));
    expect(passing.sort()).toEqual([
      "app/(marketing)/profile/[username]/page.tsx",
      "components/cards/gallery-card-tile.tsx",
      "components/creator/dashboard-card-tile.tsx",
      "components/creator/liked-card-tile.tsx",
      // /decks' commander row (TODO DK8.4).
      "components/decks/commander-row.tsx",
      // The deck page's Stacks and Grid views (TODO DK5.3).
      "components/decks/deck-entry-tile.tsx",
      // A frame's example card on /frames (TODO NV8).
      "components/frames/frame-gallery-tile.tsx",
      "components/gallery/trending-cards-section.tsx",
    ]);
    for (const path of passing) {
      const source = read(path);
      expect(source, path).toMatch(/<CardTile\b/);
      expect(source, path).not.toMatch(/<BakedCardThumbnail\b/);
      expect(source, path).not.toMatch(/<CardHoverEffect\b/);
    }
  });

  it("CardTile is the only place that puts a picture inside the tilt", () => {
    const tilting = files.filter(
      (path) => path !== "components/cards/card-hover-effect.tsx" && /<CardHoverEffect\b/.test(read(path)),
    );
    expect(tilting).toEqual(["components/cards/card-tile.tsx"]);
  });
});
