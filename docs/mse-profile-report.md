# MSE profile review report

Generated 2026-07-02 by scripts/import-mse-profiles.mjs from /Users/redjester/Projects/other/Full-Magic-Pack/data.

> **How to read this:** MSE values are the coordinates the frame ART was authored
> against — a strong *baseline* for untuned templates, **not** ground truth vs real
> printed cards (e.g. MSE m15 type font is 13/375 where real prints measure ~17/375).
> **Scan-measured values in template-layout.ts beat MSE — keeping the current value
> is a first-class outcome.** Rect fields are % of card size; sizes are fractions of
> card width. `dynamic` = content-dependent MSE expression (shown raw; human call).

## m15  `magic-m15.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.8 | 5.74 | 0.94 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 83.7 | — | — |  |
| title.heightPct | 6 | 4.4 | -1.60 |  |
| title.sizePct | 0.05 | 0.0427 | -0.0073 |  |
| costSizePct | 0.0485 | 0.04 | -0.0085 | symbol font of casting cost |
| artSlot.topPct | 11.4 | 11.47 | 0.07 |  |
| artSlot.leftPct | 7.8 | 7.73 | -0.07 |  |
| artSlot.widthPct | 84.4 | 84.27 | -0.13 |  |
| artSlot.heightPct | 44 | 44.17 | 0.17 |  |
| type.topPct | 56.5 | 56.6 | 0.10 |  |
| type.leftPct | 8.5 | 8.53 | 0.03 |  |
| type.widthPct | 83.7 | — | — | { (if has_identity() then "290" else "310") - max(22,card_style.rarity.content_width) } |
| type.heightPct | 5.2 | 3.82 | -1.38 |  |
| type.sizePct | 0.0435 | 0.0347 | -0.0088 |  |
| rules.topPct | 63.6 | 62.52 | -1.08 |  |
| rules.leftPct | 8.5 | 7.73 | -0.77 |  |
| rules.widthPct | 83 | 83.73 | 0.73 |  |
| rules.heightPct | 28 | 29.45 | 1.45 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.3 | 89.67 | 0.37 |  |
| pt.leftPct | 73 | 76.27 | 3.27 |  |
| pt.widthPct | 23 | 16 | -7.00 |  |
| pt.heightPct | 5.8 | 5.35 | -0.45 |  |
| pt.sizePct | 0.05 | 0.0427 | -0.0073 |  |

## m15land  `magic-m15.mse-style` (375×523) — _land variant shares magic-m15 geometry_

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.8 | 5.74 | 0.94 |  |
| title.leftPct | 14 | 8.53 | -5.47 |  |
| title.widthPct | 77.5 | — | — |  |
| title.heightPct | 6 | 4.4 | -1.60 |  |
| title.sizePct | 0.05 | 0.0427 | -0.0073 |  |
| costSizePct | 0.0485 | 0.04 | -0.0085 | symbol font of casting cost |
| artSlot.topPct | 11.4 | 11.47 | 0.07 |  |
| artSlot.leftPct | 7.8 | 7.73 | -0.07 |  |
| artSlot.widthPct | 84.4 | 84.27 | -0.13 |  |
| artSlot.heightPct | 44 | 44.17 | 0.17 |  |
| type.topPct | 56.5 | 56.6 | 0.10 |  |
| type.leftPct | 8.5 | 8.53 | 0.03 |  |
| type.widthPct | 83.7 | — | — | { (if has_identity() then "290" else "310") - max(22,card_style.rarity.content_width) } |
| type.heightPct | 5.2 | 3.82 | -1.38 |  |
| type.sizePct | 0.0435 | 0.0347 | -0.0088 |  |
| rules.topPct | 63.6 | 62.52 | -1.08 |  |
| rules.leftPct | 8.5 | 7.73 | -0.77 |  |
| rules.widthPct | 83 | 83.73 | 0.73 |  |
| rules.heightPct | 28 | 29.45 | 1.45 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.3 | 89.67 | 0.37 |  |
| pt.leftPct | 73 | 76.27 | 3.27 |  |
| pt.widthPct | 23 | 16 | -7.00 |  |
| pt.heightPct | 5.8 | 5.35 | -0.45 |  |
| pt.sizePct | 0.05 | 0.0427 | -0.0073 |  |

## m15token  `magic-m15-token.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.6 | 4.97 | 0.37 |  |
| title.leftPct | 9 | 8 | -1.00 |  |
| title.widthPct | 82 | 84 | 2.00 |  |
| title.heightPct | 6.4 | 5.35 | -1.05 |  |
| title.sizePct | 0.05 | 0.0507 | 0.0007 |  |
| artSlot.topPct | 12 | 11.85 | -0.15 |  |
| artSlot.leftPct | 6.5 | 7.73 | 1.23 |  |
| artSlot.widthPct | 87 | 84.53 | -2.47 |  |
| artSlot.heightPct | 69 | — | — |  |
| type.topPct | 82.6 | — | — |  |
| type.leftPct | 11 | 8.53 | -2.47 |  |
| type.widthPct | 78 | — | — | { 311 - max(22,card_style.rarity.content_width) } |
| type.heightPct | 4.2 | 3.82 | -0.38 |  |
| type.sizePct | 0.034 | 0.0373 | 0.0033 |  |
| rules.topPct | 60.5 | — | — |  |
| rules.leftPct | 12 | 8.27 | -3.73 |  |
| rules.widthPct | 76 | 82.93 | 6.93 |  |
| rules.heightPct | 12 | — | — |  |
| rules.sizePct | 0.031 | 0.0373 | 0.0063 |  |
| pt.topPct | 88.6 | 89.67 | 1.07 |  |
| pt.leftPct | 73.5 | 76.27 | 2.77 |  |
| pt.widthPct | 20 | 16 | -4.00 |  |
| pt.heightPct | 6.2 | 5.35 | -0.85 |  |
| pt.sizePct | 0.0427 | 0.0427 | 0.0000 |  |

## m15snow  `magic-m15-snow.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.8 | 5.74 | 0.94 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 83.7 | — | — |  |
| title.heightPct | 6 | 4.4 | -1.60 |  |
| title.sizePct | 0.05 | 0.0427 | -0.0073 |  |
| costSizePct | 0.0485 | 0.04 | -0.0085 | symbol font of casting cost |
| artSlot.topPct | 11.4 | 11.47 | 0.07 |  |
| artSlot.leftPct | 7.8 | 7.73 | -0.07 |  |
| artSlot.widthPct | 84.4 | 84.27 | -0.13 |  |
| artSlot.heightPct | 44 | 44.17 | 0.17 |  |
| type.topPct | 56.5 | 56.6 | 0.10 |  |
| type.leftPct | 8.5 | 8.53 | 0.03 |  |
| type.widthPct | 83.7 | — | — | { (if has_identity() then "290" else "310") - max(22,card_style.rarity.content_width) } |
| type.heightPct | 5.2 | 3.82 | -1.38 |  |
| type.sizePct | 0.0435 | 0.0347 | -0.0088 |  |
| rules.topPct | 63.6 | 62.52 | -1.08 |  |
| rules.leftPct | 8.5 | 7.73 | -0.77 |  |
| rules.widthPct | 83 | 83.73 | 0.73 |  |
| rules.heightPct | 28 | — | — |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.3 | 89.67 | 0.37 |  |
| pt.leftPct | 73 | 76.27 | 3.27 |  |
| pt.widthPct | 23 | 16 | -7.00 |  |
| pt.heightPct | 5.8 | 5.35 | -0.45 |  |
| pt.sizePct | 0.05 | 0.0427 | -0.0073 |  |

## m15devoid  `magic-m15-devoid.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.8 | 5.74 | 0.94 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 83.7 | — | — |  |
| title.heightPct | 6 | — | — | { 23 - to_int(0.5 * shrink_name())} |
| title.sizePct | 0.05 | — | — |  |
| costSizePct | 0.0485 | 0.04 | -0.0085 | symbol font of casting cost |
| artSlot.topPct | 11.4 | 11.47 | 0.07 |  |
| artSlot.leftPct | 7.8 | 3.73 | -4.07 |  |
| artSlot.widthPct | 84.4 | 92.27 | 7.87 |  |
| artSlot.heightPct | 44 | 82.6 | 38.60 |  |
| type.topPct | 56.5 | — | — | { 294 + shrink_type() } |
| type.leftPct | 8.5 | 9.6 | 1.10 |  |
| type.widthPct | 83.7 | — | — | { 307 - max(22,card_style.rarity.content_width) } |
| type.heightPct | 5.2 | — | — | { 20 - shrink_type() } |
| type.sizePct | 0.0435 | — | — |  |
| rules.topPct | 63.6 | — | — | { top_of_textbox() } |
| rules.leftPct | 8.5 | 7.73 | -0.77 |  |
| rules.widthPct | 83 | 83.73 | 0.73 |  |
| rules.heightPct | 28 | — | — |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.3 | 89.67 | 0.37 |  |
| pt.leftPct | 73 | 76.27 | 3.27 |  |
| pt.widthPct | 23 | 16 | -7.00 |  |
| pt.heightPct | 5.8 | 5.35 | -0.45 |  |
| pt.sizePct | 0.05 | 0.0427 | -0.0073 |  |

## m15pw  `magic-m15-planeswalker.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.4 | 4.4 | 0.00 |  |
| title.leftPct | 8.5 | 8.27 | -0.23 |  |
| title.widthPct | 80 | — | — |  |
| title.heightPct | 4.4 | 4.4 | 0.00 |  |
| title.sizePct | 0.0427 | 0.0427 | 0.0000 |  |
| costSizePct | 0.0427 | 0.04 | -0.0027 | symbol font of casting cost |
| artSlot.topPct | 9.9 | 9.94 | 0.04 |  |
| artSlot.leftPct | 6.7 | 6.67 | -0.03 |  |
| artSlot.widthPct | 86.4 | 86.4 | 0.00 |  |
| artSlot.heightPct | 81.7 | 81.74 | 0.04 |  |
| type.topPct | 56.6 | 56.6 | 0.00 |  |
| type.leftPct | 8.8 | 8.8 | 0.00 |  |
| type.widthPct | 79 | — | — | { 304 - max(22,card_style.rarity.content_width) } |
| type.heightPct | 3.8 | 3.82 | 0.02 |  |
| type.sizePct | 0.0347 | 0.0347 | 0.0000 |  |
| rules.topPct | 63.1 | 63.1 | 0.00 |  |
| rules.leftPct | 8.5 | 16.8 | 8.30 |  |
| rules.widthPct | 83.5 | 75.2 | -8.30 |  |
| rules.heightPct | 28.3 | 28.3 | 0.00 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| _extra:_ loyalty | — | t88.34 l86.93 w3.51 h6.62 s0.0373 | — |  |

## battle  `magic-m15-mainframe-battles.mse-style` (523×375)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.2 | — | — | { 21 + name_font_vertical()} |
| title.leftPct | 12.8 | 12.81 | 0.01 |  |
| title.widthPct | 74 | — | — | { 410 - max(15,card_style.casting_cost.content_width) - (if card.transformation != "none" then 35 else 0) } |
| title.heightPct | 6.4 | 5.87 | -0.53 |  |
| title.sizePct | 0.034 | — | — |  |
| artSlot.topPct | 13.6 | 4 | -9.60 |  |
| artSlot.leftPct | 4 | 7.84 | 3.84 |  |
| artSlot.widthPct | 92 | 89.29 | -2.71 |  |
| artSlot.heightPct | 43.6 | 92 | 48.40 |  |
| type.topPct | 58.4 | — | — | { 219 + type_font_vertical() } |
| type.leftPct | 12.8 | 12.81 | 0.01 |  |
| type.widthPct | 74 | — | — | { 400 - rare_width() } |
| type.heightPct | 6.2 | 5.87 | -0.33 |  |
| type.sizePct | 0.025 | — | — |  |
| rules.topPct | 67.5 | — | — | { 252 + body_font_vertical() + chop_top() } |
| rules.leftPct | 12.1 | 12.05 | -0.05 |  |
| rules.widthPct | 78.4 | 78.39 | -0.01 |  |
| rules.heightPct | 27 | — | — |  |
| rules.sizePct | 0.0268 | — | — |  |
| pt.topPct | — | 89.6 | — |  |
| pt.leftPct | — | 86.42 | — |  |
| pt.widthPct | — | 0 | — |  |
| pt.heightPct | — | 6.4 | — |  |
| _extra:_ loyalty | — | t89.6 l91.78 w4.21 h6.4 s— | — |  |

## saga  `magic-m15-saga.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.4 | 5.74 | 0.34 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 83 | — | — |  |
| title.heightPct | 4.8 | — | — | { 23- (0.5 * shrink_name())} |
| title.sizePct | 0.0427 | — | — |  |
| costSizePct | 0.04 | 0.04 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 11.3 | 11.28 | -0.02 |  |
| artSlot.leftPct | 50.1 | 7.73 | -42.37 |  |
| artSlot.widthPct | 41.9 | 41.87 | -0.03 |  |
| artSlot.heightPct | 72.5 | 72.47 | -0.03 |  |
| type.topPct | 84.9 | — | — | { 444 + shrink_type() } |
| type.leftPct | 8.8 | 8.8 | 0.00 |  |
| type.widthPct | 82 | — | — | { 309 - rare_width() } |
| type.heightPct | 3.9 | — | — | { 20 - shrink_type() } |
| type.sizePct | 0.0347 | — | — |  |
| rules.topPct | 11.5 | 11.47 | -0.03 |  |
| rules.leftPct | 8 | 50.13 | 42.13 |  |
| rules.widthPct | 41 | 40.8 | -0.20 |  |
| rules.heightPct | 72 | — | — |  |
| rules.sizePct | 0.029 | 0.0347 | 0.0057 |  |
| pt.topPct | — | 89.67 | — |  |
| pt.leftPct | — | 76.27 | — |  |
| pt.widthPct | — | 16 | — |  |
| pt.heightPct | — | 5.35 | — |  |
| pt.sizePct | — | 0.0427 | — |  |
| _extra:_ level 2 | — | t— l72 w0 h3.82 s— | — | top: {lev2()+3} |
| _extra:_ level 3 | — | t— l72 w0 h3.82 s— | — | top: {lev3()+3} |
| _extra:_ level 4 | — | t— l72 w0 h3.82 s— | — | top: {lev4()+3} |

## adventure  `magic-m15-adventure.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.8 | — | — | {30 + name_font_vertical()} |
| title.leftPct | 8.5 | 13.33 | 4.83 |  |
| title.widthPct | 83.7 | — | — |  |
| title.heightPct | 6 | — | — | { 23 - 0.5*shrink_name() } |
| title.sizePct | 0.05 | — | — |  |
| costSizePct | 0.0485 | 0.04 | -0.0085 | symbol font of casting cost |
| artSlot.topPct | 11.4 | 11.28 | -0.12 |  |
| artSlot.leftPct | 7.8 | 7.73 | -0.07 |  |
| artSlot.widthPct | 84.4 | 84.27 | -0.13 |  |
| artSlot.heightPct | 44 | 44.17 | 0.17 |  |
| type.topPct | 56.5 | 56.6 | 0.10 |  |
| type.leftPct | 8.5 | 8.53 | 0.03 |  |
| type.widthPct | 83.7 | 0 | -83.70 |  |
| type.heightPct | 5.2 | — | — | { 20 - shrink_type() } |
| type.sizePct | 0.0435 | — | — |  |
| rules.topPct | 63.5 | — | — | { (if is_spot() then 335 else page_1_top()) + to_int(chop_top()) + body_font_vertical() } |
| rules.leftPct | 50.7 | — | — | {page_coords[page_1_side()]["text"]} |
| rules.widthPct | 38.2 | 38.13 | -0.07 |  |
| rules.heightPct | 28.5 | — | — |  |
| rules.sizePct | 0.031 | — | — |  |
| pt.topPct | 89.3 | 89.67 | 0.37 |  |
| pt.leftPct | 73 | 76.27 | 3.27 |  |
| pt.widthPct | 23 | 16 | -7.00 |  |
| pt.heightPct | 5.8 | 5.35 | -0.45 |  |
| pt.sizePct | 0.05 | — | — |  |
| _extra:_ name 2 | — | t63.1 l— w— h— s— | — | left: { page_coords[page_2_side()]["name_left"] }; height: { 20 - shrink_name2() }; right: { page_coords[page_2_side()]["name_right"] - card_style.casting_cost_2.content_width } |
| _extra:_ type 2 | — | t67.3 l0 w0 h0 s— | — |  |
| _extra:_ text 2 | — | t— l— w38.13 h— s— | — | left: {page_coords[page_2_side()]["text"]}; top: { if page_style(page_2_side()) == "omen_double" then 5 + page_2_top() + to_int(back_chop_top()) + body_font_vertical() else page_2_top() + to_int(back_chop_top()) + body_font_vertical()} |
| _extra:_ casting cost 2 | — | t62.91 l— w— h4.4 s— | — | width: { max(30, card_style.casting_cost_2.content_width) + 5 }; right: {page_coords[page_2_side()]["cost"]} |

## flip  `magic-m15-flip.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.7 | 5.74 | 0.04 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 82 | — | — |  |
| title.heightPct | 4.4 | 4.4 | 0.00 |  |
| title.sizePct | 0.0427 | 0.0427 | 0.0000 |  |
| costSizePct | 0.04 | 0.04 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 31 | 30.98 | -0.02 |  |
| artSlot.leftPct | 7.7 | 7.73 | 0.03 |  |
| artSlot.widthPct | 84.3 | 84.27 | -0.03 |  |
| artSlot.heightPct | 35.2 | 35.18 | -0.02 |  |
| type.topPct | 25 | 25.05 | 0.05 |  |
| type.leftPct | 8.5 | 8.53 | 0.03 |  |
| type.widthPct | 68 | 82.67 | 14.67 |  |
| type.heightPct | 4.2 | 3.82 | -0.38 |  |
| type.sizePct | 0.0347 | 0.0347 | 0.0000 |  |
| rules.topPct | 11.3 | 11.28 | -0.02 |  |
| rules.leftPct | 7.7 | 7.73 | 0.03 |  |
| rules.widthPct | 84 | 83.73 | -0.27 |  |
| rules.heightPct | 12.5 | 12.62 | 0.12 |  |
| rules.sizePct | 0.029 | 0.0373 | 0.0083 |  |
| pt.topPct | 24.5 | 24.47 | -0.03 |  |
| pt.leftPct | 82.1 | 82.13 | 0.03 |  |
| pt.widthPct | 11.7 | 11.73 | 0.03 |  |
| pt.heightPct | 5.4 | 5.35 | -0.05 |  |
| pt.sizePct | 0.0347 | 0.0347 | 0.0000 |  |
| _extra:_ name 2 | — | t— l90.93 w— h4.4 s0.0427 | — | right: { 32 + card_style.casting_cost_2.content_width } |
| _extra:_ type 2 | — | t— l90.93 w82.67 h3.82 s0.0347 | — |  |
| _extra:_ text 2 | — | t— l— w83.73 h12.81 s0.0373 | — |  |
| _extra:_ pt 2 | — | t— l— w11.73 h5.35 s0.0347 | — |  |

## split  `magic-m15-planeshifted-split.mse-style` (523×375)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 7.4 | 7.6 | 0.20 |  |
| title.leftPct | 5.2 | 5.16 | -0.04 |  |
| title.widthPct | 41.4 | — | — |  |
| title.heightPct | 5.5 | 5.33 | -0.17 |  |
| title.sizePct | 0.0287 | 0.0287 | 0.0000 |  |
| costSizePct | 0.0344 | 0.0344 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 14.7 | 14.67 | -0.03 |  |
| artSlot.leftPct | 4.8 | 4.78 | -0.02 |  |
| artSlot.widthPct | 41.9 | 41.87 | -0.03 |  |
| artSlot.heightPct | 40.8 | 40.8 | 0.00 |  |
| type.topPct | 56.3 | 56.53 | 0.23 |  |
| type.leftPct | 5.2 | 5.16 | -0.04 |  |
| type.widthPct | 40 | — | — | { (if has_identity() then "204" else "217") - max(16,card_style.rarity.content_width) } |
| type.heightPct | 4.2 | 4 | -0.20 |  |
| type.sizePct | 0.02 | 0.0191 | -0.0009 |  |
| rules.topPct | 62.4 | 62.4 | 0.00 |  |
| rules.leftPct | 4.8 | 4.78 | -0.02 |  |
| rules.widthPct | 41.9 | 41.87 | -0.03 |  |
| rules.heightPct | 28.5 | 28.53 | 0.03 |  |
| rules.sizePct | 0.027 | 0.0268 | -0.0002 |  |
| pt.topPct | — | 88.53 | — |  |
| pt.leftPct | — | 39.01 | — |  |
| pt.widthPct | — | 8.22 | — |  |
| pt.heightPct | — | 5.6 | — |  |
| pt.sizePct | — | 0.0268 | — |  |
| footer.topPct | — | 94.4 | — |  |
| footer.leftPct | — | — | — | { 38 + card_style.set_code.content_width } |
| footer.widthPct | — | 26.77 | — |  |
| footer.heightPct | — | 1.87 | — |  |
| footer.sizePct | — | 0.0115 | — |  |
| _extra:_ name 2 | — | t7.6 l53.54 w— h5.33 s0.0287 | — | right: { 495 - card_style.casting_cost_2.content_width } |
| _extra:_ type 2 | — | t56.53 l53.54 w— h4 s0.0191 | — | width: { (if has_identity_2() then "204" else "217") - max(16,card_style.rarity.content_width) } |
| _extra:_ text 2 | — | t62.4 l53.15 w41.87 h28.53 s0.0268 | — |  |
| _extra:_ casting cost 2 | — | t7.47 l— w— h4.8 s0.0344 | — | width: { max(24, card_style.casting_cost_2.content_width) + 3 } |

## aftermath  `magic-m15-aftermath.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.7 | 5.74 | 0.04 |  |
| title.leftPct | 8.5 | 8.53 | 0.03 |  |
| title.widthPct | 82 | — | — |  |
| title.heightPct | 4.4 | 4.4 | 0.00 |  |
| title.sizePct | 0.04 | 0.04 | 0.0000 |  |
| costSizePct | 0.04 | 0.04 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 11.3 | 11.28 | -0.02 |  |
| artSlot.leftPct | 7.7 | 7.73 | 0.03 |  |
| artSlot.widthPct | 84.5 | 84.53 | 0.03 |  |
| artSlot.heightPct | 22.4 | 22.37 | -0.03 |  |
| type.topPct | 35.4 | 35.37 | -0.03 |  |
| type.leftPct | 8 | 8 | 0.00 |  |
| type.widthPct | 82.7 | 82.67 | -0.03 |  |
| type.heightPct | 3.8 | 3.82 | 0.02 |  |
| type.sizePct | 0.0347 | 0.0347 | 0.0000 |  |
| rules.topPct | 40.9 | 40.92 | 0.02 |  |
| rules.leftPct | 7.5 | 7.47 | -0.03 |  |
| rules.widthPct | 84.5 | 84.53 | 0.03 |  |
| rules.heightPct | 13 | 12.43 | -0.57 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | — | 50.1 | — |  |
| pt.leftPct | — | 80.8 | — |  |
| pt.widthPct | — | 11.2 | — |  |
| pt.heightPct | — | 4.02 | — |  |
| pt.sizePct | — | 0.0373 | — |  |
| _extra:_ name 2 | — | t56.41 l91.2 w— h4.02 s0.04 | — | width: { 181 - card_style.casting_cost_2.content_width - (if card.card_symbol_2 == "none" then 0 else 18) } |
| _extra:_ type 2 | — | t56.6 l52.8 w— h2.87 s0.0347 | — | width: { (if has_identity_2() then "204" else "217") - max(16,card_style.rarity.content_width) } |
| _extra:_ text 2 | — | t56.6 l44.53 w48.53 h26.77 s0.0373 | — |  |
| _extra:_ casting cost 2 | — | t— l91.2 w— h4.02 s0.048 | — | top: { 474 - max(24, card_style.casting_cost_2.content_width) }; width: { max(24, card_style.casting_cost_2.content_width) + 3 } |

## agclassic  `magic-agclassic.mse-style` (374×522)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 3.6 | 3.83 | 0.23 |  |
| title.leftPct | 12 | 9.89 | -2.11 |  |
| title.widthPct | 76 | — | — |  |
| title.heightPct | 4.8 | 4.41 | -0.39 |  |
| title.sizePct | 0.046 | 0.0428 | -0.0032 |  |
| costSizePct | 0.042 | 0.0428 | 0.0008 | symbol font of casting cost |
| artSlot.topPct | 9.5 | 9.2 | -0.30 |  |
| artSlot.leftPct | 10.6 | 10.7 | 0.10 |  |
| artSlot.widthPct | 78.8 | 78.61 | -0.19 |  |
| artSlot.heightPct | 44.8 | 45.4 | 0.60 |  |
| type.topPct | 55.8 | 55.94 | 0.14 |  |
| type.leftPct | 12 | 9.63 | -2.37 |  |
| type.widthPct | 76 | — | — |  |
| type.heightPct | 4.4 | 3.26 | -1.14 |  |
| type.sizePct | 0.03 | 0.0348 | 0.0048 |  |
| rules.topPct | 61.6 | 61.11 | -0.49 |  |
| rules.leftPct | 12.5 | 10.16 | -2.34 |  |
| rules.widthPct | 75 | 79.68 | 4.68 |  |
| rules.heightPct | 26.5 | 28.35 | 1.85 |  |
| rules.sizePct | 0.036 | 0.0374 | 0.0014 |  |
| pt.topPct | 88.4 | 91.19 | 2.79 |  |
| pt.leftPct | 74 | — | — |  |
| pt.widthPct | 19 | 14.97 | -4.03 |  |
| pt.heightPct | 5.8 | 4.6 | -1.20 |  |
| pt.sizePct | 0.04 | 0.0481 | 0.0081 |  |
| footer.topPct | 91 | 91.09 | 0.09 |  |
| footer.leftPct | 12 | 9.63 | -2.37 |  |
| footer.widthPct | 52 | 69.52 | 17.52 |  |
| footer.heightPct | 3 | 2.68 | -0.32 |  |
| footer.sizePct | 0.016 | 0.0281 | 0.0121 |  |

## alphaland  `magic-agclassic.mse-style` (374×522) — _land variant shares agclassic geometry_

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 3.6 | 3.83 | 0.23 |  |
| title.leftPct | 12 | 9.89 | -2.11 |  |
| title.widthPct | 76 | — | — |  |
| title.heightPct | 4.8 | 4.41 | -0.39 |  |
| title.sizePct | 0.046 | 0.0428 | -0.0032 |  |
| costSizePct | 0.042 | 0.0428 | 0.0008 | symbol font of casting cost |
| artSlot.topPct | 9.5 | 9.2 | -0.30 |  |
| artSlot.leftPct | 10.6 | 10.7 | 0.10 |  |
| artSlot.widthPct | 78.8 | 78.61 | -0.19 |  |
| artSlot.heightPct | 44.8 | 45.4 | 0.60 |  |
| type.topPct | 55.8 | 55.94 | 0.14 |  |
| type.leftPct | 12 | 9.63 | -2.37 |  |
| type.widthPct | 76 | — | — |  |
| type.heightPct | 4.4 | 3.26 | -1.14 |  |
| type.sizePct | 0.03 | 0.0348 | 0.0048 |  |
| rules.topPct | 61.6 | 61.11 | -0.49 |  |
| rules.leftPct | 12.5 | 10.16 | -2.34 |  |
| rules.widthPct | 75 | 79.68 | 4.68 |  |
| rules.heightPct | 26.5 | 28.35 | 1.85 |  |
| rules.sizePct | 0.036 | 0.0374 | 0.0014 |  |
| pt.topPct | 88.4 | 91.19 | 2.79 |  |
| pt.leftPct | 74 | — | — |  |
| pt.widthPct | 19 | 14.97 | -4.03 |  |
| pt.heightPct | 5.8 | 4.6 | -1.20 |  |
| pt.sizePct | 0.04 | 0.0481 | 0.0081 |  |
| footer.topPct | 91 | 91.09 | 0.09 |  |
| footer.leftPct | 12 | 9.63 | -2.37 |  |
| footer.widthPct | 52 | 69.52 | 17.52 |  |
| footer.heightPct | 3 | 2.68 | -0.32 |  |
| footer.sizePct | 0.016 | 0.0281 | 0.0121 |  |

## alphatoken  `magic-agclassic-token.mse-style` (374×522)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 3.2 | 3.45 | 0.25 |  |
| title.leftPct | 12 | 5.35 | -6.65 |  |
| title.widthPct | 76 | 89.3 | 13.30 |  |
| title.heightPct | 5.2 | 4.41 | -0.79 |  |
| title.sizePct | 0.044 | 0.0535 | 0.0095 |  |
| artSlot.topPct | 9 | 8.81 | -0.19 |  |
| artSlot.leftPct | 10 | 10.7 | 0.70 |  |
| artSlot.widthPct | 80 | 78.61 | -1.39 |  |
| artSlot.heightPct | 52.5 | 52.87 | 0.37 |  |
| type.topPct | 70.5 | 62.64 | -7.86 |  |
| type.leftPct | 18 | 14.71 | -3.29 |  |
| type.widthPct | 64 | — | — |  |
| type.heightPct | 7 | 3.26 | -3.74 |  |
| type.sizePct | 0.03 | 0.0348 | 0.0048 |  |
| rules.topPct | 49 | 67.82 | 18.82 |  |
| rules.leftPct | 12 | 15.24 | 3.24 |  |
| rules.widthPct | 76 | 69.52 | -6.48 |  |
| rules.heightPct | 11 | 21.65 | 10.65 |  |
| rules.sizePct | 0.03 | 0.0374 | 0.0074 |  |
| pt.topPct | 82.5 | 91.19 | 8.69 |  |
| pt.leftPct | 75 | — | — |  |
| pt.widthPct | 19 | 14.97 | -4.03 |  |
| pt.heightPct | 6.5 | 4.6 | -1.90 |  |
| pt.sizePct | 0.04 | 0.0481 | 0.0081 |  |
| footer.topPct | 96.5 | 91.09 | -5.41 |  |
| footer.leftPct | 10 | 14.71 | 4.71 |  |
| footer.widthPct | 80 | 59.36 | -20.64 |  |
| footer.heightPct | 3 | 2.68 | -0.32 |  |
| footer.sizePct | 0.015 | 0.0281 | 0.0131 |  |

## retro  `magic-old.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.2 | 4.59 | 0.39 |  |
| title.leftPct | 11 | 11.2 | 0.20 |  |
| title.widthPct | 78 | — | — |  |
| title.heightPct | 4.6 | 4.4 | -0.20 |  |
| title.sizePct | 0.044 | 0.0413 | -0.0027 |  |
| costSizePct | 0.04 | 0.0427 | 0.0027 | symbol font of casting cost |
| artSlot.topPct | 9.6 | 9.75 | 0.15 |  |
| artSlot.leftPct | 11.7 | 12 | 0.30 |  |
| artSlot.widthPct | 76.6 | 76.27 | -0.33 |  |
| artSlot.heightPct | 44.8 | 44.55 | -0.25 |  |
| type.topPct | 55.4 | 55.64 | 0.24 |  |
| type.leftPct | 10.4 | 10.4 | 0.00 |  |
| type.widthPct | 74 | — | — | { 298 - max(22,card_style.rarity.content_width) } |
| type.heightPct | 3.9 | 3.82 | -0.08 |  |
| type.sizePct | 0.03 | 0.032 | 0.0020 |  |
| rules.topPct | 60.6 | 60.8 | 0.20 |  |
| rules.leftPct | 11.5 | 11.47 | -0.03 |  |
| rules.widthPct | 77 | 77.07 | 0.07 |  |
| rules.heightPct | 27.2 | 27.34 | 0.14 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.5 | 89.87 | 0.37 |  |
| pt.leftPct | 77.5 | 78.67 | 1.17 |  |
| pt.widthPct | 14 | 12.53 | -1.47 |  |
| pt.heightPct | 5.6 | 5.16 | -0.44 |  |
| pt.sizePct | 0.042 | 0.0453 | 0.0033 |  |
| footer.topPct | 95.3 | 89.87 | -5.43 |  |
| footer.leftPct | 11 | 10.67 | -0.33 |  |
| footer.widthPct | 78 | 79.2 | 1.20 |  |
| footer.heightPct | 2.6 | 3.06 | 0.46 |  |
| footer.sizePct | 0.015 | 0.0267 | 0.0117 |  |

## retroland  `magic-old.mse-style` (375×523) — _land variant shares magic-old geometry_

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 4.2 | 4.59 | 0.39 |  |
| title.leftPct | 11 | 11.2 | 0.20 |  |
| title.widthPct | 78 | — | — |  |
| title.heightPct | 4.6 | 4.4 | -0.20 |  |
| title.sizePct | 0.044 | 0.0413 | -0.0027 |  |
| costSizePct | 0.04 | 0.0427 | 0.0027 | symbol font of casting cost |
| artSlot.topPct | 9.6 | 9.75 | 0.15 |  |
| artSlot.leftPct | 11.7 | 12 | 0.30 |  |
| artSlot.widthPct | 76.6 | 76.27 | -0.33 |  |
| artSlot.heightPct | 44.8 | 44.55 | -0.25 |  |
| type.topPct | 55.4 | 55.64 | 0.24 |  |
| type.leftPct | 10.4 | 10.4 | 0.00 |  |
| type.widthPct | 74 | — | — | { 298 - max(22,card_style.rarity.content_width) } |
| type.heightPct | 3.9 | 3.82 | -0.08 |  |
| type.sizePct | 0.03 | 0.032 | 0.0020 |  |
| rules.topPct | 60.6 | 60.8 | 0.20 |  |
| rules.leftPct | 11.5 | 11.47 | -0.03 |  |
| rules.widthPct | 77 | 77.07 | 0.07 |  |
| rules.heightPct | 27.2 | 27.34 | 0.14 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 89.5 | 89.87 | 0.37 |  |
| pt.leftPct | 77.5 | 78.67 | 1.17 |  |
| pt.widthPct | 14 | 12.53 | -1.47 |  |
| pt.heightPct | 5.6 | 5.16 | -0.44 |  |
| pt.sizePct | 0.042 | 0.0453 | 0.0033 |  |
| footer.topPct | 95.3 | 89.87 | -5.43 |  |
| footer.leftPct | 11 | 10.67 | -0.33 |  |
| footer.widthPct | 78 | 79.2 | 1.20 |  |
| footer.heightPct | 2.6 | 3.06 | 0.46 |  |
| footer.sizePct | 0.015 | 0.0267 | 0.0117 |  |

## modern  `magic-new.mse-style` (375×523)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.5 | 5.74 | 0.24 |  |
| title.leftPct | 8.8 | 8.53 | -0.27 |  |
| title.widthPct | 78 | — | — |  |
| title.heightPct | 4.4 | 4.4 | 0.00 |  |
| title.sizePct | 0.044 | 0.0453 | 0.0013 |  |
| costSizePct | 0.04 | 0.04 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 11.6 | 11.85 | 0.25 |  |
| artSlot.leftPct | 8.3 | 8.53 | 0.23 |  |
| artSlot.widthPct | 83.2 | 82.93 | -0.27 |  |
| artSlot.heightPct | 43.8 | 43.59 | -0.21 |  |
| type.topPct | 56.95 | 56.98 | 0.03 |  |
| type.leftPct | 9 | 9.33 | 0.33 |  |
| type.widthPct | 74 | — | — | { (if has_identity() then "288" else "308") - max(22,card_style.rarity.content_width) } |
| type.heightPct | 3.9 | 3.82 | -0.08 |  |
| type.sizePct | 0.0347 | 0.0373 | 0.0026 |  |
| rules.topPct | 62.5 | 62.72 | 0.22 |  |
| rules.leftPct | 8.3 | 8.27 | -0.03 |  |
| rules.widthPct | 83 | 82.93 | -0.07 |  |
| rules.heightPct | 27 | 27.15 | 0.15 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 87.3 | 89.1 | 1.80 |  |
| pt.leftPct | 73.3 | 75.73 | 2.43 |  |
| pt.widthPct | 21 | 16 | -5.00 |  |
| pt.heightPct | 6.8 | 5.35 | -1.45 |  |
| pt.sizePct | 0.044 | 0.0453 | 0.0013 |  |
| footer.topPct | 91.4 | 91.4 | 0.00 |  |
| footer.leftPct | 14 | 14.93 | 0.93 |  |
| footer.widthPct | 58 | 57.87 | -0.13 |  |
| footer.heightPct | 2.6 | 3.06 | 0.46 |  |
| footer.sizePct | 0.015 | 0.0267 | 0.0117 |  |

## modernland  `magic-new.mse-style` (375×523) — _land variant shares magic-new geometry_

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| title.topPct | 5.5 | 5.74 | 0.24 |  |
| title.leftPct | 8.8 | 8.53 | -0.27 |  |
| title.widthPct | 78 | — | — |  |
| title.heightPct | 4.4 | 4.4 | 0.00 |  |
| title.sizePct | 0.044 | 0.0453 | 0.0013 |  |
| costSizePct | 0.04 | 0.04 | 0.0000 | symbol font of casting cost |
| artSlot.topPct | 11.6 | 11.85 | 0.25 |  |
| artSlot.leftPct | 8.3 | 8.53 | 0.23 |  |
| artSlot.widthPct | 83.2 | 82.93 | -0.27 |  |
| artSlot.heightPct | 43.8 | 43.59 | -0.21 |  |
| type.topPct | 56.95 | 56.98 | 0.03 |  |
| type.leftPct | 9 | 9.33 | 0.33 |  |
| type.widthPct | 74 | — | — | { (if has_identity() then "288" else "308") - max(22,card_style.rarity.content_width) } |
| type.heightPct | 3.9 | 3.82 | -0.08 |  |
| type.sizePct | 0.0347 | 0.0373 | 0.0026 |  |
| rules.topPct | 62.5 | 62.72 | 0.22 |  |
| rules.leftPct | 8.3 | 8.27 | -0.03 |  |
| rules.widthPct | 83 | 82.93 | -0.07 |  |
| rules.heightPct | 27 | 27.15 | 0.15 |  |
| rules.sizePct | 0.0373 | 0.0373 | 0.0000 |  |
| pt.topPct | 87.3 | 89.1 | 1.80 |  |
| pt.leftPct | 73.3 | 75.73 | 2.43 |  |
| pt.widthPct | 21 | 16 | -5.00 |  |
| pt.heightPct | 6.8 | 5.35 | -1.45 |  |
| pt.sizePct | 0.044 | 0.0453 | 0.0013 |  |
| footer.topPct | 91.4 | 91.4 | 0.00 |  |
| footer.leftPct | 14 | 14.93 | 0.93 |  |
| footer.widthPct | 58 | 57.87 | -0.13 |  |
| footer.heightPct | 2.6 | 3.06 | 0.46 |  |
| footer.sizePct | 0.015 | 0.0267 | 0.0117 |  |

## lotr  `magic-m15-showcase-lotr.mse-style` (646×902)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 13 | 11.09 | -1.91 |  |
| artSlot.leftPct | 14 | 9.6 | -4.40 |  |
| artSlot.widthPct | 72 | 81.11 | 9.11 |  |
| artSlot.heightPct | 45 | 44.68 | -0.32 |  |
| rules.topPct | 66 | — | — | { 570 + chop_top() + body_font_vertical() } |
| rules.leftPct | 8.5 | 7.74 | -0.76 |  |
| rules.widthPct | 83 | 84.21 | 1.21 |  |
| rules.heightPct | 26 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 86.5 | — | — | { 809 + pt_font_vertical() } |
| pt.leftPct | 71 | 80.03 | 9.03 |  |
| pt.widthPct | 23 | 12.38 | -10.62 |  |
| pt.heightPct | 7.5 | 4.21 | -3.29 |  |
| pt.sizePct | 0.043 | — | — |  |

## lotrscroll  `magic-m15-showcase-lotr-scroll.mse-style` (646×902)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 11.5 | 11.09 | -0.41 |  |
| artSlot.leftPct | 8 | 7.59 | -0.41 |  |
| artSlot.widthPct | 84 | 84.83 | 0.83 |  |
| artSlot.heightPct | 45 | 44.46 | -0.54 |  |
| rules.topPct | 65.5 | — | — | { 570 + chop_top() + body_font_vertical() } |
| rules.leftPct | 8.5 | 7.74 | -0.76 |  |
| rules.widthPct | 83 | — | — |  |
| rules.heightPct | 21 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 86.5 | — | — | { 810 + pt_font_vertical() } |
| pt.leftPct | 71 | 79.88 | 8.88 |  |
| pt.widthPct | 23 | 12.54 | -10.46 |  |
| pt.heightPct | 7.5 | 4.1 | -3.40 |  |
| pt.sizePct | 0.043 | — | — |  |

## avatar  `magic-m15-showcase-avatar-elemental.mse-style` (744×1039)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 2.5 | — | — | { art_top() } |
| artSlot.leftPct | 6 | — | — | { art_left() } |
| artSlot.widthPct | 88 | — | — | { art_width() } |
| artSlot.heightPct | 54 | — | — |  |
| rules.topPct | 67.6 | — | — | { 660 + chop_top() + body_font_vertical() } |
| rules.leftPct | 8 | 8.6 | 0.60 |  |
| rules.widthPct | 84 | — | — |  |
| rules.heightPct | 24.5 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 87.2 | — | — | { 937 + pt_font_vertical() } |
| pt.leftPct | 71.5 | 79.44 | 7.94 |  |
| pt.widthPct | 23 | 13.44 | -9.56 |  |
| pt.heightPct | 7 | 3.46 | -3.54 |  |
| pt.sizePct | 0.04 | — | — |  |

## bloomburrow  `magic-m15-showcase-bloomburrow-woodland.mse-style` (744×1039)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 2.5 | 11.07 | 8.57 |  |
| artSlot.leftPct | 6 | — | — | { 0 } |
| artSlot.widthPct | 88 | — | — | { stylesheet.card_width } |
| artSlot.heightPct | 54 | 45.24 | -8.76 |  |
| rules.topPct | 67.6 | 0 | -67.60 |  |
| rules.leftPct | 8 | 8.74 | 0.74 |  |
| rules.widthPct | 84 | 82.53 | -1.47 |  |
| rules.heightPct | 24.5 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 87.2 | — | — | { 931 + pt_font_vertical() } |
| pt.leftPct | 71.5 | 79.84 | 8.34 |  |
| pt.widthPct | 23 | 12.77 | -10.23 |  |
| pt.heightPct | 7 | 4.43 | -2.57 |  |
| pt.sizePct | 0.04 | — | — |  |

## bloomanime  `magic-m15-showcase-bloomburrow-borderless-anime.mse-style` (744×1039)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 2.5 | — | — | { 0 } |
| artSlot.leftPct | 3.5 | — | — | { 0 } |
| artSlot.widthPct | 93 | — | — | { stylesheet.card_width } |
| artSlot.heightPct | 92 | 91.63 | -0.37 |  |
| rules.topPct | 62 | 0 | -62.00 |  |
| rules.leftPct | 7 | 8.74 | 1.74 |  |
| rules.widthPct | 86 | 82.53 | -3.47 |  |
| rules.heightPct | 28 | — | — |  |
| rules.sizePct | 0.032 | — | — |  |
| pt.topPct | 89 | — | — | { 932 + pt_font_vertical() } |
| pt.leftPct | 73 | 79.97 | 6.97 |  |
| pt.widthPct | 21 | 11.96 | -9.04 |  |
| pt.heightPct | 7 | 4.33 | -2.67 |  |
| pt.sizePct | 0.04 | — | — |  |

## tarkirdragon  `magic-m15-showcase-tarkir-dragon-wing.mse-style` (646×902)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 12 | 11.09 | -0.91 |  |
| artSlot.leftPct | 9 | 8.82 | -0.18 |  |
| artSlot.widthPct | 82 | 82.2 | 0.20 |  |
| artSlot.heightPct | 46 | 44.12 | -1.88 |  |
| rules.topPct | 66 | — | — | { 566 + chop_top() + body_font_vertical() } |
| rules.leftPct | 9 | 8.05 | -0.95 |  |
| rules.widthPct | 82 | 83.9 | 1.90 |  |
| rules.heightPct | 26 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 87 | — | — | { 810 + pt_font_vertical() } |
| pt.leftPct | 71 | 79.88 | 8.88 |  |
| pt.widthPct | 23 | 12.38 | -10.62 |  |
| pt.heightPct | 7.5 | 3.99 | -3.51 |  |
| pt.sizePct | 0.043 | — | — |  |

## tarkirdraconic  `magic-m15-showcase-tarkir-draconic.mse-style` (646×902)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 12 | — | — | { art_top() } |
| artSlot.leftPct | 9 | — | — | { art_left() } |
| artSlot.widthPct | 82 | — | — | { art_width() } |
| artSlot.heightPct | 46 | — | — | { art_height() } |
| rules.topPct | 66 | 0 | -66.00 |  |
| rules.leftPct | 9 | 8.82 | -0.18 |  |
| rules.widthPct | 82 | — | — |  |
| rules.heightPct | 26 | — | — |  |
| rules.sizePct | 0.033 | — | — |  |
| pt.topPct | 87 | — | — | { 811 + pt_font_vertical() } |
| pt.leftPct | 71 | 79.88 | 8.88 |  |
| pt.widthPct | 23 | 12.69 | -10.31 |  |
| pt.heightPct | 7.5 | 3.77 | -3.73 |  |
| pt.sizePct | 0.043 | — | — |  |

## tarkirghostfire  `magic-m15-showcase-tarkir-ghostfire-walker.mse-style` (744×1039)

| field | current | MSE | Δ (MSE−cur) | notes |
|---|---|---|---|---|
| artSlot.topPct | 2.5 | — | — | { art_top() } |
| artSlot.leftPct | 3.5 | — | — | { art_left() } |
| artSlot.widthPct | 93 | — | — | { art_width() } |
| artSlot.heightPct | 92 | — | — |  |
| rules.topPct | 62 | — | — | { 610 - move_typeline() + chop_top() + body_font_vertical() } |
| rules.leftPct | 7 | 8.87 | 1.87 |  |
| rules.widthPct | 86 | 82.26 | -3.74 |  |
| rules.heightPct | 28 | — | — |  |
| rules.sizePct | 0.032 | — | — |  |
