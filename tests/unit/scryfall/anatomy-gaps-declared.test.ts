import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — a registry gap is DERIVED from the frame the card lands on
// (frame-signatures.ts gapDrawnBy): once 4.6a / 4.6b declare the crown and
// the pair dresses (tests/unit/cards/anatomy-fixture.ts: m15, m15artifact,
// m15land), a printing whose pieces its frame draws imports `exact`, with no
// second hand-kept list; a piece the frame doesn't draw — a hybrid dress on
// m15artifact, a crown on a layout frame — stays a gap.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import printings from "./fixtures/anatomy-printings.json";

const P = Object.fromEntries(
  Object.entries(printings).map(([key, raw]) => [key, scryfallCardSchema.parse(raw) as ScryfallCard]),
);
const match = (key: string) => frameMatchFromScryfall(P[key]);

describe("gaps the landing frame draws drop out", () => {
  it("a crowned mono, gold, colourless-land or legendary-land printing on m15 / m15land is exact", () => {
    expect(match("fdn-2")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15" });
    expect(match("fdn-122")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15" });
    expect(match("fdn-122").gaps).toBeUndefined();
    expect(match("fdn-243")).toMatchObject({ status: "exact", signature: "era/2015" });
    expect(match("neo-268")).toMatchObject({ status: "exact", template: "m15land" });
    // Dark Depths UMA #241: a crowned colourless land on the land frame.
    expect(match("uma-241")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15land" });
  });

  it("the hybrid dress on m15, the gold-split pair on m15artifact and m15land", () => {
    expect(match("tla-212")).toMatchObject({ status: "exact", template: "m15" });
    expect(match("stx-175")).toMatchObject({ status: "exact", template: "m15" });
    expect(match("dft-219")).toMatchObject({ status: "exact", template: "m15artifact" });
    expect(match("mkm-264")).toMatchObject({ status: "exact", template: "m15land" });
  });

  it("a dress or a crown the frame doesn't draw stays a gap", () => {
    // m15artifact has no hybrid masters (no hybrid artifact plate yet).
    expect(match("eld-206")).toMatchObject({
      status: "nearest",
      template: "m15artifact",
      signature: "era/2015+two-colour-hybrid",
    });
    // The layout frames draw no crown and no pair until 4.6f.
    expect(match("woe-220")).toMatchObject({ status: "nearest", signature: "layout/2015+crown" });
    expect(match("khm-201")).toMatchObject({ status: "nearest", signature: "layout/2015+two-colour" });
  });
});
