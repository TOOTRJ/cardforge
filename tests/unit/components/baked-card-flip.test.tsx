// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { CardHeroPreview } from "@/components/cards/card-hero-preview";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 5.3, owner decision 2026-10-02 (Q6): a gallery-style tile of a
// double-faced card shows the FRONT's stored thumbnail with a small corner
// flip button that turns it over in place — the card page's control —
// and nothing on hover or by itself. The back's thumbnail is mounted only
// once the viewer first flips. A tile without a back thumb is exactly what
// it was (no button, the one <img> straight in the tile).
//
// The card page's hero (CardHeroPreview) opens on the face `?face=back`
// names, read by the client island inside its own Suspense boundary.
// ---------------------------------------------------------------------------

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/card/kesh/village-elder",
  useSearchParams: () => search.params,
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  search.params = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}

function tile(back: string | null) {
  const previewData = { title: "Village Elder", frameStyle: { template: "m15dfcfront" } } as CardPreviewData;
  const { container } = render(
    // A plain anchor stands in for the tile's <Link> (the same DOM: the
    // button's click must not follow it).
    <a href="https://pipglyph.com/card/kesh/village-elder">
      <BakedCardThumbnail
        renderedImageUrl={`${RENDERS}/probe.png?v=1`}
        renderedThumbUrl={`${RENDERS}/probe.thumb.webp?v=1`}
        renderedBackThumbUrl={back}
        title="Village Elder"
        previewData={previewData}
      />
    </a>,
  );
  return container;
}

describe("BakedCardThumbnail with a back thumb (TODO 5.3)", () => {
  it("shows the front with a corner flip button; the back's image is mounted on the first flip and the tile turns in place", async () => {
    const container = tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const button = screen.getByRole("button", { name: "Flip to back face" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    // The front thumb through the /render-cdn path; no back image yet.
    const imgs = () => Array.from(container.querySelectorAll("img"));
    expect(imgs().map((img) => img.getAttribute("src"))).toEqual(["/render-cdn/owner-1/probe.thumb.webp?v=1"]);
    expect(imgs()[0].getAttribute("alt")).toBe("Village Elder");
    const rotor = screen.getByTestId("baked-card-flip");
    expect(rotor.getAttribute("data-face")).toBe("front");

    await click(button);
    expect(rotor.getAttribute("data-face")).toBe("back");
    expect(screen.getByRole("button", { name: "Flip to front face" }).getAttribute("aria-pressed")).toBe("true");
    expect(imgs().map((img) => img.getAttribute("src"))).toEqual([
      "/render-cdn/owner-1/probe.thumb.webp?v=1",
      "/render-cdn/owner-1/probe.back.thumb.webp?v=1",
    ]);
    expect(imgs()[1].getAttribute("alt")).toBe("Village Elder (back face)");

    await click(screen.getByRole("button", { name: "Flip to front face" }));
    expect(rotor.getAttribute("data-face")).toBe("front");
    // The back stays mounted once seen.
    expect(imgs()).toHaveLength(2);
  });

  it("the button's click never follows the tile's link (the navigation is prevented)", async () => {
    tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const link = screen.getByRole("link");
    const events: Event[] = [];
    // The native click reaches the <a> before React's root handler runs
    // (and the button stops it there); what matters is that the button
    // prevented its default — the navigation. Seen from the capture phase.
    document.addEventListener("click", (event) => events.push(event), { capture: true });
    await click(screen.getByRole("button", { name: "Flip to back face" }));
    expect(events).toHaveLength(1);
    expect(events[0].defaultPrevented).toBe(true);
    expect(link.contains(events[0].target as Node)).toBe(true);
  });

  it("the keyboard flips too: Enter / Space on the button never reach a tile body that opens the card on them (the dashboard tile)", async () => {
    const previewData = { title: "Village Elder", frameStyle: { template: "m15dfcfront" } } as CardPreviewData;
    const navigate = vi.fn();
    // The dashboard tile's wrapper (components/creator/dashboard-card-tile.tsx):
    // a role="button" body whose onKeyDown opens the card on Enter / Space.
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={navigate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate();
          }
        }}
      >
        <BakedCardThumbnail
          renderedImageUrl={`${RENDERS}/probe.png?v=1`}
          renderedThumbUrl={`${RENDERS}/probe.thumb.webp?v=1`}
          renderedBackThumbUrl={`${RENDERS}/probe.back.thumb.webp?v=1`}
          title="Village Elder"
          previewData={previewData}
        />
      </div>,
    );
    const button = screen.getByRole("button", { name: "Flip to back face" });
    for (const key of ["Enter", " "]) {
      await act(async () => {
        fireEvent.keyDown(button, { key });
      });
      // …and the click a browser synthesises for the key.
      await click(button);
    }
    expect(navigate).not.toHaveBeenCalled();
    // Two flips: back, then front again.
    expect(screen.getByTestId("baked-card-flip").getAttribute("data-face")).toBe("front");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("without a back thumb — or with one that isn't a bake of ours — the tile is exactly what it was", () => {
    for (const back of [null, "https://evil.example/x.webp", `${HOST}/storage/v1/object/public/card-art/owner-1/raw.png`]) {
      const container = tile(back);
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.querySelector("[data-testid=baked-card-flip]")).toBeNull();
      const img = container.querySelector("img")!;
      expect(img.parentElement?.classList.contains("card-corners")).toBe(true);
      cleanup();
    }
  });
});

describe("CardHeroPreview — ?face=back opens the card flipped (TODO 5.3)", () => {
  const dfc = {
    title: "Village Elder",
    cardType: "creature",
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    colorIdentity: ["green"],
    backFace: {
      title: "Elder Wolf",
      card_type: "creature",
      power: "4",
      toughness: "4",
      frame_style: { template: "m15dfcback" },
      color_identity: ["green"],
    },
  } as unknown as CardPreviewData;

  it("opens on the front without the parameter, on the back with ?face=back, and the corner button still flips", async () => {
    render(<CardHeroPreview {...dfc} />);
    expect(screen.getByRole("button", { name: "Flip to back face" })).toBeTruthy();
    cleanup();
    search.params = new URLSearchParams("face=back");
    render(<CardHeroPreview {...dfc} />);
    const button = screen.getByRole("button", { name: "Flip to front face" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await click(button);
    expect(screen.getByRole("button", { name: "Flip to back face" })).toBeTruthy();
  });

  it("an unknown face, or a card with no back, is the front", () => {
    search.params = new URLSearchParams("face=sideways");
    render(<CardHeroPreview {...dfc} />);
    expect(screen.getByRole("button", { name: "Flip to back face" })).toBeTruthy();
    cleanup();
    search.params = new URLSearchParams("face=back");
    render(<CardHeroPreview {...dfc} backFace={null} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
