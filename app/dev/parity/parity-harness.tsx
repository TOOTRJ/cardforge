"use client";

import { useEffect, useState } from "react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// The parity harness's client half (TODO 3.11): the browser stage
// (tests/parity/preview.parity.spec.ts) calls window.__parity.show(...) with
// a case's CardPreviewData — the SAME object the bake stage baked — and
// screenshots #parity-card. Imported by app/dev/parity/page.parity.tsx only,
// which no production build compiles.
//
// The card is drawn with the stored bake's contract: the pipglyph.com mark
// on, no custom footer text. `staticInEditor`, `flipOnClick` and the dropped
// shadow only remove what is not the card: the hover lift, the corner flip
// BUTTON a two-faced card shows on a tile (the whole-card flip has no
// button), a shadow in the corner cuts.
// ---------------------------------------------------------------------------

type Shown = {
  /** A fresh mount per case: no state, transition or cached fit carries over. */
  key: string;
  card: CardPreviewData;
  face: "front" | "back";
  /** The card's CSS width (its SHORT side is the 5 of 5:7 for a portrait
   *  card; a landscape card is given its long side). */
  width: number;
};

declare global {
  interface Window {
    __parity?: { show: (next: Shown | null) => void };
  }
}

export function ParityHarness() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    window.__parity = { show: setShown };
    document.documentElement.dataset.parityReady = "1";
    return () => {
      delete window.__parity;
    };
  }, []);

  return (
    <div
      // Above every island of the root layout, on the grey the bake's
      // transparent corners are flattened onto (tests/parity/shared.ts).
      style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgb(128, 128, 128)", overflow: "hidden" }}
    >
      {shown ? (
        <div id="parity-card" key={shown.key} data-case={shown.key} style={{ position: "absolute", left: 0, top: 0, width: shown.width }}>
          <CardPreview {...shown.card} face={shown.face} brandMark footerWatermark={null} staticInEditor flipOnClick className="shadow-none" />
        </div>
      ) : null}
    </div>
  );
}
