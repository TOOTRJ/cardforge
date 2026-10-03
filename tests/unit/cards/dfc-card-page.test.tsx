import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildCardJsonLd, CardDetails } from "@/components/cards/card-detail-content";
import { cardPageFacesOf, cardPageName } from "@/lib/cards/emblem";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// TODO 5.3 on the public card page of a DOUBLE-FACED card (a back face with
// a body of its own, on a DFC front body):
//   * its page name is "Front // Back" (cardPageName — Scryfall's spelling;
//     the <title>, H1, breadcrumb, share copy and JSON-LD name) — ONLY on a
//     DFC body: the 8 legacy two-faced pages (a back face on m15) keep the
//     front's name, and the slug call (no faces) never changes;
//   * its CreativeWork JSON-LD gains the back as `hasPart` with its own
//     ImageObject — the back's stored bake through this site's /render-cdn
//     path — and the back's type words in `keywords`; the OG `image` stays
//     the front; a back with no bake yet is a part without an image;
//   * "Card details" lists the back's facts under the front's.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const BACK_BAKE = `${HOST}/storage/v1/object/public/card-renders/${OWNER}/${ID}.back.png?v=7`;

const BACK = {
  title: "Elder Wolf",
  cost: null,
  card_type: "creature",
  supertype: null,
  subtypes: ["Wolf"],
  rules_text: "Trample\nAt the beginning of each upkeep, if a player cast two or more spells last turn, transform Elder Wolf.",
  flavor_text: null,
  power: "4",
  toughness: "4",
  artist_credit: "B. Back",
  frame_style: { template: "m15dfcback" },
  color_identity: ["green"],
};

const DFC = {
  id: ID,
  owner_id: OWNER,
  slug: "village-elder",
  title: "Village Elder",
  cost: "{1}{G}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human", "Werewolf"],
  rarity: "uncommon",
  color_identity: ["green"],
  power: "2",
  toughness: "2",
  loyalty: null,
  defense: null,
  set_icon_code: null,
  layout: "normal",
  artist_credit: "A. Front",
  flavor_text: "The village remembers.",
  rules_text: "Transform.",
  tags: ["werewolves"],
  frame_style: { template: "m15dfcfront", finish: "regular" },
  back_face: BACK,
  rendered_back_image_url: BACK_BAKE,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  rendered_at: "2026-10-02T01:00:00Z",
};

/** The same card as the 8 imported DFCs store it: a back with no body on
 *  an ordinary front, no back bake. */
const LEGACY = (() => {
  const { frame_style: _b, color_identity: _c, ...back } = BACK;
  void _b;
  void _c;
  return { ...DFC, frame_style: { template: "m15", finish: "regular" }, back_face: back, rendered_back_image_url: null };
})();

const SITE = "https://pipglyph.com";

// The back bake's host must be ours for its ImageObject to be named.
beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});

describe("cardPageName — Front // Back (TODO 5.3)", () => {
  it("joins the faces only on a DFC body with a named back", () => {
    expect(cardPageName("Village Elder", "creature", { frameTemplate: "m15dfcfront", backTitle: "Elder Wolf" })).toBe("Village Elder // Elder Wolf");
    expect(cardPageName("Village Elder", "creature", { frameTemplate: "m15dfclandfront", backTitle: " Elder  Wolf " })).toBe("Village Elder // Elder Wolf");
    // The 8 legacy pages: a back face on m15 keeps the front's name.
    expect(cardPageName("Village Elder", "creature", { frameTemplate: "m15", backTitle: "Elder Wolf" })).toBe("Village Elder");
    expect(cardPageName("Village Elder", "creature", { frameTemplate: null, backTitle: "Elder Wolf" })).toBe("Village Elder");
    // An unnamed back (a private draft) is the front's name.
    expect(cardPageName("Village Elder", "creature", { frameTemplate: "m15dfcfront", backTitle: "" })).toBe("Village Elder");
    expect(cardPageName("Village Elder", "creature", { frameTemplate: "m15dfcfront", backTitle: null })).toBe("Village Elder");
    // No faces (the slug call in createCardAction): as before.
    expect(cardPageName("Village Elder", "creature")).toBe("Village Elder");
    expect(cardPageName("Village Elder", "creature", null)).toBe("Village Elder");
    // The emblem rule still applies to the front's half.
    expect(cardPageName("Kaito", "emblem")).toBe("Kaito Emblem");
  });

  it("cardPageFacesOf reads a stored row's columns", () => {
    expect(cardPageFacesOf(DFC)).toEqual({ frameTemplate: "m15dfcfront", backTitle: "Elder Wolf" });
    expect(cardPageFacesOf({ frame_style: null, back_face: null })).toEqual({ frameTemplate: null, backTitle: null });
    expect(cardPageFacesOf({ frame_style: {}, back_face: { title: 7 } })).toEqual({ frameTemplate: null, backTitle: null });
    expect(cardPageName(DFC.title, DFC.card_type, cardPageFacesOf(DFC))).toBe("Village Elder // Elder Wolf");
    expect(cardPageName(LEGACY.title, LEGACY.card_type, cardPageFacesOf(LEGACY))).toBe("Village Elder");
  });
});

describe("JSON-LD of a double-faced card", () => {
  const schema = buildCardJsonLd({ inDecks: [], card: DFC, username: "kesh", ownerDisplay: "Kesh", siteBase: SITE });

  it("is named Front // Back, keeps the OG image as the front, and lists the back as hasPart with its own ImageObject (the back bake)", () => {
    expect(schema.name).toBe("Village Elder // Elder Wolf");
    expect(schema.headline).toBe("Village Elder // Elder Wolf");
    expect(String((schema.image as { url: string }).url).startsWith(`${SITE}/api/cards/${ID}/og`)).toBe(true);
    expect(schema.hasPart).toEqual([
      {
        "@type": "CreativeWork",
        name: "Elder Wolf",
        position: 2,
        description: BACK.rules_text,
        contributor: { "@type": "Person", name: "B. Back" },
        image: {
          "@type": "ImageObject",
          url: `${SITE}/render-cdn/${OWNER}/${ID}.back.png?v=7`,
          width: 1500,
          height: 2100,
          caption: "Elder Wolf — the back face of Village Elder, custom MTG-style Creature — Wolf",
        },
      },
    ]);
    expect(String(schema.keywords).split(", ")).toEqual(expect.arrayContaining(["wolf", "werewolf", "creature", "green", "custom mtg card"]));
  });

  it("a back with no bake yet is a part without an image; another card's object is never named", () => {
    const pending = buildCardJsonLd({ inDecks: [], card: { ...DFC, rendered_back_image_url: null }, username: "kesh", ownerDisplay: "Kesh", siteBase: SITE });
    expect((pending.hasPart as Array<Record<string, unknown>>)[0]).not.toHaveProperty("image");
    const foreign = buildCardJsonLd({
      inDecks: [],
      card: { ...DFC, rendered_back_image_url: BACK_BAKE.replace(ID, "33333333-3333-4333-8333-333333333333") },
      username: "kesh",
      ownerDisplay: "Kesh",
      siteBase: SITE,
    });
    expect((foreign.hasPart as Array<Record<string, unknown>>)[0]).not.toHaveProperty("image");
  });

  it("a legacy two-faced card's JSON-LD is the front's: no hasPart, the front's name", () => {
    const legacy = buildCardJsonLd({ inDecks: [], card: LEGACY, username: "kesh", ownerDisplay: "Kesh", siteBase: SITE });
    expect(legacy.name).toBe("Village Elder");
    expect(legacy).not.toHaveProperty("hasPart");
    expect(String(legacy.keywords).split(", ")).not.toContain("wolf");
  });
});

describe("Card details of a double-faced card", () => {
  const html = (card: typeof DFC) => renderToStaticMarkup(<CardDetails card={card} inDecks={[]} />);

  it("lists the back's type, colour, stats and artist under the front's rows", () => {
    const markup = html(DFC);
    expect(markup).toContain("Back face — Elder Wolf");
    expect(markup).toContain('data-testid="card-back-details"');
    const backBlock = markup.slice(markup.indexOf("card-back-details"));
    expect(backBlock).toContain("Creature — Wolf");
    expect(backBlock).toContain("4/4");
    expect(backBlock).toContain("B. Back");
    expect(backBlock).toContain("Green");
    // A transform back prints no mana cost: no row for it.
    expect(backBlock).not.toContain("Mana cost");
    // The front's rows are still there, first.
    expect(markup.indexOf("Human Werewolf")).toBeLessThan(markup.indexOf("card-back-details"));
  });

  it("a modal back with a cost lists it; a legacy back is not listed", () => {
    const modal = html({ ...DFC, back_face: { ...BACK, cost: "{3}{B}", card_type: "artifact", subtypes: ["Equipment"], power: null, toughness: null } });
    const backBlock = modal.slice(modal.indexOf("card-back-details"));
    expect(backBlock).toContain("{3}{B}");
    expect(backBlock).toContain("Artifact — Equipment");
    expect(backBlock).not.toContain("Stats");
    expect(html(LEGACY)).not.toContain("card-back-details");
  });
});
