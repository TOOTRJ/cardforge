import qrcode from "qrcode-generator";

// ---------------------------------------------------------------------------
// A QR code as ONE SVG path (qrcode-generator, MIT): every dark module a
// 1 × 1 square in a `size × size` grid with a quiet zone of `QR_QUIET`
// modules, drawn by the caller as
//   <svg viewBox={`0 0 ${size} ${size}`}><path d={d} fill="currentColor" /></svg>
// so it prints crisp at any size. Error correction M (15 %): sturdy on paper
// without growing the code. Pure, works on the server and in the browser.
// ---------------------------------------------------------------------------

export const QR_QUIET = 2;

export type QrPath = { d: string; size: number };

export function qrPath(text: string): QrPath {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row += 1) {
    // Runs of dark modules on a row are one rectangle each.
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col += 1;
      parts.push(`M${start + QR_QUIET} ${row + QR_QUIET}h${col - start}v1h-${col - start}z`);
    }
  }
  return { d: parts.join(""), size: count + QR_QUIET * 2 };
}
