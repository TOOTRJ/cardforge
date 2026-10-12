import { notFound } from "next/navigation";
import { ParityHarness } from "./parity-harness";

// ---------------------------------------------------------------------------
// /dev/parity — the page the preview ⇄ bake parity suite screenshots (TODO
// 3.11, tests/parity, `npm run test:parity`). It mounts the REAL CardPreview
// with a case's data inside the real root layout: the site's stylesheet, its
// font faces, the mana and Keyrune fonts.
//
// NOT a route of the product: the ".parity.tsx" extension is a page
// extension only for the harness's own dev server (next.config.ts
// parityHarnessEnabled) — every other server and every build never compiles
// this file. The check below is the second lock, should that ever change.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default function ParityHarnessPage() {
  if (process.env.PARITY_HARNESS !== "1" || process.env.NODE_ENV !== "development") {
    // Said out loud: a harness run that gets a 404 here was started wrong.
    console.error("[parity] /dev/parity was compiled on a server that is not the parity harness — answering 404.");
    notFound();
  }
  return <ParityHarness />;
}
