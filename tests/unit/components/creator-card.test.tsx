// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// /creators' row (TODO NV11): ONE link per creator — to the profile, named
// by the creator — with the strip of their newest public cards under it as a
// picture (aria-hidden, no controls, the 600 px thumbs), and the avatar
// through profileMediaSrc() (a stored URL that isn't the creator's own falls
// back to a built-in one).
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid="avatar" />,
}));
vi.mock("@/lib/cards/preview-data", () => ({
  cardToPreviewData: (row: { title: string; frame_style: unknown }) => ({ title: row.title, frameStyle: row.frame_style }),
}));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="live-preview" />,
}));

import { CreatorCard } from "@/components/creators/creator-card";
import type { PublicCreator } from "@/lib/creators/queries";
import type { Card } from "@/types/card";

const HOST = "https://auth.pipglyph.com";
const OWNER = "d0000000-0000-4000-a000-000000000004";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/${OWNER}`;

const card = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    owner_id: OWNER,
    slug: `card-${id}`,
    title: `Card ${id}`,
    visibility: "public",
    frame_style: { template: "m15dfcfront" },
    rendered_image_url: `${RENDERS}/${id}.png?v=1`,
    rendered_thumb_url: `${RENDERS}/${id}.thumb.webp?v=1`,
    rendered_back_image_url: `${RENDERS}/${id}.back.png?v=1`,
    rendered_back_thumb_url: `${RENDERS}/${id}.back.thumb.webp?v=1`,
    ...overrides,
  }) as unknown as Card;

const creator = (overrides: Partial<PublicCreator> = {}): PublicCreator => ({
  id: OWNER,
  username: "dev_artist",
  name: "Ari the Artificer",
  avatarUrl: "https://evil.example/tracker.png",
  publicCards: 14,
  publicDecks: 2,
  likes: 7,
  lastCardAt: "2026-09-21T00:10:32Z",
  recentCardIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  strip: [card("11111111-1111-4111-8111-111111111111"), card("22222222-2222-4222-8222-222222222222")],
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("CreatorCard", () => {
  it("is one link, to the profile, named by the creator", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    const { container } = render(<CreatorCard creator={creator()} />);
    const links = container.querySelectorAll("a[href]");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Ari the Artificer" })).toHaveProperty(
      "href",
      expect.stringMatching(/\/profile\/dev_artist$/),
    );
    expect(container.querySelectorAll("button, [role=button]")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Ari the Artificer" })).toBeTruthy();
    expect(container.textContent).toContain("@dev_artist");
    expect(container.textContent).toContain("14 cards");
    expect(container.textContent).toContain("2 decks");
    expect(container.textContent).toContain("7 likes");
  });

  it("draws the strip from the 600 px thumbs, hidden from assistive tech, with no '2 faces' control", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    const { container } = render(<CreatorCard creator={creator()} />);
    const strip = container.querySelector("[aria-hidden='true'].grid");
    expect(strip).toBeTruthy();
    const thumbs = Array.from(strip!.querySelectorAll("img"));
    expect(thumbs).toHaveLength(2);
    for (const img of thumbs) {
      expect(img.getAttribute("src")).toMatch(/\.thumb\.webp/);
      expect(img.getAttribute("src")).not.toMatch(/\.back\./);
      expect(img.getAttribute("alt")).toBe("");
    }
    expect(strip!.querySelector("a, button")).toBeNull();
    // The thumbnails are positioned: without this they paint over the
    // stretched profile link and a click on them opens nothing.
    expect(strip!.className).toContain("pointer-events-none");
  });

  it("never draws an avatar URL that isn't the creator's own stored picture", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    render(<CreatorCard creator={creator()} />);
    const avatar = screen.getByTestId("avatar");
    expect(avatar.getAttribute("src")).not.toContain("evil.example");
    expect(avatar.getAttribute("alt")).toBe("");
  });

  it("shows the handle once when the creator has no display name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
    const { container } = render(<CreatorCard creator={creator({ name: "@dev_artist", strip: [] })} />);
    expect(screen.getByRole("link", { name: "@dev_artist" })).toBeTruthy();
    expect(container.textContent?.match(/@dev_artist/g)).toHaveLength(1);
    expect(container.querySelector("[aria-hidden='true'].grid")).toBeNull();
  });
});
