import { describe, expect, it } from "vitest";
import {
  SCAN_HEIGHT,
  SCAN_WIDTH,
  cardBoxFor,
  scanGridFor,
  scanPlacement,
} from "@/lib/frames/scan-geometry";

// Scryfall serves every printing as a 745×1040 PORTRAIT file — battles and
// split cards included, with their landscape layout turned on its side. The
// compare tool and the score route must turn the scan, not our render.

describe("cardBoxFor", () => {
  it("is 5:7 for portrait and 7:5 for landscape", () => {
    expect(cardBoxFor(500, "portrait")).toEqual({ width: 500, height: 700 });
    expect(cardBoxFor(700, "landscape")).toEqual({ width: 700, height: 500 });
  });
});

describe("scanPlacement", () => {
  it("lays a portrait scan straight over a portrait card", () => {
    const place = scanPlacement(372.5, "portrait");
    expect(place.rotateDeg).toBe(0);
    expect(place.imgWidth).toBe(372.5);
    expect(place.imgHeight).toBeCloseTo(521.5, 5);
    expect(place.imgLeft).toBe(0);
    expect(place.imgTop).toBe(0);
  });

  it("turns the scan 90° and centres it so the rotation fills a landscape box", () => {
    const place = scanPlacement(700, "landscape");
    expect(place.boxWidth).toBe(700);
    expect(place.boxHeight).toBe(500);
    expect(place.rotateDeg).toBe(90);
    // Pre-rotation the image is the box on its side …
    expect(place.imgWidth).toBe(500);
    expect(place.imgHeight).toBe(700);
    // … centred on the box, so a turn about its centre lands exactly on it.
    expect(place.imgLeft).toBe(100);
    expect(place.imgTop).toBe(-100);
    expect(place.imgLeft + place.imgWidth / 2).toBe(place.boxWidth / 2);
    expect(place.imgTop + place.imgHeight / 2).toBe(place.boxHeight / 2);
  });
});

describe("scanGridFor", () => {
  it("keeps the scan grid for portrait frames", () => {
    expect(scanGridFor("portrait")).toEqual({
      width: SCAN_WIDTH,
      height: SCAN_HEIGHT,
      rotateDeg: 0,
    });
  });

  it("swaps the grid and rotates the scan for landscape frames", () => {
    expect(scanGridFor("landscape")).toEqual({
      width: SCAN_HEIGHT,
      height: SCAN_WIDTH,
      rotateDeg: 90,
    });
  });
});
