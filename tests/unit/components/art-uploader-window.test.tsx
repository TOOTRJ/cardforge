// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { artPositionerWindows, faceArtWindow, type ArtWindow } from "@/lib/cards/art-positioner-window";
import type { ArtPosition, FrameTemplate } from "@/types/card";
import { chipOff } from "../helpers/chip";

// ---------------------------------------------------------------------------
// The art positioner's surface is the card's art window (TODO 3b.13): with
// art loaded it takes the window's aspect, follows a frame change, lays the
// picture out with the renderers' own CSS, and a drag moves the grabbed
// point with the pointer on that box.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/cards/art-upload-client", () => ({ uploadCardArtFile: vi.fn() }));

import { ART_POSITIONER_INSTRUCTIONS, ArtUploader } from "@/components/creator/art-uploader";

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

  it("the empty dropzone is named by what it shows: its heading, then its own words", () => {
    // An aria-label in other words ("Drop an image here or click to upload")
    // hid the prompt, the paste hint and the best size from a screen reader,
    // and from voice control, which matches the words on the screen.
    render(<Harness template="m15" artUrl={null} />);
    expect(surface().hasAttribute("aria-label")).toBe(false);
    const button = screen.getByRole("button", { name: /^Artwork Drag art here, or click to choose/ });
    expect(button).toBe(surface());
    expect(screen.getByRole("button", { name: /Best results: 1271 × 931 px or larger$/ })).toBe(surface());
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
  it("arrow keys nudge, + and − zoom, R fits the picture to the frame again", () => {
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
    expect(chipOff(screen.getByRole("button", { name: "Zoom in" }))).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 3.95 });
  });

  // TODO 3b.32: the press that takes a button to its limit used to disable
  // it under the keyboard focus, which a browser drops to the page top. It
  // goes aria-disabled instead: it keeps the focus and does nothing.
  it("Zoom in / Zoom out / Fit to frame keep the keyboard focus when their own press takes them off", async () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 3.95 }} onChange={onChange} />);
    const zoomIn = screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement;
    zoomIn.focus();
    await act(async () => {
      fireEvent.click(zoomIn);
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 4 });
    expect(zoomIn.disabled).toBe(false);
    expect(chipOff(zoomIn)).toBe(true);
    expect(document.activeElement).toBe(zoomIn);
    const calls = onChange.mock.calls.length;
    await act(async () => {
      fireEvent.click(zoomIn);
    });
    expect(onChange.mock.calls.length).toBe(calls);

    // Fit to frame: back on the fit, the button off and still focused.
    const fit = screen.getByRole("button", { name: /Fit to frame/ }) as HTMLButtonElement;
    fit.focus();
    await act(async () => {
      fireEvent.click(fit);
    });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
    expect(chipOff(fit)).toBe(true);
    expect(fit.disabled).toBe(false);
    expect(document.activeElement).toBe(fit);
  });

  it("Zoom out keeps the focus when it reaches 100 %", async () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 1.05 }} onChange={onChange} />);
    const zoomOut = screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
    zoomOut.focus();
    await act(async () => {
      fireEvent.click(zoomOut);
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 1 });
    expect(zoomOut.disabled).toBe(false);
    expect(chipOff(zoomOut)).toBe(true);
    expect(document.activeElement).toBe(zoomOut);
  });

  it("shows a stored zoom above 3 as it is drawn (the surface used to stop at 3)", () => {
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 3.6 }} />);
    expect(picture().style.transform).toBe("scale(3.6)");
  });

  it("is a focusable group named by its heading and described by how to use it (3b.33)", () => {
    render(<Harness template="m15" />);
    const el = surface();
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.hasAttribute("aria-label")).toBe(false);
    // The accessible name is the heading alone, never the sentence.
    const group = screen.getByRole("group", { name: "Artwork" });
    expect(group).toBe(el);
    const described = group.getAttribute("aria-describedby")!;
    expect(document.getElementById(described)?.textContent).toBe(ART_POSITIONER_INSTRUCTIONS);
    expect(screen.queryByRole("group", { name: /Drag to reposition/ })).toBeNull();
  });

  it("takes a face's heading as its name", () => {
    render(
      <ArtUploader
        userId="u"
        heading="Back face — Artwork"
        artUrl={ART}
        artPosition={{ focalX: 0.5, focalY: 0.5, scale: 1 }}
        artWindow={windowOn("m15")}
        onArtChange={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "Back face — Artwork" })).toBe(surface());
  });

  it("empty, stays a button named by its heading and its own words", () => {
    render(<Harness template="m15" artUrl={null} />);
    const el = surface();
    expect(el.getAttribute("role")).toBe("button");
    expect(el.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.getByRole("button", { name: /^Artwork / })).toBe(el);
  });
});

describe("a picture that loaded before React attached onLoad (an edit page's server HTML)", () => {
  // The browser fires `load` once. An edit page's art <img> is in the server
  // HTML and usually cached, so by hydration the event is gone: the size
  // must be read from the element when it mounts, or the art cannot be
  // dragged and never gets its sharpness note.
  function withCompletePictures(natural: { width: number; height: number }, run: () => void) {
    const proto = HTMLImageElement.prototype;
    const saved = ["complete", "naturalWidth", "naturalHeight"].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
    Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
    Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => natural.width });
    Object.defineProperty(proto, "naturalHeight", { configurable: true, get: () => natural.height });
    try {
      run();
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[key];
      }
    }
  }

  it("drags and shows the sharpness note with no load event", () => {
    withCompletePictures({ width: 626, height: 457 }, () => {
      const onChange = vi.fn();
      render(<Harness template="m15borderless" onChange={onChange} />);
      const el = surface();
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 341 });
      Object.defineProperty(el, "clientHeight", { configurable: true, value: 440 });
      el.setPointerCapture = vi.fn();
      el.releasePointerCapture = vi.fn();
      // No fireEvent.load: the size came from the mounted element.
      expect(screen.getByTestId("art-soft-note").textContent).toContain("626 × 457");
      drag(40, 0);
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls.at(-1)![0].focalX).toBeLessThan(0.5);
    });
  });

  it("an incomplete picture waits for its load", () => {
    render(<Harness template="m15borderless" />);
    expect(screen.queryByTestId("art-soft-note")).toBeNull();
    layOut({ width: 341, height: 440 }, { width: 626, height: 457 });
    expect(screen.getByTestId("art-soft-note").textContent).toContain("626 × 457");
  });
});

describe("Shift-scroll zoom", () => {
  // A native wheel event, as the browser sends it (React's own wheel
  // listeners are passive: a preventDefault there is ignored and the page
  // scrolls under the zoom).
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
    // happy-dom's WheelEvent carries no modifier keys.
    Object.defineProperty(event, "shiftKey", { value: init.shiftKey === true });
    act(() => {
      surface().dispatchEvent(event);
    });
    return event;
  };

  it("zooms and keeps the page still; a plain wheel is left to the page", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" onChange={onChange} />);
    const plain = wheel({ deltaY: 120 });
    expect(plain.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    // A zoom-out at 100 % is still the positioner's gesture (the page stays
    // still) but changes nothing: the zoom stops at the cover fit.
    const out = wheel({ deltaY: 120, shiftKey: true });
    expect(out.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    wheel({ deltaY: -120, shiftKey: true });
    wheel({ deltaY: -120, shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1.1);
    wheel({ deltaY: 120, shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1.05);
  });

  it("reads the turn from deltaX (Shift makes a vertical wheel horizontal on macOS and in Chrome)", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 1.1 }} onChange={onChange} />);
    const out = wheel({ deltaX: 120, deltaY: 0, shiftKey: true });
    expect(out.defaultPrevented).toBe(true);
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1.05);
    wheel({ deltaX: -120, deltaY: 0, shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1.1);
  });
});

// ---------------------------------------------------------------------------
// The automatic fit (TODO 3b.18): the positioner says whether the picture is
// on its fit or placed by hand, offers ONE way back (the button and R / 0),
// and warns when a zoom leaves the window part empty.
// ---------------------------------------------------------------------------
describe("fitted or placed by hand", () => {
  const status = () => screen.getByTestId("art-fit-status");
  const fit = () => screen.getByRole("button", { name: /Fit to frame/ }) as HTMLButtonElement;

  it("a fresh picture is fitted: the line says so and the button has nothing to do", () => {
    render(<Harness template="saga" />);
    expect(status().dataset.artFraming).toBe("fitted");
    expect(status().textContent).toMatch(/Fitted to this frame: the picture fills the art window, centred/);
    expect(chipOff(fit())).toBe(true);
    expect(screen.queryByRole("button", { name: /Reset position/ })).toBeNull();
  });

  it("names the strip a fitted window shows of a much wider picture (a 3 : 1 panorama on a saga)", () => {
    render(<Harness template="saga" />);
    layOut({ width: 183, height: 440 }, { width: 2400, height: 800 });
    expect(status().textContent).toMatch(/which shows the middle 14% of its width/);
  });

  it("a nudge makes it the maker's; Fit to frame puts it back on the fit", async () => {
    const onChange = vi.fn();
    render(<Harness template="saga" onChange={onChange} />);
    fireEvent.keyDown(surface(), { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(surface(), { key: "+" });
    expect(status().dataset.artFraming).toBe("by-hand");
    expect(status().textContent).toMatch(/Placed by hand: your framing is kept when you change the frame/);
    expect(chipOff(fit())).toBe(false);
    await act(async () => {
      fireEvent.click(fit());
    });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
    expect(status().dataset.artFraming).toBe("fitted");
    expect(chipOff(fit())).toBe(true);
  });

  it("a stored hand-set position opens as it is: nothing is written, on any frame", () => {
    const onChange = vi.fn();
    const start = { focalX: 0.21, focalY: 0.83, scale: 1.4 };
    const view = render(<Harness template="m15" start={start} onChange={onChange} />);
    layOut({ width: 400, height: 293 }, { width: 2400, height: 800 });
    view.rerender(<Harness template="saga" start={start} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(picture().style.objectPosition).toBe("21% 83%");
    expect(picture().style.transform).toBe("scale(1.4)");
    expect(status().dataset.artFraming).toBe("by-hand");
  });

  it("warns when the zoom leaves empty space in the window, and stops when it is filled again", () => {
    render(<Harness template="saga" start={{ focalX: 0.5, focalY: 0.5, scale: 0.7 }} />);
    expect(status().textContent).toMatch(/At 70% the picture is smaller than the art window, so empty space shows on the card/);
    expect(chipOff(fit())).toBe(false);
    for (let i = 0; i < 6; i++) fireEvent.keyDown(surface(), { key: "+" });
    expect(screen.getByTestId("art-zoom-readout").textContent).toBe("100%");
    expect(status().textContent).not.toMatch(/empty space/);
  });
});

// ---------------------------------------------------------------------------
// A zoom-out stops at 100 % (owner 2026-10-12): under it the art window is
// part empty on the card. Every way a zoom changes by hand — the buttons,
// the − key, Shift-scroll — goes through the one rule (stepArtZoom); a
// stored zoom under 100 % opens as it is and only ever goes up.
// ---------------------------------------------------------------------------
describe("the zoom stops at 100 % on the way down", () => {
  const out = () => screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
  const zoomIn = () => screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement;
  const readout = () => screen.getByTestId("art-zoom-readout").textContent;
  const wheelOut = () => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    Object.defineProperty(event, "shiftKey", { value: true });
    act(() => {
      surface().dispatchEvent(event);
    });
  };

  it("at 100 % the − button is disabled and the − key and Shift-scroll write nothing", () => {
    const onChange = vi.fn();
    render(<Harness template="saga" onChange={onChange} />);
    expect(chipOff(out())).toBe(true);
    fireEvent.keyDown(surface(), { key: "-" });
    fireEvent.keyDown(surface(), { key: "_" });
    wheelOut();
    expect(onChange).not.toHaveBeenCalled();
    expect(readout()).toBe("100%");
  });

  it("from above 100 % every zoom-out lands on 100 % and stays there", async () => {
    const onChange = vi.fn();
    render(<Harness template="saga" start={{ focalX: 0.3, focalY: 0.6, scale: 1.08 }} onChange={onChange} />);
    expect(chipOff(out())).toBe(false);
    fireEvent.keyDown(surface(), { key: "-" });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.3, focalY: 0.6, scale: 1.03 });
    await act(async () => {
      fireEvent.click(out());
    });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.3, focalY: 0.6, scale: 1 });
    expect(chipOff(out())).toBe(true);
    const writes = onChange.mock.calls.length;
    fireEvent.keyDown(surface(), { key: "-" });
    wheelOut();
    expect(onChange.mock.calls.length).toBe(writes);
  });

  it("a stored zoom under 100 % opens as stored, cannot go lower, and goes up step by step — never back under 100 %", async () => {
    const onChange = vi.fn();
    render(<Harness template="saga" start={{ focalX: 0.4, focalY: 0.5, scale: 0.7 }} onChange={onChange} />);
    // As stored: drawn at 70 %, the warning, nothing written.
    expect(picture().style.transform).toBe("scale(0.7)");
    expect(readout()).toBe("70%");
    expect(screen.getByTestId("art-fit-status").textContent).toMatch(/At 70% .* Zoom in to 100%, or choose Fit to frame, to fill it\. It can't be made smaller\./);
    expect(chipOff(out())).toBe(true);
    fireEvent.keyDown(surface(), { key: "-" });
    wheelOut();
    expect(onChange).not.toHaveBeenCalled();
    // A pan keeps the stored zoom.
    fireEvent.keyDown(surface(), { key: "ArrowLeft" });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ focalX: 0.39, focalY: 0.5, scale: 0.7 });
    // Up one step: 75 %, and 70 % is gone.
    await act(async () => {
      fireEvent.click(zoomIn());
    });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 0.75 });
    expect(chipOff(out())).toBe(true);
    const writes = onChange.mock.calls.length;
    fireEvent.keyDown(surface(), { key: "-" });
    expect(onChange.mock.calls.length).toBe(writes);
    expect(screen.getByTestId("art-fit-status").textContent).toMatch(/At 75%/);
    // Up to 100 % and past it; back down stops at 100 %.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(surface(), { key: "+" });
    expect(readout()).toBe("105%");
    expect(chipOff(out())).toBe(false);
    fireEvent.keyDown(surface(), { key: "-" });
    fireEvent.keyDown(surface(), { key: "-" });
    fireEvent.keyDown(surface(), { key: "-" });
    expect(readout()).toBe("100%");
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ scale: 1 });
    expect(chipOff(out())).toBe(true);
  });

  it("an off-grid stored zoom (97 %) steps to 102 %, then down to 100 %", () => {
    const onChange = vi.fn();
    render(<Harness template="m15" start={{ focalX: 0.5, focalY: 0.5, scale: 0.97 }} onChange={onChange} />);
    fireEvent.keyDown(surface(), { key: "+" });
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1.02);
    fireEvent.keyDown(surface(), { key: "-" });
    expect(onChange.mock.calls.at(-1)![0].scale).toBe(1);
  });
});
