"use client";

// Where the keyboard focus goes when a row of a row editor (a walker's
// abilities, a saga's chapters) is removed. The button that was pressed
// leaves the page with its row, and a focus left on a removed element falls
// back to the top of the document: a keyboard or screen-reader user is
// thrown out of the editor and has to find it again. (Adding a row needs
// nothing: react-hook-form's append puts the focus in the new row.)
//
// The rows mark their remove buttons `data-row-remove` and the editor its
// add button `data-row-add`, inside the element `rootRef` points at. After a
// removal the focus goes to the remove button of the row that took the
// place (the next one), else of the row before, else to "Add" — never
// anywhere while the focus is somewhere else on the page (a mouse user who
// clicked on is left alone).

import { useEffect, useState, type RefObject } from "react";

export function useRowFocus(rootRef: RefObject<HTMLElement | null>): (index: number) => void {
  const [request, setRequest] = useState<{ index: number; tick: number } | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!request || !root) return;
    // Only when the focus was lost with the row (or is still in the editor).
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    const removes = root.querySelectorAll<HTMLElement>("[data-row-remove]");
    const target =
      removes[request.index] ??
      removes[request.index - 1] ??
      root.querySelector<HTMLElement>("[data-row-add]");
    target?.focus();
  }, [request, rootRef]);
  return (index) => setRequest((last) => ({ index, tick: (last?.tick ?? 0) + 1 }));
}
