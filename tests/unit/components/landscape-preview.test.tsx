// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { fitTypeLineBand, measuredLinePreviewPct } from "@/lib/cards/render-tiers";
import { fitStatSizePct } from "@/lib/cards/stat-fit";
import { BATTLE_ART_RECT, SPLIT_HALF_DX_PCT, getFrameProfile, unturnedRect, type Rect } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { SPLIT_COST_DISC_PCT, SPLIT_TITLE_SIZE_PCT, SPLIT_TYPE_SIZE_PCT, TITLE_SIZE_PCT, TYPE_SIZE_PCT, displayPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The live-preview half of TODO 4.21b (layout v43): split and battle on
// their Card Conjurer masters. The preview draws what the bake draws
// (tests/unit/render/landscape-v43-bake.test.tsx holds the bake's pixels;
// tests/unit/render/render-parity.test.ts pins both renderers to the same
// helper calls):
//   • both halves of a split card are set alike — the right half, an
//     UNTURNED second face, takes its name and type line from the measured
//     fits exactly as the front does;
//   • the artist credit is one box turned a quarter turn clockwise down the
//     left border (FrameProfile.footerTurn);
//   • a battle's defense is the value alone, white, in the shield the master
//     paints — no drawn disc;
//   • the colourless battle draws ONE picture under its see-through frame.
// ---------------------------------------------------------------------------

afterEach(cleanup);

// happy-dom drops `cqw` lengths from element.style: read the server markup.
const markup = (ui: React.ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body;
const prop = (el: Element, name: string) =>
  new RegExp(`(?:^|;)${name}:([^;]+)`).exec(el.getAttribute("style") ?? "")?.[1] ?? null;
const cqw = (pct: number) => `${(pct * 100).toFixed(3)}cqw`;
const box = (el: Element) => [prop(el, "left"), prop(el, "top"), prop(el, "width"), prop(el, "height")];
const rectOf = (r: Rect) => [`${r.leftPct}%`, `${r.topPct}%`, `${r.widthPct}%`, `${r.heightPct}%`];

// Our storage (the legacy project host), a user folder: art the preview draws.
const ART = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-art/11111111-1111-4111-8111-111111111111/left.png";
const ART_BACK = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-art/11111111-1111-4111-8111-111111111111/right.png";

function split(left: { title: string; cost: string; type?: string }, right: { title: string; cost: string; subtypes?: string[] }, extra: Record<string, unknown> = {}) {
  return (
    <CardPreview
      title={left.title}
      cost={left.cost}
      cardType="instant"
      colorIdentity={["red"]}
      rulesText="Discard a card, then draw two cards."
      artistCredit="Ada Lovelace"
      frameStyle={{ template: "split" }}
      backFace={{ title: right.title, cost: right.cost, card_type: "sorcery", subtypes: right.subtypes, rules_text: "Creatures you control gain double strike until end of turn." }}
      {...extra}
    />
  );
}

describe("CardPreview — the split card (layout v43)", () => {
  const profile = getFrameProfile("split");
  const second = profile.secondFace!;

  it("draws short lines on both halves at the split's own sizes, each half on its own slots, neither turned", () => {
    const body = markup(split({ title: "Fast", cost: "{2}{R}" }, { title: "Furious", cost: "{3}{R}{R}" }));
    const left = body.querySelector('span[title="Fast"]')!;
    const right = body.querySelector('[data-testid="second-face-title"]')!;
    expect(left.textContent).toBe("Fast");
    expect(right.textContent).toBe("Furious");
    expect(right.getAttribute("title")).toBe("Furious");
    // 76 px of the 2100 px card on both halves — not the family's 80.
    expect(prop(left.parentElement!, "font-size")).toBe(cqw(SPLIT_TITLE_SIZE_PCT));
    expect(prop(right.parentElement!, "font-size")).toBe(cqw(SPLIT_TITLE_SIZE_PCT));
    expect(cqw(SPLIT_TITLE_SIZE_PCT)).toBe("3.619cqw");
    expect(cqw(SPLIT_TITLE_SIZE_PCT)).not.toBe(cqw(displayPct(TITLE_SIZE_PCT, "landscape")));
    // Each half's band is its own slot; the right one is the left one 966 px
    // over, and is not turned (rotation 0).
    expect(box(left.parentElement!)).toEqual(rectOf(profile.title.rect));
    expect(box(right.parentElement!)).toEqual(rectOf(second.title.rect));
    expect(second.title.rect.leftPct - profile.title.rect.leftPct).toBeCloseTo(SPLIT_HALF_DX_PCT, 9);
    expect(SPLIT_HALF_DX_PCT * 21).toBeCloseTo(966, 9);
    expect(prop(right.parentElement!, "transform")).toBeNull();
    // The name first, its cost last, on both halves.
    expect(left.parentElement!.lastElementChild?.getAttribute("aria-label")).toBe("Cost {2}{R}");
    expect(right.parentElement!.lastElementChild?.getAttribute("aria-label")).toBe("Cost {3}{R}{R}");
    // The type lines: 53 px on the thin bar, both halves.
    const rightType = body.querySelector('[data-testid="second-face-type"]')!;
    expect(rightType.textContent).toBe("Sorcery");
    expect(prop(rightType.parentElement!, "font-size")).toBe(cqw(SPLIT_TYPE_SIZE_PCT));
    expect(box(rightType.parentElement!)).toEqual(rectOf(second.type.rect));
    const leftType = [...body.querySelectorAll("span")].find((el) => el.textContent === "Instant")!;
    expect(prop(leftType.parentElement!, "font-size")).toBe(cqw(SPLIT_TYPE_SIZE_PCT));
    expect(cqw(SPLIT_TYPE_SIZE_PCT)).toBe("2.524cqw");
    expect(cqw(SPLIT_TYPE_SIZE_PCT)).not.toBe(cqw(displayPct(TYPE_SIZE_PCT, "landscape")));
  });

  it("fits a long name the same way on both halves: the measured fit's size, text and width, cut with one “…” at the floor", () => {
    const NAME = "Vinnie 'Goldfang' Lupo, Boss of Burrow Street and Every Alley Behind It";
    const COST = "{2}{B}{R}{R}";
    const leftFit = fitTitleBand(profile, NAME, COST, "landscape")!;
    const rightFit = fitTitleBand({ title: second.title, costSizePct: second.costSizePct }, NAME, COST, "landscape")!;
    // The halves' slots are the same size, so the same name fits the same.
    expect(rightFit).toEqual(leftFit);
    expect(leftFit.sizePct).toBeLessThan(SPLIT_TITLE_SIZE_PCT);
    expect(leftFit.text).not.toBe(NAME);
    expect(leftFit.text.endsWith("…")).toBe(true);
    expect(leftFit.text.match(/…/g)).toHaveLength(1);

    const body = markup(split({ title: NAME, cost: COST }, { title: NAME, cost: COST }));
    const [left] = [...body.querySelectorAll(`span[title="${NAME}"]`)];
    const right = body.querySelector('[data-testid="second-face-title"]')!;
    expect(left).not.toBe(right);
    const size = cqw(measuredLinePreviewPct(leftFit.sizePct, SPLIT_TITLE_SIZE_PCT, "landscape"));
    for (const el of [left, right]) {
      expect(el.textContent).toBe(displayLine(leftFit.text));
      expect(prop(el, "max-width")).toBe(cqw(leftFit.widthPct));
      expect(prop(el.parentElement!, "font-size")).toBe(size);
      // The pips keep the split's own disc, whatever the name's fit
      // (mana-font draws a disc at 1.3 em).
      const pips = el.parentElement!.lastElementChild!;
      expect(pips.getAttribute("aria-label")).toBe(`Cost ${COST}`);
      expect(prop(pips, "font-size")).toBe(cqw(SPLIT_COST_DISC_PCT / 1.3));
    }
    // A name that fits shrinks no further than it must: a medium one is
    // whole, between the floor and the profile's size.
    const MEDIUM = "Expansion of the Izzet League";
    const mediumFit = fitTitleBand(profile, MEDIUM, "{U/R}{U/R}", "landscape")!;
    expect(mediumFit.text).toBe(MEDIUM);
    expect(mediumFit.sizePct).toBeGreaterThan(leftFit.sizePct);
    const medium = markup(split({ title: "Fast", cost: "{R}" }, { title: MEDIUM, cost: "{U/R}{U/R}" }));
    const mediumEl = medium.querySelector('[data-testid="second-face-title"]')!;
    expect(mediumEl.textContent).toBe(displayLine(MEDIUM));
    expect(prop(mediumEl.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(mediumFit.sizePct, SPLIT_TITLE_SIZE_PCT, "landscape")));
  });

  it("fits the right half's type line to its own bar (no set symbol there)", () => {
    const subtypes = ["Arcane", "Lesson", "Adventure", "Trap", "Omen"];
    const text = `Sorcery — ${subtypes.join(" ")}`;
    const fit = fitTypeLineBand({ layout: { type: second.type }, text, symbolWidthPct: null, orientation: "landscape" });
    expect(fit.sizePct).toBeLessThan(SPLIT_TYPE_SIZE_PCT);
    const body = markup(split({ title: "Fast", cost: "{R}" }, { title: "Furious", cost: "{R}", subtypes }));
    const type = body.querySelector('[data-testid="second-face-type"]')!;
    expect(type.textContent).toBe(displayLine(fit.text));
    expect(prop(type.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(fit.sizePct, SPLIT_TYPE_SIZE_PCT, "landscape")));
    if (fit.widthPct !== null) expect(prop(type, "max-width")).toBe(cqw(fit.widthPct));
  });

  it("gives each half its own art window, unturned", () => {
    const { container } = render(split({ title: "Fast", cost: "{R}" }, { title: "Furious", cost: "{R}" }, { artUrl: ART, backFace: { title: "Furious", cost: "{R}", card_type: "sorcery", art_url: ART_BACK } }));
    const slotOf = (src: string) => container.querySelector<HTMLElement>(`img[src="${src}"]`)!.parentElement as HTMLElement;
    const pct = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];
    expect(pct(slotOf(ART))).toEqual(rectOf(profile.artSlot));
    expect(pct(slotOf(ART_BACK))).toEqual(rectOf(second.artSlot!));
    expect(slotOf(ART_BACK).style.transform).toBe("rotate(0deg)");
    // 2.1 px either side of the masters' windows (204–1017 and 1171–1983 px).
    expect(profile.artSlot.leftPct * 21).toBeCloseTo(201.9, 6);
    expect(second.artSlot!.leftPct * 21).toBeCloseTo(1168.9, 6);
  });

  it("turns the artist credit a quarter turn clockwise down the left border: one box, the band's unturned rect", () => {
    expect(profile.footerTurn).toBe(90);
    const footer = profile.footer!;
    // The BAND the turned line covers: a strip of the left border.
    expect(footer.rect.leftPct * 21).toBeCloseTo(46.2, 1);
    expect((footer.rect.leftPct + footer.rect.widthPct) * 21).toBeCloseTo(113.4, 1);
    expect(footer.rect.topPct * 15).toBeCloseTo(97.5, 1);
    const body = markup(split({ title: "Fast", cost: "{R}" }, { title: "Furious", cost: "{R}" }));
    const el = body.querySelector('[data-testid="card-footer"]')!;
    expect(el.textContent).toContain(displayLine("Art: Ada Lovelace"));
    expect(prop(el, "transform")).toBe("rotate(90deg)");
    expect(prop(el, "transform-origin")).toBe("center");
    // The line is laid out in the band's UNTURNED box (its sides swapped
    // through the 7:5 card's aspect, about the same centre) and turned.
    const unturned = unturnedRect(footer.rect, 90, 5 / 7);
    expect(box(el)).toEqual(rectOf(unturned));
    expect(unturned.leftPct + unturned.widthPct / 2).toBeCloseTo(footer.rect.leftPct + footer.rect.widthPct / 2, 9);
    expect(unturned.topPct + unturned.heightPct / 2).toBeCloseTo(footer.rect.topPct + footer.rect.heightPct / 2, 9);
    // Its long side is the band's height on the page (1305 px of the 1500).
    expect(unturned.widthPct * 21).toBeCloseTo(footer.rect.heightPct * 15, 6);
    expect(unturned.heightPct * 15).toBeCloseTo(footer.rect.widthPct * 21, 6);
    // The same px size as M15's footer line.
    expect(prop(el, "font-size")).toBe(cqw(displayPct(0.019, "landscape")));
    // A portrait frame's footer is not turned.
    const m15 = markup(<CardPreview title="Probe" cardType="instant" colorIdentity={["red"]} artistCredit="Ada Lovelace" frameStyle={{ template: "m15" }} />);
    expect(prop(m15.querySelector('[data-testid="card-footer"]')!, "transform")).toBeNull();
  });
});

describe("CardPreview — the battle (layout v43)", () => {
  const profile = getFrameProfile("battle");

  function battle(extra: Record<string, unknown> = {}) {
    return (
      <CardPreview
        title="Invasion of Tarkir"
        cost="{1}{R}"
        cardType="battle"
        subtypes={["Siege"]}
        colorIdentity={["red"]}
        rulesText="When Invasion of Tarkir enters, reveal any number of Dragon cards from your hand."
        defense="5"
        artistCredit="Ada Lovelace"
        frameStyle={{ template: "battle" }}
        {...extra}
      />
    );
  }
  const statOf = (body: HTMLElement) =>
    [...body.querySelectorAll("div")].find(
      (el) => prop(el, "left") === `${profile.defense!.rect.leftPct}%` && prop(el, "top") === `${profile.defense!.rect.topPct}%`,
    );

  it("draws the name right of the icon at the family's sizes, through displayPct(…, landscape)", () => {
    const body = markup(battle());
    const name = body.querySelector('span[title="Invasion of Tarkir"]')!;
    expect(prop(name.parentElement!, "font-size")).toBe(cqw(displayPct(TITLE_SIZE_PCT, "landscape")));
    expect(cqw(displayPct(TITLE_SIZE_PCT, "landscape"))).toBe("3.807cqw"); // 80 px of 2100, as on a portrait card's 1500
    expect(box(name.parentElement!)).toEqual(rectOf(profile.title.rect));
    // From 388 px: past the pill's left end and the battle icon (TODO 3.28 —
    // the MSE rect began 269 px in, under the icon's ring at 220–362 px;
    // 4.21d moved v43's 392 px 4 px left, onto the prints' own start).
    expect(profile.title.rect.leftPct * 21).toBeCloseTo(388, 9);
    // The prints' baseline: 2 px below centred, at HD (TextSlot.dy).
    expect(prop(name, "transform")).toBe(`translateY(${cqw(2 / 2100)})`);
    expect(prop(name.parentElement!, "letter-spacing")).toBe("0.01em");
    const type = [...body.querySelectorAll("span")].find((el) => el.textContent === displayLine("Battle — Siege"))!;
    expect(prop(type.parentElement!, "font-size")).toBe(cqw(displayPct(TYPE_SIZE_PCT, "landscape")));
    expect(cqw(displayPct(TYPE_SIZE_PCT, "landscape"))).toBe("3.236cqw"); // 68 px
  });

  it("draws the defense as the value alone, white, in the painted shield — no disc", () => {
    const body = markup(battle());
    const stat = statOf(body)!;
    expect(stat).toBeDefined();
    expect(box(stat)).toEqual(rectOf(profile.defense!.rect));
    // Nothing but the value: no drawn badge, no plate image.
    expect(stat.children).toHaveLength(1);
    const value = stat.firstElementChild!;
    expect(value.tagName).toBe("SPAN");
    expect(value.textContent).toBe("5");
    expect(prop(value, "color")).toBe("#ffffff");
    expect(prop(value, "text-shadow")).toBeNull();
    expect(prop(value, "font-size")).toBe(cqw(78 / 2100));
    expect(body.innerHTML).not.toContain("border-radius:42%");
    // A wider value is fitted to the shield's black interior — the bake's
    // fitStatSizePct.
    const wide = markup(battle({ defense: "100" }));
    const wideValue = statOf(wide)!.firstElementChild!;
    const fitted = fitStatSizePct(profile.defense!, "100", "landscape");
    expect(fitted).toBeLessThan(78 / 2100);
    expect(prop(wideValue, "font-size")).toBe(cqw(fitted));
    // No defense, no value — the shield is the master's either way.
    expect(statOf(markup(battle({ defense: null })))).toBeUndefined();
  });

  it("turns the artist credit down the left border, as the split's", () => {
    expect(profile.footerTurn).toBe(90);
    expect(profile.footer).toBe(getFrameProfile("split").footer);
    const el = markup(battle()).querySelector('[data-testid="card-footer"]')!;
    expect(el.textContent).toContain(displayLine("Art: Ada Lovelace"));
    expect(prop(el, "transform")).toBe("rotate(90deg)");
    expect(box(el)).toEqual(rectOf(unturnedRect(profile.footer!.rect, 90, 5 / 7)));
  });

  it("paints ONE art rect on every colour, and one picture under the see-through colourless frame", () => {
    const pct = (el: HTMLElement | null) => el && [el.style.left, el.style.top, el.style.width, el.style.height];
    const slot = (root: HTMLElement) => pct(root.querySelector<HTMLElement>('img[alt="Artwork for Invasion of Tarkir"]')?.closest<HTMLElement>("div.absolute") ?? null);
    expect(profile.artSlot).toBe(BATTLE_ART_RECT);
    for (const colour of ["red", "colorless"] as const) {
      const { container } = render(battle({ colorIdentity: [colour], artUrl: ART }));
      // (The pack's 58.2 px top, 2 px up with the top block — TODO 4.21d.)
      expect(slot(container), colour).toEqual(["7.85%", `${BATTLE_ART_RECT.topPct}%`, "89.4%", `${BATTLE_ART_RECT.heightPct}%`]);
      expect(BATTLE_ART_RECT.topPct * 15).toBeCloseTo(56.2, 9);
      // No second, separately cropped layer to meet it in a seam.
      expect(container.querySelector('[data-testid="under-frame-art"]'), colour).toBeNull();
      cleanup();
    }
    expect(profile.underFrameArt).toEqual({ rect: BATTLE_ART_RECT, colors: ["c"], artSlot: BATTLE_ART_RECT });
  });
});
