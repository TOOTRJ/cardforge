// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import { fitTypeLine, measuredLinePreviewPct } from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { ADVENTURE_PANEL_PCT, TITLE_SIZE_PCT, TYPE_SIZE_PCT } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The measured fits (TODO 4.20, layout v32) in the live preview: a name and a
// type line on a slot with `fit: "measured"` are drawn at the size, text and
// width fitTitleBand / fitTypeLine give — the same helpers, same arguments,
// as the bake (pinned in tests/unit/render/render-parity.test.ts; the bake's
// pixels in tests/unit/render/measured-fit-bake.test.tsx). The shipped
// family profiles set the flag; here a wrapped getFrameProfile pins it on
// the m15 and adventure profiles (`flags.on`) or clears it (off).
// ---------------------------------------------------------------------------

const flags = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const p = real.getFrameProfile(template);
      if (template !== "m15" && template !== "adventure") return p;
      // Off: the same profile with the flag cleared (the old fit path).
      if (!flags.on) {
        return {
          ...p,
          title: { ...p.title, fit: undefined },
          type: { ...p.type, fit: undefined },
          ...(p.adventure
            ? {
                adventure: {
                  ...p.adventure,
                  title: { ...p.adventure.title, fit: undefined },
                  type: { ...p.adventure.type, fit: undefined },
                },
              }
            : {}),
        };
      }
      return {
        ...p,
        title: { ...p.title, sizePct: TITLE_SIZE_PCT, fit: "measured" as const },
        type: { ...p.type, sizePct: TYPE_SIZE_PCT, fit: "measured" as const },
        ...(p.adventure
          ? {
              adventure: {
                ...p.adventure,
                title: { ...p.adventure.title, sizePct: ADVENTURE_PANEL_PCT, fit: "measured" as const },
                type: { ...p.adventure.type, sizePct: ADVENTURE_PANEL_PCT, fit: "measured" as const },
              },
            }
          : {}),
      };
    },
  };
});

// happy-dom drops `cqw` lengths from element.style: read the server markup.
const markup = (ui: React.ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body;
const prop = (el: Element, name: string) =>
  new RegExp(`(?:^|;)${name}:([^;]+)`).exec(el.getAttribute("style") ?? "")?.[1] ?? null;
const cqw = (pct: number) => `${(pct * 100).toFixed(3)}cqw`;

const NAME = "Vinnie 'Goldfang' Lupo, Boss of Burrow Street";
const COST = "{2}{B}{R}";
const TYPE = "Legendary Artifact Creature — Rabbit Rogue Warrior";

function card(template: string, extra: Record<string, unknown> = {}) {
  return markup(
    <CardPreview
      title={NAME}
      cost={COST}
      cardType="creature"
      supertype="Legendary Artifact"
      subtypes={["Rabbit", "Rogue", "Warrior"]}
      colorIdentity={["black", "red"]}
      power="3"
      toughness="3"
      frameStyle={{ template: template as "m15" }}
      {...extra}
    />,
  );
}

describe("CardPreview — the measured fits", () => {
  it("draws the name and type line at the helpers' size, text and width", () => {
    flags.on = true;
    const layout = getFrameProfile("m15");
    expect(layout.title.fit).toBe("measured");
    const fit = fitTitleBand(layout, NAME, COST, "portrait")!;
    expect(fit.text).toBe(NAME);
    expect(fit.sizePct).toBeLessThan(TITLE_SIZE_PCT);

    const body = card("m15");
    const name = body.querySelector(`span[title="${NAME}"]`)!;
    expect(name.textContent).toBe(displayLine(NAME));
    expect(prop(name, "max-width")).toBe(cqw(fit.widthPct));
    // A shrunk measured line shows at the stored HD bake's whole px.
    expect(prop(name.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(fit.sizePct, TITLE_SIZE_PCT)));
    // The pips keep the profile's disc.
    const pips = body.querySelector(`[aria-label="Cost ${COST}"]`)!;
    expect(pips).not.toBeNull();

    const typeSpan = [...body.querySelectorAll("span")].find((el) => el.textContent === displayLine(TYPE))!;
    const typeSize = fitTypeLine({
      layout,
      text: TYPE,
      // No set code or icon: the default mark, the box wide.
      symbolWidthPct: setSymbolSize(layout, setSymbolSource(null, null)).drawnWidthPct,
      orientation: "portrait",
    });
    expect(typeSize).toBeLessThan(TYPE_SIZE_PCT);
    expect(prop(typeSpan.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(typeSize, TYPE_SIZE_PCT)));
    flags.on = false;
  });

  it("changes nothing on a profile without the flag", () => {
    flags.on = false;
    const layout = getFrameProfile("m15");
    expect(layout.title.fit).toBeUndefined();
    const body = card("m15");
    const name = body.querySelector(`span[title="${NAME}"]`)!;
    expect(prop(name, "max-width")).toBeNull();
    expect(prop(name.parentElement!, "font-size")).toBe(cqw(layout.title.sizePct));
  });

  it("fits the adventure panel's name before its cost and its type line to its bar", () => {
    flags.on = true;
    const panel = getFrameProfile("adventure").adventure!;
    const back = {
      title: "Heartflame Slash",
      cost: "{2}{R}",
      card_type: "instant" as const,
      supertype: null,
      subtypes: ["Adventure"],
      rules_text: "Deal 3 damage.",
    };
    const fit = fitTitleBand({ title: panel.title, costSizePct: panel.costSizePct }, back.title, back.cost)!;
    expect(fit.text).toBe(back.title);
    expect(fit.sizePct).toBeLessThan(ADVENTURE_PANEL_PCT);
    const body = card("adventure", { backFace: back });
    const name = body.querySelector(`span[title="${back.title}"]`)!;
    expect(name.textContent).toBe(displayLine(back.title));
    expect(prop(name, "max-width")).toBe(cqw(fit.widthPct));
    expect(prop(name.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(fit.sizePct, ADVENTURE_PANEL_PCT)));
    const typeSpan = [...body.querySelectorAll("span")].find((el) => el.textContent === displayLine("Instant — Adventure"))!;
    const typeSize = fitTypeLine({ layout: { type: panel.type }, text: "Instant — Adventure", symbolWidthPct: null });
    expect(prop(typeSpan.parentElement!, "font-size")).toBe(cqw(measuredLinePreviewPct(typeSize, ADVENTURE_PANEL_PCT)));
    flags.on = false;
  });
});
