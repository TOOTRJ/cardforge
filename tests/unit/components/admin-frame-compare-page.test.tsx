// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import registryPrintings from "../cards/fixtures/reference-printings.json";

// ---------------------------------------------------------------------------
// /admin/frame-compare's compare mode (?template=&color=) builds its render
// from the reference printing, looked up on Scryfall at request time. A
// lookup that THROWS — Scryfall unreachable, a reset connection; a 404
// answers null — must not error the page: it falls back to the combo's
// sample content and says "Reference lookup failed", the way the sign-off's
// side-by-side does (TODO 0.18 follow-up). Only the page's data sources and
// its client islands are stubbed; the registry, the header and the
// verification state are real.
//
// ONE picture (TODO 5.0d, the last block): on a double-faced reference the
// page hands its live preview exactly what the Score button's bake is
// handed — the payload's preview, cross-face block and printed icon family
// included — on the REAL payload builder, scorer and CardPreview over the
// registry's captured printings (only the bake itself, the scan download and
// the alignment are stubbed).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "admin-1", is_admin: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => false,
  createAdminClient: () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/cards/rebake-batch", () => ({ countMarkedRenders: async () => 0 }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => new Map() }));
vi.mock("@/lib/cards/frame-review-events", () => ({ listFrameReviewEvents: async () => [] }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/cards/frame-preview-cards", () => ({ listFramePreviewCards: async () => [] }));
const payloads = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("@/lib/scryfall/reference-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/reference-preview")>();
  return { FrameCompareFaceError: actual.FrameCompareFaceError, buildFrameComparePayload: payloads.build };
});
// Scryfall: a captured printing and a stand-in scan where a test serves
// them (the ONE-picture block); the real client otherwise — the "network
// down" case below drives it.
const scryfall = vi.hoisted(() => ({ cards: new Map<string, unknown>(), scan: null as Uint8Array | null }));
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    getCardById: async (id: string) =>
      scryfall.cards.has(id) ? actual.scryfallCardSchema.parse(scryfall.cards.get(id)) : actual.getCardById(id),
    fetchScryfallImage: async (url: string) => {
      const scan = scryfall.scan;
      if (!scan) return actual.fetchScryfallImage(url);
      return { blob: { arrayBuffer: async () => scan.slice().buffer } as unknown as Blob, contentType: "image/png" };
    },
  };
});
// The Score button's bake and alignment (lib/frames/score-combo.ts): what
// the bake is HANDED is the point; the pixels and the scoring have their
// own tests.
const scorer = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: scorer.render }));
vi.mock("@/lib/frames/align", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frames/align")>();
  return {
    ...actual,
    alignAndScore: () => ({ overall: 1, perSlot: {}, global: { dxPx: 0, dyPx: 0, dxPct: 0, dyPct: 0, confidence: 1 } }),
  };
});

// Client islands and panels: what the page hands them is what matters.
vi.mock("@/components/layout/dashboard-shell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
const compare = vi.hoisted(() => ({ preview: null as unknown }));
vi.mock("@/components/admin/frame-compare", () => ({
  FrameCompare: (props: { preview: { title?: string }; scanUrl: string | null; face?: string | null }) => {
    compare.preview = props.preview;
    return (
      <div data-testid="frame-compare" data-scan={props.scanUrl ?? "none"} data-face={props.face ?? ""}>
        {props.preview.title}
      </div>
    );
  },
}));
vi.mock("@/components/admin/frame-review-checklist", () => ({ FrameReviewChecklist: () => null }));
vi.mock("@/components/admin/frame-verify-checkbox", () => ({ FrameVerifyCheckbox: () => null }));
vi.mock("@/components/admin/frame-reference-picker", () => ({ FrameReferencePicker: () => null }));
vi.mock("@/components/admin/frame-guide", () => ({ FrameGuide: () => null }));
vi.mock("@/components/admin/marked-renders-panel", () => ({ MarkedRendersPanel: () => null }));
vi.mock("@/components/admin/frame-template-signoff-page", () => ({ FrameTemplateSignOffPage: () => null }));

import AdminFrameComparePage from "@/app/(app)/admin/frame-compare/page";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { frontPreviewData } from "@/lib/cards/faces";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import {
  FRAME_REFERENCES,
  frameReferenceOptions,
  sampleFramePreview,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { scoreFrameCombo } from "@/lib/frames/score-combo";
import type { FrameTemplate } from "@/types/card";

const REFERENCE = FRAME_REFERENCES.m15.w!;
const SCAN = "https://cards.scryfall.io/png/front/a/b/scan.png";

async function renderPage(params: { template?: string; color?: string; ref?: string; face?: string }) {
  const tree = await AdminFrameComparePage({ searchParams: Promise.resolve(params) });
  return render(tree);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  payloads.build.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe("/admin/frame-compare — the reference lookup", () => {
  it("fixture: m15/w has a registry printing", () => {
    expect(REFERENCE.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("renders the printing when the lookup answers", async () => {
    payloads.build.mockResolvedValue({ preview: { title: "From Scryfall" }, scanUrl: SCAN });
    await renderPage({ template: "m15", color: "w" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
    expect(screen.getByText(new RegExp(`^Reference: ${REFERENCE.name}`))).toBeTruthy();
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe("From Scryfall");
    expect(compare.dataset.scan).toBe(SCAN);
  });

  it("a lookup that throws shows the sample content and says so, instead of erroring the page", async () => {
    payloads.build.mockRejectedValue(new TypeError("fetch failed"));
    await renderPage({ template: "m15", color: "w" });
    expect(
      screen.getByText(
        `Reference lookup failed (${REFERENCE.name}) — showing sample content instead. Reload to retry.`,
      ),
    ).toBeTruthy();
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe(sampleFramePreview("m15", "w").title);
    expect(compare.dataset.scan).toBe("none");
    // Logged for the server's logs — the combo and the reason, nothing else.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("m15/w");
    expect(warn.mock.calls[0][1]).toBe("fetch failed");
  });

  it("the REAL lookup with the network down (Scryfall's fetch throws) takes the same fallback", async () => {
    // Not a mocked rejection: the real buildFrameComparePayload → getCardById
    // → scryfallFetch, with only `fetch` itself failing the way undici does
    // when Scryfall is unreachable. The client lets that throw (it returns
    // null only for an answered 404), which is what errored the page.
    const actual = await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>(
      "@/lib/scryfall/reference-preview",
    );
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    payloads.build.mockImplementation(actual.buildFrameComparePayload);
    try {
      await renderPage({ template: "m15", color: "w" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`/cards/${REFERENCE.scryfallId}`);
    expect(
      screen.getByText(
        `Reference lookup failed (${REFERENCE.name}) — showing sample content instead. Reload to retry.`,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("frame-compare").textContent).toBe(sampleFramePreview("m15", "w").title);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe("fetch failed");
  });

  it("a lookup that answers null (no such card) takes the same fallback", async () => {
    payloads.build.mockResolvedValue(null);
    await renderPage({ template: "m15", color: "w" });
    expect(screen.getByText(/^Reference lookup failed/)).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("/admin/frame-compare — the face compared (TODO 5.0b)", () => {
  const BACK_SCAN = "https://cards.scryfall.io/png/back/a/b/scan.png";

  it("the front by default, with no face switch for a single-faced printing", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Serra Angel" },
      scanUrl: SCAN,
      face: "front",
      faceName: null,
      hasBackScan: false,
    });
    await renderPage({ template: "m15", color: "w" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
    expect(screen.queryByTestId("face-switcher")).toBeNull();
    expect(screen.getByTestId("frame-compare").dataset.face).toBe("front");
    expect(screen.getByText(`Reference: ${REFERENCE.name} (${REFERENCE.set.toUpperCase()}).`)).toBeTruthy();
  });

  it("?face=back renders the printing's back against its back scan, names the face, and offers both faces", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Avacyn, the Purifier" },
      scanUrl: BACK_SCAN,
      face: "back",
      faceName: "Avacyn, the Purifier",
      hasBackScan: true,
    });
    await renderPage({ template: "m15", color: "w", face: "back" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "back");
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe("Avacyn, the Purifier");
    expect(compare.dataset.scan).toBe(BACK_SCAN);
    expect(compare.dataset.face).toBe("back");
    expect(
      screen.getByText(`Reference: ${REFERENCE.name} (${REFERENCE.set.toUpperCase()}) — back face (Avacyn, the Purifier).`),
    ).toBeTruthy();
    const switcher = screen.getByTestId("face-switcher");
    expect(switcher.dataset.face).toBe("back");
    const links = Array.from(switcher.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Front", "/admin/frame-compare?template=m15&color=w"],
      ["Back · Avacyn, the Purifier", "/admin/frame-compare?template=m15&color=w&face=back"],
    ]);
    // The walk opens the stepper on the back.
    const walk = screen.getByText(/^Walk the stepper on m15\/w \(back face\)/).closest("a");
    expect(walk?.getAttribute("href")).toContain("face=back");
    expect(screen.getByText(/as a legacy back draws today/)).toBeTruthy();
  });

  it("a two-faced printing on the front offers the back", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Archangel Avacyn" },
      scanUrl: SCAN,
      face: "front",
      faceName: "Archangel Avacyn",
      hasBackScan: true,
    });
    await renderPage({ template: "m15", color: "w" });
    const switcher = screen.getByTestId("face-switcher");
    expect(switcher.dataset.face).toBe("front");
    expect(Array.from(switcher.querySelectorAll("a")).map((a) => a.textContent)).toEqual([
      "Front · Archangel Avacyn",
      "Back",
    ]);
    expect(screen.getByText(/front face \(Archangel Avacyn\)\./)).toBeTruthy();
  });

  it("a face the printing can't show is named, and the sample stands in", async () => {
    const actual = await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>(
      "@/lib/scryfall/reference-preview",
    );
    payloads.build.mockRejectedValue(new actual.FrameCompareFaceError("Serra Angel has no second face to compare."));
    await renderPage({ template: "m15", color: "w", face: "back" });
    expect(screen.getByText("Serra Angel has no second face to compare. Showing sample content instead.")).toBeTruthy();
    expect(screen.getByTestId("frame-compare").textContent).toBe(sampleFramePreview("m15", "w").title);
    // Not a failure worth a log line.
    expect(warn).not.toHaveBeenCalled();
    // The switch still offers the way back to the front.
    const switcher = screen.getByTestId("face-switcher");
    expect(Array.from(switcher.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Front", "Back"]);
  });

  it("a value that names no face is the front", async () => {
    payloads.build.mockResolvedValue({ preview: { title: "x" }, scanUrl: SCAN, face: "front", faceName: null, hasBackScan: false });
    await renderPage({ template: "m15", color: "w", face: "sideways" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
  });

  it("the walk link carries the registry alternate on screen (?ref=) and the face, so the walk seeds from the SAME printing", async () => {
    // extendedart/w lists a double-faced alternate (LCI's Unstable
    // Glyphbridge); its back view is reached only through ?ref=, and a
    // walk that dropped it would open on the default printing's front.
    const alternate = FRAME_REFERENCES.extendedart.w!;
    const glyphbridge = (await import("@/lib/cards/frame-reference-registry")).frameReferenceOptions("extendedart", "w")[1]!;
    expect(glyphbridge.scryfallId).not.toBe(alternate.scryfallId);
    payloads.build.mockResolvedValue({
      preview: { title: "Sandswirl Wanderglyph" },
      scanUrl: BACK_SCAN,
      face: "back",
      faceName: "Sandswirl Wanderglyph",
      hasBackScan: true,
    });
    await renderPage({ template: "extendedart", color: "w", ref: glyphbridge.scryfallId, face: "back" });
    expect(payloads.build).toHaveBeenCalledWith(glyphbridge.scryfallId, "extendedart", "back");
    const walk = screen.getByText(/^Walk the stepper on extendedart\/w \(back face\)/).closest("a");
    const href = new URL(walk!.getAttribute("href")!, "https://pipglyph.test");
    expect(href.pathname).toBe("/create");
    expect(href.searchParams.get("ref")).toBe(glyphbridge.scryfallId);
    expect(href.searchParams.get("face")).toBe("back");
    expect(href.searchParams.get("template")).toBe("extendedart");
    // The default printing on screen names no ref: the link is the row's.
    payloads.build.mockResolvedValue({ preview: { title: "x" }, scanUrl: SCAN, face: "front", faceName: null, hasBackScan: false });
    cleanup();
    await renderPage({ template: "extendedart", color: "w" });
    const plain = screen.getByText(/^Walk the stepper on extendedart\/w$/).closest("a");
    expect(new URL(plain!.getAttribute("href")!, "https://pipglyph.test").searchParams.has("ref")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TODO 5.0d — the compare page and the Score button are handed ONE picture.
// The live preview (CardPreview) derives a double-faced FRONT's cross-face
// block by itself; the bake derives nothing. The scorer handed the bake the
// payload's preview as it was, so a front was scored without its reverse
// P/T, its icon rider and its modal strip beside a page that drew them, and
// both drew the default ▲ / ▼ family whatever the printing's. The payload
// now carries the block and the printed family, so the two inputs are the
// same object for object — and stay so.
// ---------------------------------------------------------------------------

describe("/admin/frame-compare — the page and the Score button are handed ONE picture (TODO 5.0d)", () => {
  let standIn: Uint8Array;
  beforeAll(async () => {
    standIn = new Uint8Array(
      await sharp(Buffer.alloc(8 * 8 * 4, 255), { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer(),
    );
  });

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>(
      "@/lib/scryfall/reference-preview",
    );
    payloads.build.mockImplementation(actual.buildFrameComparePayload);
    for (const [id, card] of Object.entries(registryPrintings)) scryfall.cards.set(id, card);
    scryfall.scan = standIn;
    scorer.render.mockReset();
    scorer.render.mockImplementation(async () => ({ arrayBuffer: async () => standIn.slice().buffer }));
    compare.preview = null;
  });
  afterEach(() => {
    scryfall.cards.clear();
    scryfall.scan = null;
  });

  /** What the compare view's live preview DRAWS from the page's prop — the
   *  real CardPreview, called as components/admin/frame-compare.tsx calls
   *  it; the face under test is the first one drawn. */
  function previewDraws(preview: CardPreviewData) {
    const html = renderToStaticMarkup(<CardPreview {...preview} staticInEditor />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const face =
      doc.querySelector<HTMLElement>("[aria-hidden][style*='backface-visibility']") ?? (doc.body as HTMLElement);
    return {
      overlays: Array.from(face.querySelectorAll("[data-frame-overlay]")).map(
        (el) => `${el.getAttribute("data-frame-overlay")}:${el.getAttribute("data-overlay-key")}`,
      ),
      reversePt: face.querySelector('[data-testid="reverse-pt"]')?.textContent ?? null,
      stripWord: face.querySelector('[data-testid="flipside-word"]')?.textContent ?? null,
    };
  }

  /** The overlays the BAKE resolves from what it is handed (its
   *  anatomyFactsOf: the `dfc` block as given, never derived) — the one
   *  rule both renderers share (lib/cards/anatomy.ts). */
  function bakeOverlays(card: CardPreviewData): string[] {
    return resolveFrameOverlays(getFrameProfile(card.frameStyle?.template), card.frameStyle, {
      colors: card.colorIdentity,
      cost: card.cost,
      cardType: card.cardType,
      supertype: card.supertype,
      rarity: card.rarity,
      dfc: card.dfc ? { role: card.dfc.role, icon: card.dfc.icon, stripKey: card.dfc.otherFace.stripKey } : null,
      colorKey: pickFrameColorKey(card.colorIdentity),
    }).map((overlay) => `${overlay.anatomy}:${overlay.key}`);
  }

  type Case = {
    label: string;
    template: FrameTemplate;
    color: FrameColorKey;
    /** The registry alternate (`?ref=`); 0 = the row's default. */
    index?: number;
    printing: string;
    /** The cross-face block both are handed. */
    block: Record<string, unknown>;
    /** …and what the live preview draws from it. */
    draws: { overlays: string[]; reversePt: string | null; stripWord: string | null };
  };

  const CASES: Case[] = [
    {
      label: "a transform front (MOM #43): the ▲ and the back's 4/3 in the tab",
      template: "m15dfcfront",
      color: "w",
      printing: "mom Tarkir Duneshaper",
      block: { layout: "transform", role: "front", icon: "arrows", otherFace: { printsPt: true, power: "4", toughness: "3" } },
      draws: { overlays: ["dfcIcon:default"], reversePt: "4/3", stripWord: null },
    },
    {
      label: "a sun / moon front (MID #169): the SUN, not the ▲",
      template: "m15dfcfront",
      color: "g",
      index: 1,
      printing: "mid Bird Admirer",
      block: { layout: "transform", role: "front", icon: "sunmoon", otherFace: { printsPt: true, power: "3", toughness: "5" } },
      draws: { overlays: ["dfcIcon:sun"], reversePt: "3/5", stripWord: null },
    },
    {
      label: "the 2016–22 back (MID #27): the MOON in the left well, not the ▼",
      template: "m15dfcbackleft",
      color: "w",
      printing: "mid Luminous Phantom",
      block: { layout: "transform", role: "back", icon: "sunmoon", otherFace: { typeWord: "Cleric", line: "{W}" } },
      draws: { overlays: ["dfcIcon:moon"], reversePt: null, stripWord: null },
    },
    {
      label: "the ▼ back (INR #60): no rider — its ▼ is the master's",
      template: "m15dfcback",
      color: "u",
      printing: "inr Insectile Aberration",
      block: { layout: "transform", role: "back", icon: "arrows", otherFace: { typeWord: "Wizard", line: "{U}" } },
      draws: { overlays: [], reversePt: null, stripWord: null },
    },
    {
      label: "a modal front (STX #147): the strip names the blue sorcery, on the blue tab",
      template: "m15mdfcfront",
      color: "g",
      index: 1,
      printing: "stx Augmenter Pugilist",
      block: { layout: "modal", role: "front", icon: null, otherFace: { typeWord: "Sorcery", line: "{3}{U}{U}", stripKey: "u" } },
      draws: { overlays: ["mdfcStrip:u"], reversePt: null, stripWord: "Sorcery" },
    },
    {
      label: "a pathway front (ZNR #259): the strip names the black land, on the black tab",
      template: "m15mdfclandfront",
      color: "w",
      printing: "znr Brightclimb Pathway",
      block: { layout: "modal", role: "front", icon: null, otherFace: { typeWord: "Land", line: "{T}: Add {B}.", stripKey: "b" } },
      draws: { overlays: ["mdfcStrip:b"], reversePt: null, stripWord: "Land" },
    },
  ];

  it.each(CASES.map((entry) => [entry.label, entry] as const))("%s", async (_label, { template, color, index = 0, printing, block, draws }) => {
    const reference = frameReferenceOptions(template, color)[index];
    expect(`${reference.set} ${reference.name}`).toBe(printing);
    const ref = index > 0 ? reference.scryfallId : undefined;

    // The page: the real printing (never the sample), and what it hands the
    // live preview.
    await renderPage({ template, color, ...(ref ? { ref } : {}) });
    expect(screen.getByText(new RegExp(`^Reference: ${reference.name} \\(${reference.set.toUpperCase()}\\)`))).toBeTruthy();
    const shown = compare.preview as CardPreviewData;
    expect(shown.title).toBe(reference.name);
    expect(shown.dfc).toMatchObject(block);

    // The Score button, on the same combination.
    const result = await scoreFrameCombo({ template, color, ref });
    expect(result).toMatchObject({ ok: true, referenceId: reference.scryfallId });
    expect(scorer.render).toHaveBeenCalledTimes(1);
    const baked = scorer.render.mock.calls[0][0] as CardPreviewData;

    // ONE picture: object for object.
    expect(baked).toEqual(shown);
    // The live preview derives a front's block again from this very card —
    // and finds the one it was handed (nothing left for a renderer to add).
    expect(frontPreviewData(shown).dfc).toEqual(shown.dfc);
    // What the preview draws is what the bake resolves from its own input.
    const drawn = previewDraws(shown);
    expect(drawn).toEqual(draws);
    expect(bakeOverlays(baked)).toEqual(drawn.overlays);
  });

  it("a single-faced reference: the same object too, with no block on either", async () => {
    // The registry capture keeps scans for the double-faced printings only.
    scryfall.cards.set(REFERENCE.scryfallId, {
      ...(scryfall.cards.get(REFERENCE.scryfallId) as object),
      image_uris: { png: SCAN },
    });
    await renderPage({ template: "m15", color: "w" });
    const shown = compare.preview as CardPreviewData;
    expect(shown.title).toBe(REFERENCE.name);
    expect(shown).not.toHaveProperty("dfc");
    const result = await scoreFrameCombo({ template: "m15", color: "w" });
    expect(result).toMatchObject({ ok: true, referenceId: REFERENCE.scryfallId });
    expect(scorer.render.mock.calls[0][0]).toEqual(shown);
  });
});
