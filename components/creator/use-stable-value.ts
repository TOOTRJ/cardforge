"use client";

import { useRef } from "react";

/** True when two values hold the same data: plain objects and arrays compared
 *  member by member, everything else (functions, class instances, React
 *  elements' owners…) by identity. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, i) => sameData(item, other[i]));
  }
  const protoA = Object.getPrototypeOf(a);
  if (protoA !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * `value` itself, or the value this hook returned last render when the two
 * hold the same data (`sameData`). The creator's live preview props are
 * rebuilt on every keystroke of every field (TODO 3b.9): kept by identity
 * while they say the same thing, the memoised preview — and the face
 * preview's deferred copy — skip a render that would draw the same card.
 */
export function useStableValue<T>(value: T): T {
  const ref = useRef(value);
  // A ref read and written during render is safe here: the value it holds
  // is a pure function of the props compared, never of a past render's
  // effects, and a discarded render's write only keeps an equal object.
  // eslint-disable-next-line react-hooks/refs
  if (!sameData(ref.current, value)) ref.current = value;
  // eslint-disable-next-line react-hooks/refs
  return ref.current;
}
