# Google Fonts Noto Sans responses (test fixtures)

Recorded 2026-09-26 from `fonts.googleapis.com/css2?family=Noto+Sans&text=…`
with the user agent next/og's `loadGoogleFont` sends — i.e. exactly the font a
card bake received at render time before TODO 6.16a moved the fallback on disk.
Noto Sans 2.015 (v42), SIL Open Font License 1.1 (`OFL.txt`).

- `text-<hex>.ttf` — the subset served for that request text (`1f4` = "Ǵ",
  `200b` = U+200B, `1f5-1f4-200b` = "ǵǴ" + U+200B). The production
  cards that fetched fonts asked for "Ǵ" (artist line) and U+200B (flavor text).
  `tests/unit/render/fallback-assets-bake.test.ts` replays them as next/og did
  and checks the local fallback bakes the same bytes.
- `subset-cmaps.json` — the code points each sampled request's subset maps
  (keyed by the requested code points), for the closure rule in
  `lib/render/fallback-assets.ts`.
