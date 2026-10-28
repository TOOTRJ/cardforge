// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { sameData, useStableValue } from "@/components/creator/use-stable-value";
import { CREATOR_ASIDE_QUERY, useMediaQuery } from "@/components/creator/use-media-query";

// TODO 3b.9 — the creator's live preview props are rebuilt on every render
// of the form; kept by identity while they hold the same data, the memoised
// preview skips a render that would draw the same card.

describe("sameData", () => {
  it("compares plain objects and arrays by their members", () => {
    expect(sameData({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData(null, {})).toBe(false);
  });

  it("compares functions and other instances by identity", () => {
    const fn = () => {};
    expect(sameData({ fn }, { fn })).toBe(true);
    expect(sameData({ fn }, { fn: () => {} })).toBe(false);
    const map = new Map([["a", 1]]);
    expect(sameData(map, new Map([["a", 1]]))).toBe(false);
    expect(sameData({ map }, { map })).toBe(true);
  });
});

describe("useStableValue", () => {
  it("returns the earlier object while the data is the same, the new one once it changes", () => {
    const first = { title: "A", art: { x: 0.5 } };
    const { result, rerender } = renderHook(({ value }) => useStableValue(value), { initialProps: { value: first } });
    expect(result.current).toBe(first);
    rerender({ value: { title: "A", art: { x: 0.5 } } });
    expect(result.current).toBe(first);
    const changed = { title: "B", art: { x: 0.5 } };
    rerender({ value: changed });
    expect(result.current).toBe(changed);
  });

  it("a nested object changed IN PLACE still reads as a change (the comparison keeps a snapshot)", () => {
    const art = { x: 0.5 };
    const first = { title: "A", art };
    const { result, rerender } = renderHook(({ value }) => useStableValue(value), { initialProps: { value: first } });
    art.x = 0.2;
    const next = { title: "A", art };
    rerender({ value: next });
    expect(result.current).toBe(next);
  });
});

describe("useMediaQuery", () => {
  it("answers the window's query once rendered in the browser", () => {
    const { result } = renderHook(() => useMediaQuery(CREATOR_ASIDE_QUERY));
    expect(result.current).toBe(window.matchMedia(CREATOR_ASIDE_QUERY).matches);
  });
});
