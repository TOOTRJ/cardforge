// ---------------------------------------------------------------------------
// Zero Beleren Bold's collision-guard kerns (layout v72): public/fonts/
// Beleren-Bold.ttf + .woff2.
//
// The font kerns a few pairs APART where the two letters' ink would touch
// (K→y, R→j, f→l, f→i…); the prints set them tight. The pairs are DATA in
// lib/cards/display-kerning.ts (ZEROED_DISPLAY_KERN_PAIRS — why, and why
// these and no others, is said there). This script sets every POSITIVE
// x-advance of those pairs in the font's GPOS 'kern' pair lists to 0 — the
// pair as listed, and the same pair with an accented right letter ("fí") —
// and nothing else: no glyph, advance, other pair, table or name moves. The
// woff2 is written from the same patched font, so the preview and the bake
// read one set of numbers.
//
//   node scripts/fix-beleren-kerning.mjs [--source <unpatched Beleren-Bold.ttf>]
//
// With no --source it patches the committed TTF in place (idempotent: a
// patched font is written back with nothing to change). Then regenerate the
// metric tables (`node scripts/generate-font-metrics.mjs`) and commit the
// two fonts with them. A class-based pair (GPOS format 2) is never touched:
// none of the listed pairs is kerned by class, and the script fails if one
// ever is rather than move a whole class.
//
// Needs Python 3 with fontTools + brotli (`python3 -m pip install fonttools
// brotli`), as scripts/subset-geist.mjs and build-collector-font.mjs.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { ZEROED_DISPLAY_KERN_PAIRS } from "../lib/cards/display-kerning.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--source");
const ttf = path.resolve("public/fonts/Beleren-Bold.ttf");
const woff2 = path.resolve("public/fonts/Beleren-Bold.woff2");
const source = at >= 0 ? path.resolve(args[at + 1]) : ttf;

const PY = String.raw`
import sys, json, unicodedata
from fontTools.ttLib import TTFont
src, out_ttf, out_woff2, pairs = sys.argv[1], sys.argv[2], sys.argv[3], set(json.loads(sys.argv[4]))
font = TTFont(src, recalcTimestamp=False)
char = {}
for cp, name in font.getBestCmap().items():
    char.setdefault(name, chr(cp))
base = lambda name: unicodedata.normalize("NFD", char[name])[0] if name in char else None
gpos = font["GPOS"].table
kern = [r.Feature.LookupListIndex for r in gpos.FeatureList.FeatureRecord if r.FeatureTag == "kern"]
zeroed, kept = [], 0
for lookups in kern:
    for index in lookups:
        for sub in gpos.LookupList.Lookup[index].SubTable:
            if sub.Format == 2:
                order = font.getGlyphOrder()
                for a in sub.Coverage.glyphs:
                    for b in order:
                        if a in char and (char[a] + (base(b) or "")) in pairs:
                            c1 = sub.ClassDef1.classDefs.get(a, 0)
                            c2 = sub.ClassDef2.classDefs.get(b, 0)
                            v = getattr(sub.Class1Record[c1].Class2Record[c2].Value1, "XAdvance", 0) or 0
                            if v > 0:
                                sys.exit(f"class-kerned pair {char[a]}{char.get(b, b)} (+{v}): not patched — see the script's header")
                continue
            for a, pair_set in zip(sub.Coverage.glyphs, sub.PairSet):
                for record in pair_set.PairValueRecord:
                    v = getattr(record.Value1, "XAdvance", 0) or 0
                    if v > 0 and a in char and (char[a] + (base(record.SecondGlyph) or "")) in pairs:
                        record.Value1.XAdvance = 0
                        zeroed.append(char[a] + char.get(record.SecondGlyph, record.SecondGlyph))
font.save(out_ttf)
font.flavor = "woff2"
font.save(out_woff2)
print(f"{len(zeroed)} pair records zeroed: {' '.join(sorted(set(zeroed))) or '(none — already patched)'}")
`;

execFileSync("python3", ["-c", PY, source, ttf, woff2, JSON.stringify(ZEROED_DISPLAY_KERN_PAIRS)], { stdio: "inherit" });
console.log(`✓ ${path.relative(process.cwd(), ttf)}: ${statSync(ttf).size} bytes`);
console.log(`✓ ${path.relative(process.cwd(), woff2)}: ${statSync(woff2).size} bytes`);
console.log("Next: node scripts/generate-font-metrics.mjs");
