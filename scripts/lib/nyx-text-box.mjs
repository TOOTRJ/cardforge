// ---------------------------------------------------------------------------
// The nyx text box's darkness (TODO 4.17e; owner round 13, 2026-09-29:
// "darken it to match the prints"). MSE's Theros constellation masters paint
// the text box flat black at α 127.5 / 255 (50 %) in every colour; since
// layout v35 the art runs under the whole box (4.17b), and on the THB
// constellation prints the box reads far darker: its median luminance is
// 32–33 whatever the art (#258 / #259 / #268), 0.28–0.39 of the art above it
// (mean 0.33, the art window's bottom strip as the proxy for the art under
// the box). So the box lets a third of the art through: α 171 / 255 (the
// same black). The type bar (the prints' 0.36–0.46 of the art, ours 0.50) is
// left as MSE paints it.
//
// Applied by scripts/build-variation-frames.mjs to the nyx masters before the
// corner normalisation (the box is far from the corners), on the raw
// 1500 × 2100 RGBA buffer, in place. Only
// the translucent box below the type bar changes: its black pixels (α ≤ the
// box's own) scale to the new alpha, and the frame's anti-aliased edge
// pixels over it — modelled as the opaque frame colour at coverage c over the
// box — keep their colour and coverage over the darker box. Refuses a buffer
// whose box is not MSE's 50 % (already toned).
// ---------------------------------------------------------------------------

/** MSE's box alpha (127 and 128 both occur: 127.5 quantised). */
const MSE_BOX_ALPHA = 127.5 / 255;
/** The toned box alpha: a third of the art shows through, as on the prints. */
export const NYX_TEXT_BOX_ALPHA = 171;
/** The box lies below the type bar and the frame line under it (y ≥ this on
 *  the 1500 × 2100 master): the type bar keeps MSE's alpha. */
const BOX_TOP_PX = 1310;

/**
 * Darken the nyx text box of one master, in place (raw RGBA, `width` ×
 * `height`). Returns the number of pixels changed.
 */
export function toneNyxTextBox(data, width, height) {
  const target = NYX_TEXT_BOX_ALPHA / 255;
  const at = (x, y) => (y * width + x) * 4;
  const isBox = (i) => (data[i + 3] === 127 || data[i + 3] === 128) && data[i] <= 16 && data[i + 1] <= 16 && data[i + 2] <= 16;
  // The box: MSE's translucent black below the type bar, and the pixels
  // within 3 px of it (its anti-aliased edge against the frame).
  const box = new Uint8Array(width * height);
  let seeds = 0;
  for (let y = BOX_TOP_PX; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isBox(at(x, y))) {
        box[y * width + x] = 1;
        seeds += 1;
      }
    }
  }
  if (seeds < 100_000) throw new Error(`toneNyxTextBox: no 50 % text box found (${seeds} px) — already toned?`);
  const near = new Uint8Array(width * height);
  const R = 3;
  for (let y = BOX_TOP_PX; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!box[y * width + x]) continue;
      for (let dy = -R; dy <= R; dy += 1) {
        const yy = y + dy;
        if (yy < BOX_TOP_PX || yy >= height) continue;
        for (let dx = -R; dx <= R; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) near[yy * width + xx] = 1;
        }
      }
    }
  }
  let changed = 0;
  for (let p = 0; p < width * height; p += 1) {
    if (!near[p]) continue;
    const i = p * 4;
    const a = data[i + 3] / 255;
    if (a >= 1) continue;
    const black = data[i] <= 16 && data[i + 1] <= 16 && data[i + 2] <= 16;
    let a2;
    if (a <= MSE_BOX_ALPHA + 1e-6 && black) {
      // The box itself (or a partial cover of it): the same black, darker.
      a2 = (a / MSE_BOX_ALPHA) * target;
    } else if (a > MSE_BOX_ALPHA) {
      // The frame's edge over the box: coverage c of its colour F over the
      // 50 % black → keep c and F over the darker box.
      const c = (a - MSE_BOX_ALPHA) / (1 - MSE_BOX_ALPHA);
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
