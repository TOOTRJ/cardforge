// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { HOVER_REST_MS } from "@/components/cards/baked-card-flip";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import type { Card } from "@/types/card";
import { CardHeroPreview } from "@/components/cards/card-hero-preview";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 5.3 + 5.15 (owner decisions 2026-10-12, replacing 5.3's Q6 "nothing
// moves on hover"): a gallery-style tile of a double-faced card with a back
// PICTURE shows the front's stored thumbnail with a labelled "2 faces"
// button (bottom-left, 44 px) that turns it over in place, and — with a real
// hovering pointer and motion allowed — also turns once the pointer has
// rested on it for HOVER_REST_MS, turning back when it leaves. The back's
// thumbnail is asked for only on intent. A tile without a back thumb — an
// older two-faced card, a card mid-save — is exactly what it was.
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

/** What the browser's media queries answer in a test. */
function media(matches: { hover: boolean; reducedMotion: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches.reducedMotion : matches.hover,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

const FRONT = "/render-cdn/owner-1/probe.thumb.webp?v=1";
const BACK = "/render-cdn/owner-1/probe.back.thumb.webp?v=1";
const srcs = (container: Element) => Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
// "enter" is a pointer that MOVES onto the tile (a browser fires the
// boundary events and a pointermove for the same physical move), each time
// at a new place; "arrive" is the tile sliding under a pointer that stands
// still (a wheel scroll, a page load): boundary events only.
let mouseAt = 0;
const pointer = (type: "enter" | "arrive" | "leave", el: Element, pointerType = "mouse") =>
  act(async () => {
    // React listens for over / out and synthesises enter / leave.
    if (type === "leave") {
      fireEvent.pointerOut(el, { pointerType });
      return;
    }
    fireEvent.pointerOver(el, { pointerType });
    if (type === "arrive") return;
    mouseAt += 7;
    fireEvent.pointerMove(el, { pointerType, clientX: mouseAt, clientY: mouseAt });
  });
/** The back's thumbnail has arrived (happy-dom loads no images). */
const backArrives = (container: Element) =>
  act(async () => {
    fireEvent.load(container.querySelectorAll("img")[1]);
  });
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

describe("BakedCardThumbnail with a back picture — the \"2 faces\" button (TODO 5.15)", () => {
  beforeEach(() => media({ hover: false, reducedMotion: false }));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the front with a labelled button; a press turns the tile in place and names the face showing", async () => {
    const container = tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const button = screen.getByRole("button", { name: "Show back face of Village Elder" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toBe("2 faces");
    // A thumb's target, bottom-LEFT (off the power / toughness box).
    const classes = new Set(button.className.split(/\s+/));
    for (const cls of ["h-11", "min-w-11", "bottom-2", "left-2"]) expect(classes.has(cls)).toBe(true);
    // The front thumb through the /render-cdn path; no back image yet.
    expect(srcs(container)).toEqual([FRONT]);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("Village Elder");
    const rotor = screen.getByTestId("baked-card-flip");
    expect(rotor.getAttribute("data-face")).toBe("front");
    // The tile keeps its one corner class; the turn happens inside it.
    expect(rotor.parentElement?.classList.contains("card-corners")).toBe(true);

    await click(button);
    expect(rotor.getAttribute("data-face")).toBe("back");
    const pressed = screen.getByRole("button", { name: "Show front face of Village Elder" });
    expect(pressed).toBe(button); // the same element: focus is never lost on a turn
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    // Three wordings, one shown by CSS (pointer kind and tile width).
    expect(Array.from(pressed.querySelectorAll("span")).map((span) => span.textContent)).toEqual([
      "Back",
      "Showing back",
      "Back · tap for front",
    ]);
    expect(srcs(container)).toEqual([FRONT, BACK]);
    expect(container.querySelectorAll("img")[1].getAttribute("alt")).toBe("Village Elder (back face)");

    await click(pressed);
    expect(rotor.getAttribute("data-face")).toBe("front");
    expect(button.textContent).toBe("2 faces");
    // The back stays mounted once seen.
    expect(srcs(container)).toHaveLength(2);
  });

  it("the back thumb is asked for only on intent: nothing at rest, then on the button's focus", async () => {
    const container = tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    expect(srcs(container)).toEqual([FRONT]);
    await act(async () => {
      fireEvent.focus(screen.getByRole("button"));
    });
    expect(srcs(container)).toEqual([FRONT, BACK]);
    // Focus fetched it; nothing turned.
    expect(screen.getByTestId("baked-card-flip").getAttribute("data-face")).toBe("front");
  });

  it("the button's click never follows the tile's link (the navigation is prevented)", async () => {
    tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const link = screen.getByRole("link");
    const events: Event[] = [];
    // The native click reaches the <a> before React's root handler runs
    // (and the button stops it there); what matters is that the button
    // prevented its default — the navigation. Seen from the capture phase.
    const seen = (event: Event) => events.push(event);
    document.addEventListener("click", seen, { capture: true });
    await click(screen.getByRole("button", { name: "Show back face of Village Elder" }));
    document.removeEventListener("click", seen, { capture: true });
    expect(events).toHaveLength(1);
    expect(events[0].defaultPrevented).toBe(true);
    expect(link.contains(events[0].target as Node)).toBe(true);
  });

  it("a middle click on the button does not open the card in a new tab, and turns nothing", async () => {
    tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const events: Event[] = [];
    const seen = (event: Event) => events.push(event);
    document.addEventListener("auxclick", seen, { capture: true });
    await act(async () => {
      fireEvent(
        screen.getByRole("button", { name: "Show back face of Village Elder" }),
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
      );
    });
    document.removeEventListener("auxclick", seen, { capture: true });
    expect(events).toHaveLength(1);
    // The link's default action for a middle click — a new tab — is prevented.
    expect(events[0].defaultPrevented).toBe(true);
    expect(screen.getByTestId("baked-card-flip").getAttribute("data-face")).toBe("front");
  });

  it("the turning stage takes no pointer (app/globals.css): inside the tile's 3D tilt a browser hit-tests by depth, and the button lost its clicks to the turning faces", async () => {
    const container = tile(`${RENDERS}/probe.back.thumb.webp?v=1`);
    const flip = screen.getByTestId("baked-card-flip");
    // Both pictures live in the stage; the button is its sibling, outside it.
    const stage = flip.querySelector(".tile-flip-stage")!;
    await click(screen.getByRole("button"));
    expect(Array.from(container.querySelectorAll("img")).every((img) => stage.contains(img))).toBe(true);
    expect(stage.contains(screen.getByRole("button"))).toBe(false);
    expect(screen.getByRole("button").parentElement).toBe(flip);
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.tile-flip-stage\s*\{\s*pointer-events:\s*none;\s*\}/);
    // Never a lift of the button: its hit area would leave its drawn box as the card tilts.
    expect(css).not.toMatch(/\.tile-flip-button\s*\{[^}]*translateZ/);
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
    const button = screen.getByRole("button", { name: "Show back face of Village Elder" });
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

  it("nothing is shown without a back picture: an older two-faced card, a thumb that isn't ours, a landscape frame, a card mid-save", () => {
    for (const back of [null, "https://evil.example/x.webp", `${HOST}/storage/v1/object/public/card-art/owner-1/raw.png`]) {
      const container = tile(back);
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.querySelector("[data-testid=baked-card-flip]")).toBeNull();
      const img = container.querySelector("img")!;
      expect(img.parentElement?.classList.contains("card-corners")).toBe(true);
      cleanup();
    }
    // An OLDER two-faced card: a back face in its data, no back picture.
    const legacy = {
      title: "Village Elder",
      frameStyle: { template: "m15" },
      backFace: { title: "Elder Wolf", card_type: "creature" },
    } as unknown as CardPreviewData;
    render(
      <BakedCardThumbnail
        renderedImageUrl={`${RENDERS}/probe.png?v=1`}
        renderedThumbUrl={`${RENDERS}/probe.thumb.webp?v=1`}
        renderedBackThumbUrl={null}
        title="Village Elder"
        previewData={legacy}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    // A landscape frame never turns (every two-faced body is portrait).
    render(
      <BakedCardThumbnail
        renderedImageUrl={`${RENDERS}/probe.png?v=1`}
        renderedThumbUrl={`${RENDERS}/probe.thumb.webp?v=1`}
        renderedBackThumbUrl={`${RENDERS}/probe.back.thumb.webp?v=1`}
        title="Siege"
        previewData={{ title: "Siege", frameStyle: { template: "battle" } } as CardPreviewData}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a card mid-save (an edit cleared its render pointers) is the live front with no button — a tile's preview data carries no back", () => {
    // What every tile passes: cardToPreviewData(row) — it never maps
    // back_face, so the live fallback has nothing to turn to.
    const row = {
      title: "Village Elder",
      frame_style: { template: "m15dfcfront" },
      back_face: { title: "Elder Wolf", card_type: "creature", frame_style: { template: "m15dfcback" } },
      subtypes: [],
      color_identity: ["green"],
    } as unknown as Card;
    const previewData = cardToPreviewData(row, null);
    expect(previewData.backFace ?? null).toBeNull();
    const { container } = render(
      <BakedCardThumbnail
        renderedImageUrl={null}
        renderedThumbUrl={null}
        renderedBackThumbUrl={null}
        title="Village Elder"
        previewData={previewData}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-testid=baked-card-flip]")).toBeNull();
    expect(container.querySelector("img[src*='thumb']")).toBeNull();
  });
});

describe("BakedCardThumbnail with a back picture — the hover-rest turn (TODO 5.15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    media({ hover: true, reducedMotion: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const BACK_URL = `${RENDERS}/probe.back.thumb.webp?v=1`;
  const face = () => screen.getByTestId("baked-card-flip").getAttribute("data-face");

  it("turns once the pointer has rested for HOVER_REST_MS, and turns back when it leaves; the back is fetched as the rest starts", async () => {
    expect(HOVER_REST_MS).toBeGreaterThanOrEqual(300);
    expect(HOVER_REST_MS).toBeLessThanOrEqual(400);
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    expect(srcs(container)).toEqual([FRONT, BACK]);
    await backArrives(container);
    await advance(HOVER_REST_MS - 1);
    expect(face()).toBe("front");
    await advance(1);
    expect(face()).toBe("back");
    // The button says so; nothing announces it (no live region, no focus move).
    const button = screen.getByRole("button", { name: "Show front face of Village Elder" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
    await pointer("leave", tileEl);
    expect(face()).toBe("front");
  });

  it("a pointer that leaves before the rest turns nothing — a sweep across the grid", async () => {
    tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await advance(HOVER_REST_MS - 50);
    await pointer("leave", tileEl);
    await advance(1000);
    expect(face()).toBe("front");
  });

  it("never under prefers-reduced-motion: no turn, and no back thumb for a hover", async () => {
    media({ hover: true, reducedMotion: true });
    const container = tile(BACK_URL);
    await pointer("enter", screen.getByTestId("baked-card-flip"));
    await advance(2000);
    expect(face()).toBe("front");
    expect(srcs(container)).toEqual([FRONT]);
    // The button still works there.
    await click(screen.getByRole("button", { name: "Show back face of Village Elder" }));
    expect(face()).toBe("back");
  });

  it("never without a hovering fine pointer, and never for a touch or pen pointer", async () => {
    media({ hover: false, reducedMotion: false });
    const container = tile(BACK_URL);
    await pointer("enter", screen.getByTestId("baked-card-flip"));
    await advance(2000);
    expect(face()).toBe("front");
    expect(srcs(container)).toEqual([FRONT]);
    cleanup();
    media({ hover: true, reducedMotion: false });
    const second = tile(BACK_URL);
    for (const pointerType of ["touch", "pen"]) {
      await pointer("enter", screen.getByTestId("baked-card-flip"), pointerType);
      await advance(2000);
      expect(face()).toBe("front");
    }
    expect(srcs(second)).toEqual([FRONT]);
  });

  it("a pointer on its way to the button is not resting on the card; back on the card, the rest starts again", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    const button = screen.getByRole("button");
    await pointer("enter", tileEl);
    await backArrives(container);
    await advance(200);
    await pointer("enter", button);
    await advance(2000);
    expect(face()).toBe("front");
    // Off the button, still on the tile: its next move there is a fresh rest.
    await act(async () => {
      fireEvent.pointerOut(button, { pointerType: "mouse", relatedTarget: tileEl });
    });
    await advance(2000);
    expect(face()).toBe("front");
    await act(async () => {
      fireEvent.pointerMove(container.querySelector("img")!, { pointerType: "mouse", clientX: 901, clientY: 902 });
    });
    await advance(HOVER_REST_MS - 1);
    expect(face()).toBe("front");
    await advance(1);
    expect(face()).toBe("back");
  });

  it("a tile that arrives under a pointer standing still does not turn — a wheel scroll, a page load; the pointer's next real move starts the rest", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    // The browser's boundary events for content that scrolled under the
    // cursor: pointerenter, no pointermove.
    await pointer("arrive", tileEl);
    await advance(5000);
    expect(face()).toBe("front");
    // …and nothing was fetched for it.
    expect(srcs(container)).toEqual([FRONT]);
    // An engine that also sends a pointermove at the unchanged place: the
    // pointer has not moved since its last real move (somewhere else).
    cleanup();
    const again = tile(BACK_URL);
    const second = screen.getByTestId("baked-card-flip");
    await act(async () => {
      fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 400, clientY: 300 });
    });
    await pointer("leave", second);
    await act(async () => {
      fireEvent.pointerOver(second, { pointerType: "mouse" });
      fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 400, clientY: 300 });
    });
    await advance(5000);
    expect(face()).toBe("front");
    // A real move (a new place) starts the rest.
    await act(async () => {
      fireEvent.pointerMove(second, { pointerType: "mouse", clientX: 401, clientY: 300 });
    });
    await backArrives(again);
    await advance(HOVER_REST_MS);
    expect(face()).toBe("back");
  });

  it("one rest per visit: moving about on the card does not push the turn back", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await backArrives(container);
    await advance(HOVER_REST_MS - 100);
    await act(async () => {
      fireEvent.pointerMove(tileEl, { pointerType: "mouse", clientX: 611, clientY: 612 });
    });
    await advance(100);
    expect(face()).toBe("back");
  });

  it("a hover never turns to a picture that has not arrived: the turn waits for the back thumb", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await advance(HOVER_REST_MS + 500);
    expect(face()).toBe("front");
    await backArrives(container);
    expect(face()).toBe("back");
    // A pointer that left before it arrived: nothing turns afterwards.
    cleanup();
    const late = tile(BACK_URL);
    const lateTile = screen.getByTestId("baked-card-flip");
    await pointer("enter", lateTile);
    await advance(HOVER_REST_MS);
    await pointer("leave", lateTile);
    await backArrives(late);
    expect(face()).toBe("front");
  });

  it("a back thumb that cannot be loaded (removed by an edit after the list was built): the tile stays on the front and loses its button", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await act(async () => {
      fireEvent.error(container.querySelectorAll("img")[1]);
    });
    await advance(5000);
    expect(face()).toBe("front");
    expect(screen.queryByRole("button")).toBeNull();
    // The broken picture is gone too; the front is what it was.
    expect(srcs(container)).toEqual([FRONT]);
    expect(container.querySelector("[aria-hidden=true] img")).toBeNull();
    cleanup();
    // The same after a press (touch, keyboard): back to the front, no button.
    const pressed = tile(BACK_URL);
    await click(screen.getByRole("button", { name: "Show back face of Village Elder" }));
    expect(face()).toBe("back");
    await act(async () => {
      fireEvent.error(pressed.querySelectorAll("img")[1]);
    });
    expect(face()).toBe("front");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("baked-card-flip").querySelector(".tile-flip-front")!.getAttribute("aria-hidden")).toBe("false");
  });

  it("a press on a hover-turned tile shows the FRONT, and that pointer does not turn it again until it has left", async () => {
    const container = tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await backArrives(container);
    await advance(HOVER_REST_MS);
    expect(face()).toBe("back");
    await click(screen.getByRole("button", { name: "Show front face of Village Elder" }));
    expect(face()).toBe("front");
    await advance(2000);
    expect(face()).toBe("front");
    // Leave and come back: the hover-turn is on again.
    await pointer("leave", tileEl);
    await pointer("enter", tileEl);
    await advance(HOVER_REST_MS);
    expect(face()).toBe("back");
  });

  it("a face the button chose stays when the pointer leaves", async () => {
    tile(BACK_URL);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await click(screen.getByRole("button", { name: "Show back face of Village Elder" }));
    expect(face()).toBe("back");
    await pointer("leave", tileEl);
    await advance(2000);
    expect(face()).toBe("back");
  });

  it("the pointer handlers never touch the tile's link: a click on the card still opens it", async () => {
    tile(BACK_URL);
    const events: Event[] = [];
    const seen = (event: Event) => events.push(event);
    document.addEventListener("click", seen);
    const tileEl = screen.getByTestId("baked-card-flip");
    await pointer("enter", tileEl);
    await advance(HOVER_REST_MS);
    await act(async () => {
      // happy-dom would try to navigate: cancel at the document, AFTER the
      // component's handlers have had their say.
      document.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(tileEl.querySelector("img")!);
    });
    document.removeEventListener("click", seen);
    expect(events).toHaveLength(1);
    // Nothing in the tile stopped it on the way up.
    expect(screen.getByRole("link").contains(events[0].target as Node)).toBe(true);
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
