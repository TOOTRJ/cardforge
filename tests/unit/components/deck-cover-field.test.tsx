// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck cover field (TODO DK6.5, components/decks/deck-creator-form.tsx):
//   * an upload previews at 16:9 with the hero's two crops framed on it —
//     the wide-screen band and the phone column — and the focal-point drag
//     moves them (the picture itself is 16:9 like the box, so it never does);
//   * an OLDER cover the guard won't draw (another host, kept since 0127)
//     is never drawn here either: the field says the deck shows its default
//     background, as the hero does.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("@/lib/decks/actions", () => ({ updateDeckAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => <a href={href}>{children}</a>,
}));

import { CoverField } from "@/components/decks/deck-creator-form";

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
const UPLOAD = `${HOST}/storage/v1/object/public/set-covers/${OWNER}/cover.webp`;
const DEFAULT = "/defaults/deck-covers/red-1.webp";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const field = (value: string, onPositionChange = vi.fn(), position: { focalX: number; focalY: number } | null = null) =>
  render(
    <CoverField
      userId={OWNER}
      value={value}
      defaultCoverSrc={DEFAULT}
      onChange={vi.fn()}
      position={position}
      onPositionChange={onPositionChange}
    />,
  );

describe("CoverField", () => {
  it("frames the hero's wide-screen band and phone column on an upload, where the focal point puts them", () => {
    const { container } = field(UPLOAD, vi.fn(), { focalX: 1, focalY: 0 });
    expect(screen.getByRole("img", { name: "Deck cover preview" }).getAttribute("src")).toBe(UPLOAD);
    expect(screen.getByText("Wide screen")).toBeTruthy();
    expect(screen.getByText("Phone")).toBeTruthy();
    const frames = [...container.querySelectorAll<HTMLElement>("[aria-hidden].absolute")];
    expect(frames).toHaveLength(2);
    // Focal point top-right: the band at the top, the column at the right.
    const [wide, phone] = frames;
    expect(wide.style.top).toBe("0%");
    expect(Number.parseFloat(phone.style.left) + Number.parseFloat(phone.style.width)).toBeCloseTo(100, 5);
  });

  it("a drag sets the focal point under the pointer", () => {
    const onPositionChange = vi.fn();
    field(UPLOAD, onPositionChange);
    const preview = screen.getByRole("application");
    preview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    preview.setPointerCapture = vi.fn();
    fireEvent.pointerDown(preview, { clientX: 50, clientY: 75, pointerId: 1 });
    expect(onPositionChange).toHaveBeenLastCalledWith({ focalX: 0.25, focalY: 0.75 });
  });

  it("never draws an older cover the guard refuses — it says the deck shows its default", () => {
    field("https://old-host.example/cover.png");
    expect(screen.queryByRole("img", { name: "Deck cover preview" })).toBeNull();
    expect(screen.getByRole("img", { name: "The deck's default background" }).getAttribute("src")).toBe(DEFAULT);
    expect(screen.getByRole("status").textContent).toMatch(/isn.t shown anywhere/);
    expect(screen.getByRole("button", { name: /Remove the old cover/ })).toBeTruthy();
  });

  it("no cover: the default background and the upload box", () => {
    field("");
    expect(screen.getByRole("img", { name: "The deck's default background" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use your own picture/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The built-in backgrounds (migration 0150): "Shuffle" and a grid of the
// sixteen — one radio group, ChipGroup's keyboard (one tab stop, arrows move
// the focus, Space / Enter picks). A pick STORES the path, so a stored one
// is shown picked, with the way back to the colours' pick.
// ---------------------------------------------------------------------------

const withChange = (value: string) => {
  const onChange = vi.fn();
  render(
    <CoverField
      userId={OWNER}
      value={value}
      defaultCoverSrc={DEFAULT}
      onChange={onChange}
      position={null}
      onPositionChange={vi.fn()}
    />,
  );
  return onChange;
};

describe("CoverField — the built-in backgrounds", () => {
  it("lists the sixteen as one radio group, none picked while the deck stores none", () => {
    withChange("");
    const group = screen.getByRole("radiogroup", { name: "Built-in backgrounds" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(16);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "White 1", "White 2", "Blue 1", "Blue 2", "Black 1", "Black 2", "Red 1", "Red 2",
      "Green 1", "Green 2", "Multicolor 1", "Multicolor 2", "Colorless 1", "Colorless 2", "Neutral 1", "Neutral 2",
    ]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    // One tab stop.
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("a click picks one — its path is the cover", () => {
    const onChange = withChange("");
    fireEvent.click(screen.getByRole("radio", { name: "Green 2" }));
    expect(onChange).toHaveBeenCalledWith("/defaults/deck-covers/green-2.webp");
  });

  it("the arrows move the focus and never pick; Enter (a click) picks", () => {
    const onChange = withChange("/defaults/deck-covers/blue-1.webp");
    const picked = screen.getByRole("radio", { name: "Blue 1" });
    expect(picked.tabIndex).toBe(0);
    picked.focus();
    fireEvent.keyDown(picked, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Blue 2" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Neutral 2" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Shuffle stores another of the sixteen than the one shown", () => {
    const onChange = withChange("");
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    const [next] = onChange.mock.calls[0];
    expect(next).toMatch(/^\/defaults\/deck-covers\/[a-z]+-[12]\.webp$/);
    expect(next).not.toBe(DEFAULT);
  });

  it("a stored built-in is shown picked, named, with the way back to the colours' pick — never as an upload", () => {
    const onChange = withChange("/defaults/deck-covers/black-2.webp");
    expect(screen.getByRole("img", { name: "The deck's default background" }).getAttribute("src")).toBe(
      "/defaults/deck-covers/black-2.webp",
    );
    expect(screen.getByText(/Black 2, your pick/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Black 2" }).getAttribute("aria-checked")).toBe("true");
    // No focal-point drag, no "older cover" notice.
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back to the colours/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("an upload offers no built-in grid (Remove goes back to the colours' pick first)", () => {
    withChange(UPLOAD);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
