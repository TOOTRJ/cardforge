import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/pdf — print is always SQUARE (TODO 3.26, owner decision
// 2026-09-27): the single-card page and the Letter/A4 3×3 sheets are cut
// along the rectangle and its crop marks, so the live render asks for
// corners "square" (the corner outside the arc in the border black), never
// the rounded, transparent display bake.
// ---------------------------------------------------------------------------

const ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: ID, slug: "c", title: "Card", owner_id: "o", visibility: "public", frame_style: {} },
          }),
        }),
      }),
    }),
  }),
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ isPaid: true, allowBatchExport: true, removeWatermark: true }),
  downloadBrandMark: () => false,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/cards/bake-core", () => ({ rowToPreviewData: () => ({ frameStyle: {} }) }));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: state.render }));

import { GET } from "@/app/api/cards/[id]/pdf/route";
import { NextRequest } from "next/server";

beforeEach(async () => {
  const png = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: "#000000" } })
    .png()
    .toBuffer();
  state.render.mockReset();
  state.render.mockImplementation(async () => new Response(new Uint8Array(png)));
});

describe("card PDF download", () => {
  it.each(["layout=card", "layout=sheet&paper=letter", "layout=sheet&paper=a4"])(
    "%s renders the card SQUARE for print",
    async (query) => {
      const res = await GET(new NextRequest(`http://localhost/api/cards/${ID}/pdf?${query}`), {
        params: Promise.resolve({ id: ID }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", {
        brandMark: false,
        watermarkText: null,
        corners: "square",
      });
    },
  );
});
