// ---------------------------------------------------------------------------
// The nyx type bar's and text box's darkness (TODO 4.17e; owner round 13,
// 2026-09-29: "darken it to match the prints"; round 18, 2026-09-30: the type
// bar too). MSE's Theros constellation masters paint both flat black at
// α 127.5 / 255 (50 %) in every colour; since layout v35 the art runs under
// the whole bar and box (4.17b), and on the THB constellation prints
// (#258 Daxos, #259 Heliod, #268 Klothys) both read far darker. Measured as
// the median luminance of the bar / box without their text over the art
// window's bottom strip (the proxy for the art under them):
//   * the text box lets 0.28–0.39 of the art through (mean 0.33) → α 171 /
//     255 (0.33 through);
//   * the type bar lets 0.36–0.46 through → α 150 / 255 (0.41 through, the
//     range's middle; the bar reads 1.19–1.35 × the box on the three prints,
//     1.26 on average, and 0.41 is 1.25 × the box's 0.33).
// Both keep MSE's black; only their alpha changes.
//
// Applied by scripts/build-variation-frames.mjs to the nyx masters before the
// corner normalisation (both are far from the corners), on the raw
// 1500 × 2100 RGBA buffer, in place. Within each band only MSE's translucent
// black changes — its pixels (α 127 / 128: 127.5 quantised) become the new
// alpha, a partial cover of it scales with it — and the frame's anti-aliased
// edge pixels within 3 px of it, modelled as the opaque frame colour at
// coverage c over the 50 % black, keep their colour and coverage over the
// darker black. Refuses a band that holds too little of MSE's 50 % black
// (already toned, or not an MSE nyx master).
// ---------------------------------------------------------------------------

/** MSE's alpha for both (127 and 128 both occur: 127.5 quantised). */
const MSE_ALPHA = 127.5 / 255;

/** The toned type bar: 0.41 of the art shows through, as on the prints. */
export const NYX_TYPE_BAR_ALPHA = 150;
/** The toned text box: a third of the art shows through, as on the prints. */
export const NYX_TEXT_BOX_ALPHA = 171;

/**
 * The bands on the 1500 × 2100 master, [top, bottom) px. The bar's black
 * runs 1200–1294 between the frame lines at 1172–1189 and 1305–1317; the
 * box's 1328–1935 below that line. The bands meet inside the opaque line,
 * so neither pass reaches the other's black.
 */
export const NYX_TYPE_BAR_ROWS = [1180, 1310];
export const NYX_TEXT_BOX_ROWS = [1310, 2100];

/** The least 50 % black a band holds before it is toned (the bar has
 *  122,130 px of it, the box 766,082, on every colour). */
const MIN_SEEDS = { bar: 60_000, box: 400_000 };

/** A pixel of MSE's translucent black. */
function isMseBlack(data, i) {
  return (data[i + 3] === 127 || data[i + 3] === 128) && data[i] <= 16 && data[i + 1] <= 16 && data[i + 2] <= 16;
}

/**
 * Re-tone MSE's 50 % black inside rows [top, bottom) to `alpha` / 255, in
 * place. Returns the number of pixels whose alpha changed; throws when the
 * band holds fewer than `minSeeds` px of MSE's black.
 */
export function toneNyxBand(data, width, height, { top, bottom, alpha, minSeeds, label }) {
  const target = alpha / 255;
  const y0 = Math.max(0, top);
  const y1 = Math.min(height, bottom);
  const black = new Uint8Array(width * height);
  let seeds = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (isMseBlack(data, p * 4)) {
        black[p] = 1;
        seeds += 1;
      }
    }
  }
  if (seeds < minSeeds) {
    throw new Error(`toneNyxBand: no 50 % ${label} found (${seeds} px of MSE's black, want ≥ ${minSeeds}) — already toned?`);
  }
  // The black and the pixels within 3 px of it (its anti-aliased edge
  // against the frame), inside the band.
  const near = new Uint8Array(width * height);
  const R = 3;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!black[y * width + x]) continue;
      for (let dy = -R; dy <= R; dy += 1) {
        const yy = y + dy;
        if (yy < y0 || yy >= y1) continue;
        for (let dx = -R; dx <= R; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) near[yy * width + xx] = 1;
        }
      }
    }
  }
  let changed = 0;
  for (let p = y0 * width; p < y1 * width; p += 1) {
    if (!near[p]) continue;
    const i = p * 4;
    const a = data[i + 3] / 255;
    if (a >= 1) continue;
    let a2;
    if (black[p]) {
      // MSE's black itself: the same black at the new alpha.
      a2 = target;
    } else if (a < MSE_ALPHA && data[i] <= 16 && data[i + 1] <= 16 && data[i + 2] <= 16) {
      // A partial cover of it: scales with it.
      a2 = (a / MSE_ALPHA) * target;
    } else if (a > MSE_ALPHA) {
      // The frame's edge over the black: coverage c of its colour F over the
      // 50 % black → keep c and F over the darker black.
      const c = (a - MSE_ALPHA) / (1 - MSE_ALPHA);
      a2 = c + (1 - c) * target;
      const k = a / a2;
      for (let ch = 0; ch < 3; ch += 1) data[i + ch] = Math.round(data[i + ch] * k);
    } else {
      continue;
    }
    const next = Math.min(255, Math.round(a2 * 255));
    if (next !== data[i + 3]) changed += 1;
    data[i + 3] = next;
  }
  return changed;
}

/**
 * Darken one nyx master's type bar and text box, in place (raw RGBA,
 * `width` × `height` — the 1500 × 2100 master). Returns the pixels changed
 * in each; throws, before changing anything, when either still holds too
 * little of MSE's 50 % black.
 */
export function toneNyxMaster(data, width, height) {
  const bands = {
    bar: { top: NYX_TYPE_BAR_ROWS[0], bottom: NYX_TYPE_BAR_ROWS[1], alpha: NYX_TYPE_BAR_ALPHA, minSeeds: MIN_SEEDS.bar, label: "type bar" },
    box: { top: NYX_TEXT_BOX_ROWS[0], bottom: NYX_TEXT_BOX_ROWS[1], alpha: NYX_TEXT_BOX_ALPHA, minSeeds: MIN_SEEDS.box, label: "text box" },
  };
  // Check both before touching either, so a half-toned master is refused whole.
  for (const band of Object.values(bands)) {
    let seeds = 0;
    for (let y = Math.max(0, band.top); y < Math.min(height, band.bottom); y += 1) {
      for (let x = 0; x < width; x += 1) if (isMseBlack(data, (y * width + x) * 4)) seeds += 1;
    }
    if (seeds < band.minSeeds) {
      throw new Error(`toneNyxMaster: no 50 % ${band.label} found (${seeds} px of MSE's black, want ≥ ${band.minSeeds}) — already toned?`);
    }
  }
  return {
    bar: toneNyxBand(data, width, height, bands.bar),
    box: toneNyxBand(data, width, height, bands.box),
  };
}
