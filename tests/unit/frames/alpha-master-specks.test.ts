import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The Alpha masters (public/frames/agclassic + alphaland) carry no palette
// specks at their ring corners.
//
// scripts/build-alpha-frames.mjs upsamples MSE's agclassic art with a
// Catmull-Rom cubic, which overshoots a hard edge where two lines meet (up to
// ~20 levels at a ring corner); the palette PNG encode then snapped those
// rare colours to off-hue palette entries — alphaland/u had 159,177,189
// specks in its 78,123,170 art ring, w cream dots at every ring corner. The
// script now clamps each channel to its 16 taps' range.
//
// This pins the committed masters to that clamped build. Each PROBE is the
// 3 × 3 block where the UNCLAMPED cubic overshot most (summed over the 7
// colours) inside a 26 px window on one of the 12 ring corners (art box, text
// box, pinstripe × 4) — for alphaland, exactly where the specks were; agclassic
// has an eighth master, the colourless artifact card "a". There
// every master must sit within PNG_TOLERANCE of the clamped FULL-COLOUR build
// (REF): palette dithering stays under ~10 levels, an unclamped rebuild or a
// speck does not. The .webp twin (lossy — what the browser shows) gets a
// looser bound that still catches a stale twin still carrying the specks.
//
// Regenerate REF after a deliberate re-cut (needs MSE's Full-Magic-Pack):
//   ALPHA_OUT_ROOT=/tmp/alpha-full ALPHA_FULL_COLOUR=1 node scripts/build-alpha-frames.mjs
//   ALPHA_REF_DIR=/tmp/alpha-full npx vitest run tests/unit/frames/alpha-master-specks.test.ts
// With ALPHA_REF_DIR set, the suite only writes the new REF table (to
// $ALPHA_REF_DIR/alpha-ref.ts) for pasting in below.
// ---------------------------------------------------------------------------

type Template = "agclassic" | "alphaland";
const TEMPLATES: Template[] = ["agclassic", "alphaland"];
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
/** Every master a template ships: the seven colours, plus agclassic's
 *  colourless artifact card (FrameProfile.artifactMasterKeys). */
const MASTERS: Record<Template, readonly string[]> = {
  agclassic: [...KEYS, "a"],
  alphaland: KEYS,
};
const PNG_TOLERANCE = 16;
const WEBP_TOLERANCE = 40;
const REF_DIR = process.env.ALPHA_REF_DIR;

/** Probe centres, HD px: [corner, x, y]. */
const PROBES: Record<Template, ReadonlyArray<readonly [string, number, number]>> = {
  agclassic: [
    ["art TL", 163, 212], ["art TR", 1338, 211], ["art BL", 171, 1155], ["art BR", 1351, 1158],
    ["text TL", 200, 1254], ["text TR", 1310, 1254], ["text BL", 192, 1847], ["text BR", 1310, 1834],
    ["pin TL", 103, 92], ["pin TR", 1411, 92], ["pin BL", 95, 1987], ["pin BR", 1417, 1991],
  ],
  alphaland: [
    ["art TL", 152, 197], ["art TR", 1349, 197], ["art BL", 153, 1165], ["art BR", 1348, 1165],
    ["text TL", 192, 1255], ["text TR", 1311, 1255], ["text BL", 192, 1848], ["text BR", 1311, 1848],
    ["pin TL", 90, 102], ["pin TR", 1417, 100], ["pin BL", 90, 1987], ["pin BR", 1417, 1986],
  ],
};

/** The clamped full-colour build at every probe's 3 × 3 block: RGB, probe by
 *  probe, row by row, base64. */
const REF: Record<string, string> = {
  "agclassic/w": "yr+qyr+qyr+qyr+qyr+qyr+qyr+qyr+qyr+qaWBSbGNTbGRUbGNWbGNWbGNWbGNVbGNWbGNWyLywyLywyLywyLywyLywyLywyLywyLywyLywu6WKu6aLu6SKv6WJv6eKvaWJv6aHv6eIvqaH8vDr8vDr8vDr8vDr8vDr8vDr8vDr8vDr8vDr+vfw+vfw+vfw+vfw+vfw+vfw+vfw+vfw+vfwsa2ksa2ksa2ksa2ksa2ksa2ksa2ksa2ksa2k9PHr9PHr9PHr9PHr9PHr9PHr9PHr9PHr9PHrv6+kvq+fvq+fv6+mvq+fvq+fv6+mvq+fvq+f1sm51sm51sm51sm51sm51sm51sm51sm51sm5xbehxbehxbehxbehxbehxbehxbehxbehxbeh5drP59rR59rQ59rR59rR59rR59rR59rR59rR",
  "agclassic/u": "dJi5dJq6cJe4dJm5dJu6cpi4dJm3dJi3cpS0JT9WJkJYJkNYJkNbJkNbJkNbJkNbJkNbJkNbepO4epi7eZq5epq9ep6/ep++ep2+eqDAeqLBTY6yTpKyTZOuTZGtT5WtT5WtTpWtUJitUJit4fH74fH74fH74fH74fH74fH74fH74fH74fH73PP73PP73PP73PP73PP73PP73PP73PP73PP7mK+5mK+5mK+5mK+5mK+5mK+5mK+5mK+5mK+53/L63/L63/L63/L63/L63/L63/L63/L63/L6coGmc4Knc4SodIWpdoeqdomtcoKjcoSkc4enc5O7c424c6DIc5e+c5K9c6XIc5K2c463c5/ITZ67Tp67T567TZy7T567T567SpSzTJa1Tpe2errMerrMerrMerrMerrMerrMerrLerrLerrL",
  "agclassic/b": "W1pfWVpdUlZXW1pfW1pfVllaW1pfW1pfWFpaFRUXFRUXFRUXFhcYFhYYFRUXFhgYFhcYFRYXWVldWVldWVldWVldWVldWVldWVldWVldWVldISIgISIeICAcICEfICEdHx8bHx4fHh4eHR0c7NPB7NPB7NPB7NPB7NPB7NPB7NPB7NPB7NPB9trO9trO9trO9trO9trO9trO9trO9trO9trOqohxqohxqohxqohxqohxqohxqohxqohxqohx8da/8da/8da/8da/8da/8da/8da/8da/8da/XFxhXFxhXFxhXFxhXFxhXFxhXFxhXFxhXFxhXV9iXF9fXmBiXl9iXl9iXmBiXF9hXV9fXmBiIR8nISAnISEmISAoISEnISMmHyAnICEmICIlXV5iXV5iXV5iXV5iXV5iXV5iXV5iXV5iXV5i",
  "agclassic/r": "rHhqrHhprHhjrHhqrHhqrHhmrHhqrHhqrHhmWS0fWS0gWS0gWy0gWy0gWy0gWy0fWy0fWy0fq3Zoq3Zoq3Zoq3Zoq3Zoq3Zoq3Zoq3Zoq3ZogkA1hEE1g0E1gUA1g0E1g0E1gEA1gkA1gUA10K2m0K2m0K2m0K2m0K2m0K2m0Kql0K2m0K2m3bmt3bmt3bmt3bmt3bmt3bmt3bmt3bmt3bmthFVLhFVLhFVLhFVLhFVLhFVLhFVLhFVLhFVLxqSbxqSfxqSfxqScxqSfxqSfxqSdxqSfxqSfs3lps3lps3lps3lps3lps3lps3lps3lps3lpt31ut31ut3ttt31ut31ut3ttt31ut31ut3tth0cyh0cyh0cyh0cyh0cyh0cyh0cyh0cyh0cywIJxxoJxxoJxxIJxxoJxxoJxxoJxxoJxxoJx",
  "agclassic/g": "boB7bYB7aH57cIB7b4B7a4B7cIB7boB7an94Pkw+Pkw+Pkw+Pko+Pko+Pko+Pko+Pko+Pko+gpB+gpB+gpB+gpB+gpB+gpB+gpB+gpB+gpB+QVU+QVU+QVQ9QVU+QVU+QVQ+QFU+QFU+PlQ+1rmj1rmj1rmj1rmj1rmj1rmj1rmj1rmj1rmj1r+31r+31r+31r+31r+31r+31r+31r+31r+3lnJelnJflnJclnJflnJflnJelnJflnJflnJd2Lyo2Lyo2Lyo2Lyo2Lyo2Lyo2Lyo2Lyo2LyocHx2cXl2cXl2cHx2cXl2cXl2cHx2cXl2cXl2j5yNj5yNjpyJj5yNj5yNjpyJj5yNj5yNjpyJS15HTV5IT15ISV5ITF5JTl5KRV1GSF5HSl5Ib35sb35sb35sb35sb35sb35sa3tpbX5sbX5s",
  "agclassic/c": "l5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXSUlJSUlJSUlJS0tLS0tLS0tLS0tLS0tLS0tLl5eXl5eXlpaWl5eXl5eXl5eXl5eXl5eXl5eXampqa2tra2traWlpa2trampqZ2dnaWlpaGhoy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbWd3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3vb29wMDAwMDAvr6+wMDAwMDAv7+/wMDAwMDAnp6enp6enp6enp6enp6enp6enp6enp6enp6eoaGhoaGhoKCgoaGhoaGhoKCgoaGhoaGhoKCgbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1trKyssrKysrKyr6+vsrKysrKysrKysrKysrKy",
  "agclassic/a": "hXNcg3FafWpVh3NehnJegGxah3JghXBggGtdJR0ZJx0ZJx0ZJx0ZKB0ZKB0ZJh0ZJx0ZJx0ZbWVnb2Vnb2Vnb2Vnb2Vnb2Vnb2Vnb2Vnb2VnRTcrQzQqPjApRTgrQzUrPjAqRTorQzYsQDAs6efe6efe6efe6efe6efe6efe6efe6efe6efe8u/g8u/g8u/g8u/g8u/g8u/g8u/g8u/g8u/grqORrqORrqORrqORrqORrqORrqORrqORrqOR7u/h7u/h7u/h7u/h7u/h7u/h7u/h7u/h7u/hdWhhdWdhdmhggG9hf25hgW5ihHBchG9chW9dhHVrhHVrgXVrhHVrhHVrgXVrg3Vrf3VqgXVrSDQjSDQkRzQkSDQiSDQjSDQjSDMgSDQhRTMheGpfeGtheGtheGtheGtheGthcmVedmVecmVe",
  "agclassic/m": "fnVefXRdd25YgXhggXhgfXRcgnlhgnlhf3deMSoYMSoYMCoWNS0aNC0ZMisXNS4aNS0ZMywYjoNljoNlioNljoNljoNliYJli4NliYJlhX1krqhdrqleq6ZcrKRcrKVcqaNbqaBbqaBbp55Z3tPX3tPX3tPX3tPX3tPX3tPX3tPX3tPX3tPX49na49na49na49na49na49na49na49na49namo6Smo6Smo6Smo6Smo6Smo6Smo6Smo6Smo6S4NbX4NbX4NbX4NbX4NbX4NbX4NbX4NbX4NbXmpNxmpNxmpNxmpNxmpNxmpNxmpNxmpNxmpNxqJ96qJ96qJt6qJ96qJ96qJt6qJ96qJ96qJt6Z18uZ18uZ18uZ18uZ18uZ18uZ18uZ18uZ18uqqN1qqh1qqZ1qqV1qqh1qqh1qqh1qqh1qqh1",
  "alphaland/w": "3dPJ3dPJ3dPJ3dPJ3dPJ3dPJ3dPJ3dPJ3dPJ3dPK3dPK3dPK3dPK3dPK3dPK3dPK3dPK3dPK3NLI3NLI2tLI3NLI3NLI3NLI3NLI3NLI3NLI1s7G3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI3NLI2tDG3NLI1crA29HI29HI29HI29HI29HI29HI29HI29HI1cvC2tDH2tDH2M7F2tDH2tDH2tDH2tDH2tDH2tDH29DK29DK28/I29DK29DK29DK29DK29DK29DK18rC39PJ39PJ39PJ39PJ39PJ39PJ39PJwrito46Do46Do46Do46Do46Do46Do46Do46Do46D39LJ39LJxbyx39LJ39LJ39LJ3NLI39LJ39LJmYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+",
  "alphaland/u": "T3ytUHytUHytUHytUHytT3ytUHytT3ytTHytTnyrTnyrTnyrTXyrTnyrT3yrSnyrTnyrT3yrTXusSnusRnaqTnusTXusS3usTnusTnusT3usRHSoSXutTHytS3ytTXytTnytT3+tTn+tTn2tTHupTHupTHupTHupTHupTHupTHqpTHupTHelTnqpT3qpTnqpTXqpTnqpTXqpTHqpTHqpS3ekS3qnTHqnS3imTnqnTnqnTXqnT3qnT3qnTXqnTnuqT3uqTXqoT3uqT3uqUHuqT3uqT3uqUHuqT3ilUnytUXytUnytVHytUHytU3ytUnytSm2Uo46Do46Do46Do46Do46Do46Do46Do46Do46DU3ysU3ysTXKZVHysVnysU3ysUHyrUHysUHysmYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+",
  "alphaland/b": "Uk1HUk1HUk1HUk1HUk1HUU1HUk1HUk1HT0tGUk1IUk1IUk5HUk1IUk1IU09HT0tGUk1IU09HTkpES0dCR0Q+T0pFTkpETUlDT0pEUEtFUEtGRUM+SkdCTUtETElDTUtETktFT0xGT0xFTktEUExFUExFUExFUExFUExFUExFUEtFUExFT0pEUEtEUUtET0tFUEtEUEtET0pETklDT0pETklDUEpEUUtFT0lDUUtFUktFUEtFUUtFUktFUUpEUE1GUE1GUUtFUE1GUE1GUk5IUE1GUE1GUU5HT0pEVE9JU05JU01IVU1JUk1HVE1JUk1ISkU/o46Do46Do46Do46Do46Do46Do46Do46Do46DVlFLVlFKT0pDV1JMWVROVlFKU05IU05IU05ImYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+",
  "alphaland/r": "21hE21lF21lF21lF21lF21lE21lF21lE21dC3llG3llF3lhE3llF3llG3llF3ldD3llF3llF3ldB3lQ+21A73ldB3ldB3lZA3lhB3lhC3llC1U4721M+21ZB21RA21ZC21ZC21dD21dD21dC2lhD2lhD2lhD2lhD2lhD2lhD1lZD2lhD1FVC2VZC2VZC2VhD2VZC2VZC2VdD2VZC2VZC1VVC2FVB2FVB1lRB2FVB2FVB2FVB2FVB2FVB2FVB2lVC2lVC2lZE2lVC2lVC2lhF2lVC2lVC2lZD01RC21lG21lG21hF21hF21hE21hF21hEwE48o46Do46Do46Do46Do46Do46Do46Do46Do46D3VtG3VtGxFJA3VxH3V9J3VtG21hE3VhE3VhEmIh+mIh+mIh+mIh+mIh+mIh+mIh+mIh+mIh+",
  "alphaland/g": "i7Vji7Vji7Vji7Vji7Vji7Vji7Vji7Vji7Vji7Vli7Vli7Vli7Vli7Vli7Vli7Vli7Vli7VlirRkirRjhLFeirRkirRkirRkjbRkjrRljrRmga5cibRii7RlirRji7Rli7RljbRljbRli7RkirNkirNkirNkirNkirNkirNkibFkirNkhq1gh7Jih7Jih7Jih7Jih7Jih7Jih7Jih7Jihq5giLFiiLFih7BhiLFiiLFiiLFiiLFiiLFiiLFiibJjibJjibJhibJjibJjibJjibJjibJjibJjh69gi7Vmi7Vmi7Vki7Vki7Vki7Vki7VkfJ5Wo42Do42Do42Do42Do42Do42Do42Do42Do42DjLZkjLZkf6JbjLZkjLZkjLZkjLZkjLZkjLZkmYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+",
  "alphaland/c": "tHdLtHdLtHdLtHdLtHdLtHdLtHdLtHdLtHdKtXhMtXhMtXhMtXhMtXhMtXhMtXhKtXhMtXhMsXdJsXZGrXBCsXdJsXdJsXdHsXZIsXhJsXlKqnBCsnZGsndJsndIsndJsndJsnpKsnpKsnhJsndLsndLsndLsndLsndLsndLsHNLsndLq3JIsHZIsHZIsHZJsHZIsHZIsHZJsHZIsHZIq3JIsHVJsHVJrnNIsHVJsHVJsHVJsHVJsHVJsHVJsXZKsXZKsHZLsXZKsXZKsXZNsXZKsXZKsXZLrnRItHdNtHdNtHdLtHdLtHdLtHdLtHdKnmlBpI6DpI6DpI6DpI6DpI6DpI6DpI6DpI6DpI6DtXhOtXhOom5GtXhQtXhStXhOs3hMtXhMtXhMmYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+mYh+",
  "alphaland/m": "0MNB0MNB0MNB0MNB0MNB0MNB0MNB0MNB0MNA0sJB0sJB0sJB0sJB0sJB0sJB0sI/0sJB0sJCz8E9z8E7zcA3z8E+z8E9z8E8z8E+z8E+z8E+yL04z8I8z8I/z8I+z8I/z8JAz8JAz8JAz8JA0MFA0MFA0MFA0MFA0MFA0MFAzb8/0MFAyrs+z8M9z8M9z8M9z8M9z8M9z8M+z8I9z8M9yLw9zr8+zr8+yr4+zr8+zr8+zr8+zr8+zr8+zr8+zsE/zsE/zsA/zsE/zsE/zsFBzsE/zsE/zsFAybo/0sNC0sND0sNC0sNE0sNB0sND0sNBuKk5oI6DoI6DoI6DoI6DoI6DoI6DoI6DoI6DoI6D0MJD0MJCuq090MJD0MJF0MJD0MFA0MFA0MFAmYd+mYd+mYd+mYd+mYd+mYd+mYd+mYd+mYd+",
};

type Probe = { where: string; rgba: number[] };

/** Every probe's 3 × 3 block, in REF order. */
async function probePixels(file: string, template: Template): Promise<Probe[]> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out: Probe[] = [];
  for (const [corner, cx, cy] of PROBES[template]) {
    for (let y = cy - 1; y <= cy + 1; y += 1) {
      for (let x = cx - 1; x <= cx + 1; x += 1) {
        const i = (y * info.width + x) * 4;
        out.push({ where: `${corner} (${x},${y})`, rgba: [data[i], data[i + 1], data[i + 2], data[i + 3]] });
      }
    }
  }
  return out;
}

/** The probe pixel furthest (worst channel) from REF. */
function worst(template: Template, key: string, pixels: Probe[]) {
  const ref = Buffer.from(REF[`${template}/${key}`] ?? "", "base64");
  expect(ref.length, `REF ${template}/${key}`).toBe(pixels.length * 3);
  let found = { err: -1, at: "" };
  pixels.forEach((p, i) => {
    const want = [...ref.subarray(i * 3, i * 3 + 3)];
    const err = Math.max(...want.map((v, c) => Math.abs(p.rgba[c] - v)));
    if (err > found.err) found = { err, at: `${p.where}: ${p.rgba.slice(0, 3).join(",")} vs clamped ${want.join(",")}` };
  });
  return found;
}

const CASES = TEMPLATES.flatMap((t) => MASTERS[t].map((k) => [t, k] as const));

describe.skipIf(REF_DIR)("Alpha masters: no palette specks at the ring corners", () => {
  it.each(CASES)("%s/%s.png is the clamped build at every ring corner", async (template, key) => {
    const pixels = await probePixels(`public/frames/${template}/${key}.png`, template);
    for (const p of pixels) expect(p.rgba[3], `${template}/${key} ${p.where}: alpha`).toBe(255);
    const w = worst(template, key, pixels);
    expect(w.err, `${template}/${key}.png ${w.at}`).toBeLessThanOrEqual(PNG_TOLERANCE);
  });

  it.each(CASES)("%s/%s.webp carries no ring-corner speck either", async (template, key) => {
    const w = worst(template, key, await probePixels(`public/frames/${template}/${key}.webp`, template));
    expect(w.err, `${template}/${key}.webp ${w.at}`).toBeLessThanOrEqual(WEBP_TOLERANCE);
  });
});

describe.runIf(REF_DIR)("Alpha masters: REF table", () => {
  it("prints REF from a full-colour build", async () => {
    const lines: string[] = [];
    for (const [template, key] of CASES) {
      const pixels = await probePixels(`${REF_DIR}/${template}/${key}.png`, template);
      const rgb = Buffer.from(pixels.flatMap((p) => p.rgba.slice(0, 3)));
      lines.push(`  "${template}/${key}": "${rgb.toString("base64")}",`);
    }
    const table = `const REF: Record<string, string> = {\n${lines.join("\n")}\n};\n`;
    writeFileSync(path.join(REF_DIR!, "alpha-ref.ts"), table);
    console.log(table);
  });
});
