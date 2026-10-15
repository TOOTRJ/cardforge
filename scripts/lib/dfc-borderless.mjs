// ---------------------------------------------------------------------------
// dfc-borderless.mjs — the DARK ("inverted") borderless double-faced bodies
// (TODO 5.7) as DATA plus the one pixel function that builds them. Read by
// scripts/build-dfc-borderless-frames.mjs and its unit test.
//
// Print (Scryfall, 2026-10-14; scratchpad dfc-borderless/research): 98 of
// the 134 plain borderless transform / modal printings carry `inverted` —
// the borderless frame's DARK bars and box (m15borderless, CC 'Borderless
// (Alt)'), with the double-faced pieces where the bordered bodies have
// them: the icon well at the title bar's LEFT end (front) or the ▼ well at
// its RIGHT end (back, every set since 2022), the reverse-P/T tab out of the
// box's right edge (front), the modal housing at the bar's left end and the
// flipside strip in the box's bottom-left corner. Card Conjurer draws those
// pieces only in the LIGHT look ('Borderless (Front)' / 'Borderless (Back)'
// transform packs, 'Modal Borderless'); its light masters share the dark
// masters' outline to the pixel everywhere else (rims, outlines, box, fins,
// bottom bar: identical RGBA; measured on every key), so each dark body is
//
//     the published m15borderless master (its crowned twin, its pair)
//   + in a few GRAFT rects, the light master's pixels — rims, rings, the
//     disc, the housing, the tab's outline and the strip — with the light
//     INTERIOR (the bar's, the box's: α < 250) re-coloured to the dark
//     master's own interior on the same row (shade transfer: the light
//     pixel's luma over the light interior's, times the dark interior's
//     colour; alpha the same ratio), so the concave bar end, its shadow and
//     the tab's bevel keep Card Conjurer's shading in the dark colour;
//   + on the ▼ back, the disc (ring, black, ▼) of the published bordered
//     back m15dfcback — the light pack has no right-well back (its back is
//     the 2016–22 left well), so the well is the light FRONT's mirrored and
//     its disc the bordered back's, at the bordered back's centre.
// Where the dark master's own pixels differ from its plain mono master (the
// floating crown of a `-legendary` twin, a pair's pinline), the crown's
// pixels win over a copied rim or a transparent light pixel; the disc and
// the re-coloured interior always draw.
//
// Pure: no I/O. Every number here is DATA; no scan is read by a build.
// ---------------------------------------------------------------------------

export const W = 1500;
export const H = 2100;

/** The colour keys every body publishes: the five colours, gold, the
 *  artifact dress `a` and `c` (the same bytes as `a`: the stand-in, as on
 *  the bordered bodies — FrameProfile.artifactMasterKeys). */
export const MONO_KEYS = ["w", "u", "b", "r", "g", "m", "a", "c"];
/** The ten split pairs (first canonical colour on the LEFT, as m15borderless). */
export const PAIR_KEYS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];
export const LEGENDARY_SUFFIX = "-legendary";
/** The modal bodies' strip rider keys (the other face's colour; a
 *  colourless other face is the artifact stand-in's `a`). */
export const STRIP_RIDER_KEYS = ["w", "u", "b", "r", "g", "m", "a"];

/** The published dark master a body key starts from. */
export function darkBaseOf(key) {
  const legendary = key.endsWith(LEGENDARY_SUFFIX);
  const bare = legendary ? key.slice(0, -LEGENDARY_SUFFIX.length) : key;
  const suffix = legendary ? LEGENDARY_SUFFIX : "";
  if (bare === "a" || bare === "c") return `m15borderlessartifact/c${suffix}`;
  return `m15borderless/${bare}${suffix}`;
}

/** The plain mono master whose pixels a key's graft on `side` is measured
 *  against (the crown / pair keep rule): the side's colour letter. */
export function monoBaseOf(key, side) {
  const bare = key.endsWith(LEGENDARY_SUFFIX) ? key.slice(0, -LEGENDARY_SUFFIX.length) : key;
  if (bare === "a" || bare === "c") return "m15borderlessartifact/c";
  const letter = bare.length === 2 ? (side === "right" ? bare[1] : bare[0]) : bare;
  return `m15borderless/${letter}`;
}

/** The Card Conjurer light-pack letter a key's graft on `side` reads. */
export function lightLetterOf(key, side) {
  const bare = key.endsWith(LEGENDARY_SUFFIX) ? key.slice(0, -LEGENDARY_SUFFIX.length) : key;
  if (bare === "a" || bare === "c") return "a";
  return bare.length === 2 ? (side === "right" ? bare[1] : bare[0]) : bare;
}

/** The bordered back whose disc the ▼ back takes (the disc is the same on
 *  every key: white ring, black disc, white ▼). */
export function borderedBackDiscOf(key) {
  const letter = lightLetterOf(key, "right");
  return `m15dfcback/${letter}`;
}

export const CC_TRANSFORM_FRONT = (letter) => `img/frames/m15/transform/borderless/${letter}f.png`;
export const CC_MODAL_FRONT = (letter) => `img/frames/modal/borderless/${letter}f.png`;
export const CC_MODAL_BACK = (letter) => `img/frames/modal/borderless/${letter}b.png`;
/** CC's Flipside mask (the modal strip, from the border's inner edge to the
 *  chevron's tip) — the strip graft copies the light master inside it. */
export const CC_FLIPSIDE_MASK = "img/frames/modal/regular/reminder.svg";

/** The transform well: the bordered bodies' circle (5.1d's fit on CC's
 *  crown twins: (143.5, 160.5) on the left), the light pack's ring and
 *  rim inside radius 72.5 (to the bar's outline), the bordered ▼ back's
 *  disc inside 62 (the white ring's outer edge at x 82). */
export const WELL = Object.freeze({ cx: 143.5, cy: 160.5, rimRadius: 72.5, discRadius: 62, ringRadius: 60, discScale: 0.95 });
/** The ▼ well, the bordered back's centre (1355.5 = the left well mirrored
 *  about the card's centre column, x → 1499 − x). */
export const RIGHT_WELL = Object.freeze({ cx: 1355.5, cy: 160.5, rimRadius: 72.5, discRadius: 62, ringRadius: 60, discScale: 0.95 });

/** The housing never reaches past this column (its outline ends at 226).
 *  */
export const HOUSING_MAX_X = 240;

/** How far past the rim radius the light master's opaque outline still
 *  belongs to the well. */
export const WELL_OUTLINE_PX = 6;

/** The graft rects (HD px, half-open), the column each row's interior
 *  reference is read at, and the shift (dx, dy) the light pack's piece is
 *  moved by onto PRINT — measured on the 57 dark printings PipGlyph draws
 *  (scratchpad dfc-borderless/research, 2026-10-15): Card Conjurer's light
 *  pieces sit where its bordered transform packs put them, and print's
 *  borderless pieces sit elsewhere:
 *    • the left well's white ring 93–(203) × 104–217 on the fronts (median
 *      of 38 faces; ours 84–203 × 101–220): its centre 6 px right and its
 *      ring 3 px smaller in radius (56.5 against 59.5) — the well moves
 *      +6 and its disc is drawn at × 0.95 (WELL.discScale);
 *    • the ▼ well's ring 1295–1408 × 104–217 on the backs (39 faces; ours
 *      1296–1415): −4 px and the same × 0.95;
 *    • the reverse-P/T tab +4 px down, the modal housing +5 px right
 *      (gradient correlation against each face's master, the type bar's
 *      offset taken off; the strip's −3 px / +4 px rests on a weak
 *      correlation and is not moved).
 *  A horizontal shift keeps the title bar's rim rows continuous across the
 *  graft's edge (the rows are uniform along x); the tab's vertical shift
 *  slides along the box's vertical pinline. */
export const GRAFTS = Object.freeze({
  leftWell: { x0: 0, x1: 330, y0: 40, y1: 245, refX: 400, side: "left", dx: 6, dy: 0 },
  rightWell: { x0: 1170, x1: 1500, y0: 40, y1: 245, refX: 1100, side: "right", dx: -4, dy: 0 },
  housing: { x0: 0, x1: 330, y0: 30, y1: 245, refX: 400, side: "left", dx: 5, dy: 0 },
  // (Ends above the bottom bar, 1937 px: the shifted piece never reaches it.)
  tab: { x0: 1330, x1: 1500, y0: 1640, y1: 1925, refX: 1250, side: "right", dx: 0, dy: 4 },
  strip: { x0: 30, x1: 720, y0: 1850, y1: 1975, side: "left", dx: 0, dy: 0 },
});

/** Bilinear sample of an RGBA canvas (premultiplied), transparent outside. */
export function sampleBilinear(buf, fx, fy) {
  const x0 = Math.floor(fx - 0.5);
  const y0 = Math.floor(fy - 0.5);
  const tx = fx - 0.5 - x0;
  const ty = fy - 0.5 - y0;
  const acc = [0, 0, 0, 0];
  for (const [xx, yy, w] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ]) {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H || w === 0) continue;
    const o = (yy * W + xx) * 4;
    const a = buf[o + 3] * w;
    acc[0] += buf[o] * a;
    acc[1] += buf[o + 1] * a;
    acc[2] += buf[o + 2] * a;
    acc[3] += a;
  }
  if (acc[3] <= 0.0001) return [0, 0, 0, 0];
  return [Math.round(acc[0] / acc[3]), Math.round(acc[1] / acc[3]), Math.round(acc[2] / acc[3]), Math.round(acc[3])];
}

/** The four bodies: which light master each graft reads and how. */
export const DFC_BORDERLESS_TEMPLATES = Object.freeze({
  m15borderlessdfcfront: {
    label: "transform front",
    grafts: [
      { graft: "leftWell", light: CC_TRANSFORM_FRONT, well: WELL },
      { graft: "tab", light: CC_TRANSFORM_FRONT },
    ],
  },
  m15borderlessdfcback: {
    label: "transform back (▼ right)",
    grafts: [{ graft: "rightWell", light: CC_TRANSFORM_FRONT, mirror: true, well: RIGHT_WELL, borderedDisc: true }],
  },
  m15borderlessmdfcfront: {
    label: "modal front",
    grafts: [
      { graft: "housing", light: CC_MODAL_FRONT, housing: "light" },
      { graft: "strip", light: CC_MODAL_FRONT, mask: CC_FLIPSIDE_MASK },
    ],
  },
  m15borderlessmdfcback: {
    label: "modal back",
    grafts: [
      { graft: "housing", light: CC_MODAL_BACK, housing: "dark" },
      { graft: "strip", light: CC_MODAL_BACK, mask: CC_FLIPSIDE_MASK },
    ],
  },
});

/** Every key a body publishes: the mono keys and the pairs, each with its
 *  crowned twin. */
export function bodyKeys() {
  const bare = [...MONO_KEYS, ...PAIR_KEYS];
  return [...bare, ...bare.map((k) => `${k}${LEGENDARY_SUFFIX}`)];
}

/** Below this alpha a light-master pixel is INTERIOR (the bars' and the
 *  box's translucent paint, α 191–217); rims, outlines, rings and the disc
 *  are opaque. */
export const INTERIOR_ALPHA = 250;
/** A pixel differs from the mono master (the crown / pair keep rule) when
 *  any channel moves by more than this. */
export const KEEP_TOLERANCE = 8;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The dark interior colour for a light pixel `l` whose row's light
 *  interior is `lr` and dark interior `dr` (each [r, g, b, a]). */
export function shadeTransfer(l, lr, dr) {
  const ll = luma(l[0], l[1], l[2]);
  const lrl = Math.max(1, luma(lr[0], lr[1], lr[2]));
  const t = Math.min(1.25, ll / lrl);
  const a = Math.min(255, Math.round((dr[3] * l[3]) / Math.max(1, lr[3])));
  return [
    Math.min(255, Math.round(dr[0] * t)),
    Math.min(255, Math.round(dr[1] * t)),
    Math.min(255, Math.round(dr[2] * t)),
    a,
  ];
}

/** Whether a light pixel is the same paint as its reference interior
 *  (direction of its colour within ~5°, luma 10–125 % of it, translucent):
 *  the interior, its shadow and its anti-aliased edge — never the white
 *  ring, a white glyph or the coloured rim. */
export function isInteriorLike(l, lr) {
  if (l[3] === 0 || l[3] >= INTERIOR_ALPHA || lr[3] >= INTERIOR_ALPHA) return false;
  const dot = l[0] * lr[0] + l[1] * lr[1] + l[2] * lr[2];
  const nl = Math.hypot(l[0], l[1], l[2]);
  const nr = Math.hypot(lr[0], lr[1], lr[2]);
  if (nl === 0) return true; // black paint in the interior: its shadow's core
  if (nr === 0) return false;
  return dot / (nl * nr) >= 0.995;
}

const px = (buf, x, y) => {
  const o = (y * W + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
};
const put = (buf, x, y, v) => {
  const o = (y * W + x) * 4;
  buf[o] = v[0];
  buf[o + 1] = v[1];
  buf[o + 2] = v[2];
  buf[o + 3] = v[3];
};
/** Two pixels differ (premultiplied: every fully transparent pixel is the
 *  same pixel, whatever RGB it carries). */
export function differs(a, b) {
  for (let c = 0; c < 3; c++) {
    if (Math.abs((a[c] * a[3]) / 255 - (b[c] * b[3]) / 255) > KEEP_TOLERANCE) return true;
  }
  return Math.abs(a[3] - b[3]) > KEEP_TOLERANCE;
}

/**
 * Apply one graft to `out` (a copy of the dark master `dark`), in place.
 *   light  — the light master's RGBA (already mirrored when the graft says)
 *   mono   — the plain mono dark master of the graft's colour (keep rule)
 *   disc   — the bordered back's RGBA (the ▼ back) or null
 *   mask   — a Uint8Array alpha plane (the strip) or null
 * Returns how many pixels changed.
 */
export function applyGraft(out, dark, light, mono, spec, { disc = null, mask = null } = {}) {
  const g = GRAFTS[spec.graft];
  let changed = 0;
  if (spec.graft === "strip") {
    for (let y = g.y0; y < g.y1; y++) {
      for (let x = g.x0; x < g.x1; x++) {
        const m = mask[y * W + x] / 255;
        if (m === 0) continue;
        const d = px(dark, x, y);
        const l = px(light, x, y);
        // Premultiplied lerp dark → light by the mask.
        const a = d[3] * (1 - m) + l[3] * m;
        const v = a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((c) => Math.round((d[c] * d[3] * (1 - m) + l[c] * l[3] * m) / a));
        if (a !== 0) v.push(Math.round(a));
        if (differs(v, d)) changed++;
        put(out, x, y, v);
      }
    }
    return changed;
  }
  // The housing's interior reference: the bar's flat paint on the title's
  // middle row (the housing's rows reach above and below the bar's).
  const sx = g.dx ?? 0;
  const sy = g.dy ?? 0;
  // The light pack's pixel at (x, y) after its shift onto print.
  const lpx = (x, y) => {
    const xs = x - sx;
    const ys = y - sy;
    return xs < 0 || ys < 0 || xs >= W || ys >= H ? [0, 0, 0, 0] : px(light, xs, ys);
  };
  const globalLr = lpx(g.refX, 160);
  const globalDr = px(dark, g.refX, 160);
  // The well's centre on print, and its disc's source and centre there.
  const well = spec.well;
  const ecx = well ? well.cx + sx : 0;
  const ecy = well ? well.cy + sy : 0;
  const discScale = well?.discScale ?? 1;
  const discSource = spec.borderedDisc && disc ? disc : light;
  for (let y = g.y0; y < g.y1; y++) {
    const lr = lpx(g.refX, y);
    const dr = px(dark, g.refX, y);
    // The housing's right outline on this row: the first opaque light pixel
    // scanning left from the graft's inner edge (spec.housing only).
    let housingEnd = -1;
    if (spec.housing) {
      for (let x = g.x1 - 1; x >= g.x0; x--) {
        if (lpx(x, y)[3] >= INTERIOR_ALPHA) {
          // (A row above or below the bar meets the rim at once: no housing.)
          housingEnd = x < HOUSING_MAX_X ? x : -1;
          break;
        }
      }
    }
    for (let x = g.x0; x < g.x1; x++) {
      const d = px(dark, x, y);
      const l = lpx(x, y);
      const m = mono ? px(mono, x, y) : d;
      // A copied light pixel is the graft's own piece (drawn over a crown)
      // only where it brings something the plain mono master lacks — the
      // ring, the housing, the tab's outline — and is not transparent; a
      // rim or outline the mono master already paints yields to a crown.
      // (Within a row either way: the modal pack draws the bar's top rim 1 px
      // lower than the dark masters.)
      const own =
        l[3] > 0 && differs(l, m) && (!mono || ((y === 0 || differs(l, px(mono, x, y - 1))) && (y === H - 1 || differs(l, px(mono, x, y + 1)))));
      let v;
      let drawn = false; // the disc / a re-coloured interior: always drawn
      if (well) {
        const ux = x + 0.5 - (ecx + 0.5);
        const uy = y + 0.5 - (ecy + 0.5);
        const r = Math.hypot(ux, uy);
        if (r <= well.ringRadius * discScale) {
          // The disc (ring, black, glyph), drawn at its print size about the
          // print's centre from its source's own centre.
          v = sampleBilinear(discSource, well.cx + 0.5 + ux / discScale, well.cy + 0.5 + uy / discScale);
          drawn = true;
        } else if (r <= well.discRadius) {
          // What the smaller disc leaves: the rim, read further out on the
          // same ray of the (unshifted) light piece.
          const k = (well.rimRadius - 5) / Math.max(r, 1e-6);
          v = sampleBilinear(light, well.cx + 0.5 + ux * k, well.cy + 0.5 + uy * k);
          drawn = true;
        } else if (r <= well.rimRadius) {
          v = l;
          drawn = own;
        } else if (r <= well.rimRadius + WELL_OUTLINE_PX && l[3] >= INTERIOR_ALPHA) {
          // The well's own outline, just past the rim: drawn over a crown
          // too (a crown's pixels would leave it dotted).
          v = l;
          drawn = true;
        }
      }
      if (!v) {
        const inHousing = spec.housing && x < housingEnd;
        if (inHousing) {
          if (spec.housing === "dark" && isInteriorLike(l, globalLr)) {
            v = shadeTransfer(l, globalLr, globalDr);
            drawn = true;
          } else {
            v = l;
            // Inside the housing every opaque piece is the housing's own (its
            // outline, ring and rim): a crown never shows through it.
            drawn = own || l[3] >= INTERIOR_ALPHA;
          }
        } else if (isInteriorLike(l, lr)) {
          v = shadeTransfer(l, lr, dr);
          drawn = true;
        } else {
          v = l;
          drawn = own;
        }
      }
      // The keep rule: the dark master's own piece (a crown, a pair's
      // pinline) wins over a copied rim or a transparent light pixel.
      if (!drawn && differs(d, m)) v = d;
      if (differs(v, d)) changed++;
      put(out, x, y, v);
    }
  }
  return changed;
}

/** Mirror an RGBA canvas left ↔ right (x → W − 1 − x). */
export function mirrorX(buf) {
  const out = Buffer.alloc(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      const t = (y * W + (W - 1 - x)) * 4;
      out[t] = buf[s];
      out[t + 1] = buf[s + 1];
      out[t + 2] = buf[s + 2];
      out[t + 3] = buf[s + 3];
    }
  }
  return out;
}
