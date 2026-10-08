// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { artPositionerWindows, faceArtWindow, type ArtWindow } from "@/lib/cards/art-positioner-window";
import type { ArtPosition, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The art positioner's surface is the card's art window (TODO 3b.13): with
// art loaded it takes the window's aspect, follows a frame change, lays the
// picture out with the renderers' own CSS, and a drag moves the grabbed
// point with the pointer on that box.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/cards/art-upload-client", () => ({ uploadCardArtFile: vi.fn() }));

import { ArtUploader } from "@/components/creator/art-uploader";

const ART = "https://project.supabase.co/storage/v1/object/public/card-art/u/grid.png";
const windowOn = (template: FrameTemplate, more: Partial<CardPreviewData> = {}) =>
  faceArtWindow({ frameStyle: { template }, colorIdentity: ["white"], cardType: "creature", ...more });

afterEach(() => cleanup());

function Harness({
  template,
  window,
  artUrl = ART,
  start = { focalX: 0.5, focalY: 0.5, scale: 1 },
  onChange,
}: {
  template?: FrameTemplate;
  window?: ArtWindow;
  artUrl?: string | null;
  start?: ArtPosition;
  onChange?: (p: ArtPosition) => void;
}) {
  const [position, setPosition] = useState<ArtPosition>(start);
  return (
    <ArtUploader
      userId="u"
      artUrl={artUrl}
      artPosition={position}
      artWindow={window ?? windowOn(template ?? "m15")}
      onArtChange={({ artPosition }) => {
        setPosition(artPosition);
        onChange?.(artPosition);
      }}
    />
  );
}

const surface = () => document.querySelector("[data-art-uploader]") as HTMLDivElement;
const picture = () => screen.getByAltText("Card artwork preview") as HTMLImageElement;

/** Give the surface a laid-out size and the picture a natural one (happy-dom
 *  lays nothing out), then fire the picture's load. */
function layOut(box: { width: number; height: number }, natural: { width: number; height: number }) {
  const el = surface();
  Object.defineProperty(el, "clientWidth", { configurable: true, value: box.width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: box.height });
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  const img = picture();
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: natural.width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: natural.height });
  fireEvent.load(img);
}

function drag(dx: number, dy: number) {
  const el = surface();
  fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
}

describe("the surface is the art window", () => {
  it.each([
    ["m15", "1.3657"],
    ["m15borderless", "0.7744"],
    ["m20token", "0.7350"],
    ["m15pw", "0.7554"],
    ["saga", "0.4167"],
    ["battle", "1.3598"],
    ["split", "1.4618"],
    ["aftermath", "2.7015"],
  ] as const)("%s: aspect %s", (template, aspect) => {
    render(<Harness template={template} />);
    const el = surface();
    expect(el.dataset.artWindowAspect).toBe(aspect);
    expect(el.style.aspectRatio).toBe(`${Number(aspect)} / 1`);
    // No border on the loaded surface: it would shrink the box the picture
    // fills (and its aspect); the window's edge is an outline.
    expect(el.className).not.toMatch(/(^|\s)border(-\d)?(\s|$)/);
    expect(el.className).toContain("outline-1");
    // A finger on the picture pans it instead of scrolling the page.
    expect(el.className).toContain("touch-none");
  });

  it("follows a frame change", () => {
    const view = render(<Harness template="m15" />);
    expect(surface().dataset.artWindowAspect).toBe("1.3657");
    view.rerender(<Harness template="saga" />);
    expect(surface().dataset.artWindowAspect).toBe("0.4167");
    view.rerender(<Harness template="m15borderless" />);
    expect(surface().dataset.artWindowAspect).toBe("0.7744");
  });

  it("follows the colour where a master has its own window (the see-through walker)", () => {
    const view = render(<Harness window={windowOn("m15pw", { colorIdentity: ["white"] })} />);
    expect(surface().dataset.artWindowAspect).toBe("0.7554");
    view.rerender(<Harness window={windowOn("m15pw", { colorIdentity: [] })} />);
    expect(surface().dataset.artWindowAspect).toBe("0.7089");
  });

  it("a second face and a double-faced back get their own windows", () => {
    const aftermath = artPositionerWindows({ frameStyle: { template: "aftermath" } });
    const view = render(<Harness window={aftermath.second!} />);
    expect(surface().dataset.artWindowAspect).toBe("1.7360");
    expect(screen.getByText(/the card turns this half on its side/)).toBeTruthy();
    const dfc = artPositionerWindows({
      frameStyle: { template: "m15dfcfront" },
      backFace: { title: "Back", frame_style: { template: "m15dfcback" } },
    });
    view.rerender(<Harness window={dfc.back!} />);
    expect(surface().dataset.artWindowAspect).toBe("1.3653");
    expect(screen.queryByText(/the card turns this half/)).toBeNull();
  });

  it("draws the picture with the renderers' CSS", () => {
    render(<Harness template="saga" start={{ focalX: 0.2, focalY: 0.8, scale: 1.5 }} />);
    const img = picture();
    expect(img.className).toContain("object-cover");
    expect(img.style.objectPosition).toBe("20% 80%");
    expect(img.style.transform).toBe("scale(1.5)");
    expect(img.style.transformOrigin).toBe("20% 80%");
  });

  it("the empty dropzone is a plain file target that names this frame's window size", () => {
    const view = render(<Harness template="saga" artUrl={null} />);
    expect(surface().dataset.artWindowAspect).toBeUndefined();
    expect(surface().getAttribute("role")).toBe("button");
    expect(screen.getByTestId("art-best-size").textContent).toBe("Best results: 636 × 1526 px or larger");
    view.rerender(<Harness template="m15" artUrl={null} />);
    expect(screen.getByTestId("art-best-size").textContent).toBe("Best results: 1271 × 931 px or larger");
  });
});

describe("dragging on the window", () => {
  // A 1600 × 1200 picture (aspect 1.33).
  const natural = { width: 1600, height: 1200 };

  it("saga's tall window: a 40 px drag is 40 px of the picture, not the whole range", () => {
    const onChange = vi.fn();
    render(<Harness template="saga" onChange={onChange} />);
    // The surface at its cap: 183 × 440. The picture covers it 587 px wide.
    layOut({ width: 183, height: 440 }, natural);
    drag(-40, 0);
    const last = onChange.mock.calls.at(-1)![0] as ArtPosition;
    const covered = (1600 * 440) / 1200;
    expect(last.focalX).toBeCloseTo(0.5 + 40 / (covered - 183), 6);
    // Before 3b.13 the surface was 5:4 — on a 400 px wide one this picture
    // overflowed by 27 px, so the same drag ran the focal to its end.
    expect(last.focalX).toBeLessThan(0.6);
    // The picture spans the window's height at zoom 1: nothing to pan there.
    expect(last.focalY).toBe(0.5);
  });

  it("aftermath's flat window: a vertical drag pans (the 5:4 surface had no room to)", () => {
    const onChange = vi.fn();
    render(<Harness template="aftermath" onChange={onChange} />);
    layOut({ width: 540, height: 200 }, natural);
    drag(0, 30);
    const last = onChange.mock.calls.at(-1)![0] as ArtPosition;
    const covered = (1200 * 540) / 1600;
    expect(last.focalY).toBeCloseTo(0.5 - 30 / (covered - 200), 6);
    expect(last.focalX).toBe(0.5);
  });

  it("a zoomed-out picture still follows the pointer (it moves WITH the focal)", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 0.5 }} onChange={onChange} />);
    layOut({ width: 400, height: 300 }, natural);
    drag(20, 0);
    const last = onChange.mock.calls.at(-1)![0] as ArtPosition;
    // travel = 400 − 400·0.5 = +200 px per unit of focal.
    expect(last.focalX).toBeCloseTo(0.5 + 20 / 200, 6);
  });

  it("a press that does not move is not a pan", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" onChange={onChange} />);
    layOut({ width: 400, height: 293 }, natural);
    drag(1, 1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the sharpness note", () => {
  it("warns when the picture is under 300 ppi in this window, and follows the frame and the zoom", () => {
    // Scryfall's window crop is soft on the borderless window (TODO 1.18).
    const view = render(<Harness template="m15borderless" />);
    layOut({ width: 341, height: 440 }, { width: 626, height: 457 });
    expect(screen.getByTestId("art-soft-note").textContent).toMatch(/626 × 457 px: about 142 ppi/);
    view.rerender(<Harness template="saga" />);
    expect(screen.getByTestId("art-soft-note").textContent).toMatch(/about 180 ppi/);
  });

  it("says nothing for Scryfall's crop on the classic window it was cut for (295 ppi)", () => {
    render(<Harness template="m15" />);
    layOut({ width: 400, height: 293 }, { width: 626, height: 457 });
    expect(screen.queryByTestId("art-soft-note")).toBeNull();
  });

  it("says nothing for a picture large enough", () => {
    render(<Harness template="m15" />);
    layOut({ width: 400, height: 293 }, { width: 1600, height: 1200 });
    expect(screen.queryByTestId("art-soft-note")).toBeNull();
  });
});

describe("keyboard and buttons", () => {
  it("arrow keys nudge, + and − zoom, R resets", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" onChange={onChange} />);
    const el = surface();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ focalX: 0.51 });
    fireEvent.keyDown(el, { key: "ArrowDown", shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ focalY: 0.55 });
    fireEvent.keyDown(el, { key: "+" });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 1.05 });
    fireEvent.keyDown(el, { key: "r" });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
  });

  it("the zoom buttons work without a wheel or a keyboard, and stop at the renderers' range", async () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 3.95 }} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Zoom" })).toBeTruthy();
    expect(screen.getByTestId("art-zoom-readout").textContent).toBe("395%");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 4 });
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 3.95 });
  });

  it("shows a stored zoom above 3 as it is drawn (the surface used to stop at 3)", () => {
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 3.6 }} />);
    expect(picture().style.transform).toBe("scale(3.6)");
  });

  it("keeps its labels: a focusable group that says how to use it", () => {
    render(<Harness template="m15" />);
    const el = surface();
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("aria-label")).toMatch(/Drag to reposition the art/);
  });
});
