// ---------------------------------------------------------------------------
// The station frame (TODO 4.27a) — what 30 printed cards measured, as DATA,
// and the recipe's parameters. No scan is read by any build: these numbers
// are the record (as scripts/lib/seventh-1997.mjs holds the 1997 frame's).
//
// Read 2026-10-13: every bordered station printing (EOE's 22 Spacecraft and
// 5 Planets, EOC #7 / #14, TRK #273) and 16 plain M15 cards of EOE as
// controls; Scryfall PNG scans (745 x 1040) resampled to 1500 x 2100 with
// lanczos3. Every figure is HD px on a 1500 x 2100 card.
//
// THE MASTERS ARE PIPGLYPH'S OWN DERIVATION — neither Card Conjurer (its
// fork ends 2024-06: no station pack) nor MSE has one at print size:
//   m15station/<w u b r g m c>     from the published m15artifact/<key>
//   m15stationland/<w u b r g>     from the published m15land/<key>
// with two cuts (STATION_RECIPE): the frame FIELD to alpha 0 — its shape is
// where m15/<k> and m15artifact/<k> differ, the two masters painting the
// same bars, pinlines and boxes over two different fields — and the text
// box's interior to alpha x 0.68 (owner round 54, decision 2; the published
// box colour x 0.70 lands 1-11 levels above print's measured tone on all
// seven keys). lib/cards/station.ts holds the constants the renderers read.
// ---------------------------------------------------------------------------

export const STATION_RECIPE = {
  templates: {
    m15station: { from: "m15artifact", keys: ["w", "u", "b", "r", "g", "m", "c"] },
    // Printed Planets are w u b r g (EOE #250-260). "m" and "c" are built too
    // so that no colour of a land ever resolves to a missing master (every
    // template has every key); with no print to verify against they stay
    // unticked, so nobody is offered them.
    m15stationland: { from: "m15land", keys: ["w", "u", "b", "r", "g", "m", "c"] },
    // The extended-art and borderless DRESSES of the Spacecraft frame (TODO
    // 4.27a step 2, PR 4; scripts/lib/station-dresses-2025.mjs holds what
    // their 15 printings measured). The extended-art masters are Card
    // Conjurer's accurate pack — M15's pixels byte for byte from row 1320
    // down, the type bar the pack's BLACK one — so the same two cuts apply
    // unchanged. A colourless Spacecraft wears the pack's silver ARTIFACT
    // frame (`a`: EOE #351 / #354 / #355, TRK #481).
    extendedartstation: { from: "extendedart", keys: ["w", "u", "b", "r", "g", "m", "c"], sourceKeys: { c: "a" } },
    // …and BORDERLESS (EOC #1 / #2): the published borderless artifact
    // masters — Card Conjurer's borderless pack: no field, translucent bars
    // with thick rims floating on the art, the black bottom bar and its side
    // fins, the crowned `<key>-legendary` twins — whose dark translucent
    // text-box interior is swapped for the station box: m15station/<key>'s
    // own pixels there (M15's box paper at × 0.68). Nothing else moves.
    m15borderlessstation: { from: "m15borderlessartifact", keys: ["w", "u", "b", "r", "g", "m", "c"], boxFrom: "m15station", crownTwins: true },
  },
  /** The field: pixels where m15/<k> and m15artifact/<k> differ by more than
   *  this (sum of |dR| + |dG| + |dB| + |dA|), union over these keys, 1 px
   *  holes closed. Bounding box on the 2026-10-13 masters: 58..1444 x 59..1856. */
  field: { keys: ["w", "u", "b", "r", "g", "m"], threshold: 12, expectBox: { x0: 58, x1: 1444, y0: 59, y1: 1856 } },
  /** The box interior, inside the pinline (read off the blue master). */
  box: { left: 110, right: 1390, top: 1314, bottom: 1937 },
  washAlpha: 0.68,
};

export const STATION_MEASURED = {
  "measured": "2026-10-13, 30 bordered station printings (EOE 22 Spacecraft + 5 Planets, EOC #7 / #14, TRK #273) + 16 M15 controls of EOE; Scryfall PNG 745 x 1040 resampled to 1500 x 2100 (lanczos3). HD px.",
  "geometry": {
    "borderInner": {
      "left": 60,
      "right": 1440,
      "top": 61
    },
    "artWindowBlackLine": {
      "left": 112,
      "right": 1386
    },
    "typeBarBottomBlack": 1299,
    "boxPinline": {
      "top": [
        1303,
        1311
      ],
      "left": [
        99,
        111
      ],
      "right": [
        1388,
        1398
      ],
      "bottom": [
        1936,
        1945
      ]
    },
    "boxInterior": {
      "left": 112,
      "right": 1388,
      "top": 1312,
      "bottom": 1935
    },
    "boxTopShadowRows": [
      1312,
      1321
    ],
    "sameAsM15": "title bar, type bar, pinlines, art window, border: equal to the EOE M15 controls within 0-2 levels and 0-1 px"
  },
  "bands": {
    "boundaries": {
      "eoc-7": [
        1515,
        1674
      ],
      "eoc-14": [
        1510,
        1636
      ],
      "eoe-25": [
        1591,
        1759
      ],
      "eoe-32": [
        1757
      ],
      "eoe-35": [
        1683
      ],
      "eoe-43": [
        1759
      ],
      "eoe-76": [
        1703
      ],
      "eoe-81": [
        1513,
        1757
      ],
      "eoe-85": [
        1756
      ],
      "eoe-99": [
        1520,
        1671
      ],
      "eoe-101": [
        1756
      ],
      "eoe-117": [
        1756
      ],
      "eoe-131": [
        1717
      ],
      "eoe-136": [
        1758
      ],
      "eoe-167": [
        1756
      ],
      "eoe-171": [
        1756
      ],
      "eoe-194": [
        1756
      ],
      "eoe-208": [
        1601
      ],
      "eoe-219": [
        1678
      ],
      "eoe-238": [
        1538,
        1757
      ],
      "eoe-241": [
        1620
      ],
      "eoe-242": [
        1760
      ],
      "eoe-244": [
        1758
      ],
      "eoe-249": [
        1666
      ],
      "eoe-250": [
        1688
      ],
      "eoe-253": [
        1756
      ],
      "eoe-255": [
        1678
      ],
      "eoe-259": [
        1678
      ],
      "eoe-260": [
        1757
      ],
      "trk-273": [
        1762
      ]
    },
    "unsure": [
      "eoc-7 (first)",
      "eoe-242",
      "eoe-244",
      "trk-273"
    ],
    "edge": "a hard step (8 rows wide through a +-4 px window on a 2x upsampled scan); no line, no highlight",
    "lastBandOneLine": {
      "top": [
        1755,
        1760
      ],
      "bottom": 1935,
      "height": 176
    },
    "upperTierOneLine": {
      "height": 168,
      "from": "eoe-25"
    },
    "tierTextLeft": 180,
    "topTextLeft": 130
  },
  "wash": {
    "model": "inside = (1 - A) * picture + A * T, the picture read just outside the pinline",
    "transmission": {
      "0": {
        "withinSlope": 0.263,
        "r2": 0.58,
        "rows": 20832,
        "cards": 30,
        "betweenSlope": 0.319,
        "betweenPoints": 24
      },
      "1": {
        "withinSlope": 0.303,
        "r2": 0.21,
        "rows": 2863,
        "cards": 16,
        "betweenSlope": 0.342,
        "betweenPoints": 6
      },
      "2": {
        "withinSlope": 0.146,
        "r2": 0.05,
        "rows": 469,
        "cards": 3,
        "betweenSlope": null,
        "betweenPoints": 0
      }
    },
    "used": {
      "0": 0.32,
      "1": 0.26,
      "2": 0.16
    },
    "perKey": {
      "b": {
        "pinline": [
          63,
          64,
          61
        ],
        "bands": {
          "0": {
            "n": 3,
            "alpha": 0.68,
            "alphaTimesTint": [
              156.2,
              156.2,
              156.9
            ],
            "tint": [
              230,
              230,
              231
            ],
            "spreadAcrossCards": [
              11.4,
              8.8,
              8.1
            ],
            "from": [
              "eoe-99",
              "eoe-101",
              "eoe-117"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              135.4,
              137.6,
              129.2
            ],
            "tint": [
              183,
              186,
              175
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-99"
            ]
          },
          "2": {
            "n": 1,
            "alpha": 0.84,
            "alphaTimesTint": [
              134,
              130.8,
              121.6
            ],
            "tint": [
              160,
              156,
              145
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-99"
            ]
          }
        }
      },
      "c": {
        "pinline": [
          223,
          223,
          227
        ],
        "bands": {
          "0": {
            "n": 6,
            "alpha": 0.68,
            "alphaTimesTint": [
              143,
              149,
              153.2
            ],
            "tint": [
              210,
              219,
              225
            ],
            "spreadAcrossCards": [
              7.5,
              4.6,
              5.6
            ],
            "from": [
              "eoe-238",
              "eoe-241",
              "eoe-242",
              "eoe-244",
              "eoe-249",
              "trk-273"
            ]
          },
          "1": {
            "n": 3,
            "alpha": 0.74,
            "alphaTimesTint": [
              136.9,
              148.8,
              155.7
            ],
            "tint": [
              185,
              201,
              210
            ],
            "spreadAcrossCards": [
              5.7,
              2.6,
              0.7
            ],
            "from": [
              "eoe-238",
              "eoe-241",
              "eoe-249"
            ]
          },
          "2": null
        }
      },
      "g": {
        "pinline": [
          15,
          117,
          69
        ],
        "bands": {
          "0": {
            "n": 4,
            "alpha": 0.68,
            "alphaTimesTint": [
              149.6,
              159.7,
              153.5
            ],
            "tint": [
              220,
              235,
              226
            ],
            "spreadAcrossCards": [
              6,
              7,
              5
            ],
            "from": [
              "eoc-14",
              "eoe-171",
              "eoe-194",
              "eoe-208"
            ]
          },
          "1": {
            "n": 2,
            "alpha": 0.74,
            "alphaTimesTint": [
              121.2,
              151.3,
              132.6
            ],
            "tint": [
              164,
              204,
              179
            ],
            "spreadAcrossCards": [
              2.4,
              2.6,
              2.6
            ],
            "from": [
              "eoc-14",
              "eoe-208"
            ]
          },
          "2": {
            "n": 1,
            "alpha": 0.84,
            "alphaTimesTint": [
              79.6,
              131.6,
              106.5
            ],
            "tint": [
              95,
              157,
              127
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoc-14"
            ]
          }
        }
      },
      "land-b": {
        "pinline": [
          65,
          64,
          66
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              160.5,
              159.7,
              157.1
            ],
            "tint": [
              236,
              235,
              231
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-259"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              145.4,
              144.7,
              138.9
            ],
            "tint": [
              196,
              196,
              188
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-259"
            ]
          },
          "2": null
        }
      },
      "land-g": {
        "pinline": [
          12,
          116,
          75
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              146,
              154.1,
              148.7
            ],
            "tint": [
              215,
              227,
              219
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-253"
            ]
          },
          "1": null,
          "2": null
        }
      },
      "land-r": {
        "pinline": [
          223,
          79,
          57
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              164.3,
              150.8,
              146.2
            ],
            "tint": [
              242,
              222,
              215
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-255"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              181,
              134,
              126.9
            ],
            "tint": [
              245,
              181,
              171
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-255"
            ]
          },
          "2": null
        }
      },
      "land-u": {
        "pinline": [
          6,
          117,
          175
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              147,
              156.4,
              164.4
            ],
            "tint": [
              216,
              230,
              242
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-260"
            ]
          },
          "1": null,
          "2": null
        }
      },
      "land-w": {
        "pinline": [
          244,
          243,
          232
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              169,
              163.8,
              153.3
            ],
            "tint": [
              249,
              241,
              225
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-250"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              155.1,
              154.5,
              145.1
            ],
            "tint": [
              210,
              209,
              196
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-250"
            ]
          },
          "2": null
        }
      },
      "m": {
        "pinline": [
          229,
          211,
          122
        ],
        "bands": {
          "0": {
            "n": 1,
            "alpha": 0.68,
            "alphaTimesTint": [
              162.1,
              155,
              147.2
            ],
            "tint": [
              238,
              228,
              216
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-219"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              158.4,
              151,
              123.1
            ],
            "tint": [
              214,
              204,
              166
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-219"
            ]
          },
          "2": null
        }
      },
      "r": {
        "pinline": [
          227,
          75,
          57
        ],
        "bands": {
          "0": {
            "n": 3,
            "alpha": 0.68,
            "alphaTimesTint": [
              165.4,
              154.1,
              146.3
            ],
            "tint": [
              243,
              227,
              215
            ],
            "spreadAcrossCards": [
              4.1,
              3.1,
              5
            ],
            "from": [
              "eoe-131",
              "eoe-136",
              "eoe-167"
            ]
          },
          "1": {
            "n": 1,
            "alpha": 0.74,
            "alphaTimesTint": [
              185.1,
              134.8,
              124.7
            ],
            "tint": [
              250,
              182,
              169
            ],
            "spreadAcrossCards": [
              0,
              0,
              0
            ],
            "from": [
              "eoe-131"
            ]
          },
          "2": null
        }
      },
      "u": {
        "pinline": [
          5,
          119,
          180
        ],
        "bands": {
          "0": {
            "n": 4,
            "alpha": 0.68,
            "alphaTimesTint": [
              149.9,
              157.2,
              167.1
            ],
            "tint": [
              220,
              231,
              246
            ],
            "spreadAcrossCards": [
              5.8,
              4.1,
              7
            ],
            "from": [
              "eoc-7",
              "eoe-76",
              "eoe-81",
              "eoe-85"
            ]
          },
          "1": {
            "n": 2,
            "alpha": 0.74,
            "alphaTimesTint": [
              117.4,
              151.5,
              173.5
            ],
            "tint": [
              159,
              205,
              234
            ],
            "spreadAcrossCards": [
              1.5,
              0.3,
              3
            ],
            "from": [
              "eoe-76",
              "eoe-81"
            ]
          },
          "2": null
        }
      },
      "w": {
        "pinline": [
          243,
          243,
          237
        ],
        "bands": {
          "0": {
            "n": 4,
            "alpha": 0.68,
            "alphaTimesTint": [
              167.8,
              165.2,
              160.4
            ],
            "tint": [
              247,
              243,
              236
            ],
            "spreadAcrossCards": [
              2.7,
              2.1,
              2.9
            ],
            "from": [
              "eoe-25",
              "eoe-32",
              "eoe-35",
              "eoe-43"
            ]
          },
          "1": {
            "n": 2,
            "alpha": 0.74,
            "alphaTimesTint": [
              152.9,
              152.9,
              149.3
            ],
            "tint": [
              207,
              207,
              202
            ],
            "spreadAcrossCards": [
              6.5,
              7.1,
              4.5
            ],
            "from": [
              "eoe-25",
              "eoe-35"
            ]
          },
          "2": null
        }
      }
    },
    "recipeCheck": {
      "w": {
        "masterBox": [
          247,
          246,
          238
        ],
        "at70": [
          173,
          172,
          167
        ],
        "measuredAlphaTimesTint": [
          167.8,
          165.2,
          160.4
        ],
        "diff": [
          5,
          7,
          6
        ]
      },
      "u": {
        "masterBox": [
          222,
          235,
          246
        ],
        "at70": [
          155,
          165,
          172
        ],
        "measuredAlphaTimesTint": [
          149.9,
          157.2,
          167.1
        ],
        "diff": [
          5,
          7,
          5
        ]
      },
      "b": {
        "masterBox": [
          235,
          233,
          231
        ],
        "at70": [
          165,
          163,
          162
        ],
        "measuredAlphaTimesTint": [
          156.2,
          156.2,
          156.9
        ],
        "diff": [
          8,
          7,
          5
        ]
      },
      "r": {
        "masterBox": [
          244,
          225,
          214
        ],
        "at70": [
          171,
          158,
          150
        ],
        "measuredAlphaTimesTint": [
          165.4,
          154.1,
          146.3
        ],
        "diff": [
          5,
          3,
          3
        ]
      },
      "g": {
        "masterBox": [
          218,
          230,
          221
        ],
        "at70": [
          153,
          161,
          155
        ],
        "measuredAlphaTimesTint": [
          149.6,
          159.7,
          153.5
        ],
        "diff": [
          3,
          1,
          1
        ]
      },
      "m": {
        "masterBox": [
          246,
          237,
          213
        ],
        "at70": [
          172,
          166,
          149
        ],
        "measuredAlphaTimesTint": [
          162.1,
          155,
          147.2
        ],
        "diff": [
          10,
          11,
          2
        ]
      },
      "c": {
        "masterBox": [
          216,
          224,
          228
        ],
        "at70": [
          151,
          157,
          160
        ],
        "measuredAlphaTimesTint": [
          143,
          149,
          153.2
        ],
        "diff": [
          8,
          8,
          6
        ]
      }
    },
    "tierModel": {
      "note": "tier bands fit ONE colour per key over the top wash at 0.25 (tier 1) and 0.57 (tier 2); a third tier (0.78) is extrapolated - print has none",
      "opacity": [
        0.25,
        0.57,
        0.78
      ]
    }
  },
  "badge": {
    "n": 31,
    "cx": 100,
    "cxRange": [
      99.5,
      101
    ],
    "rFill": 50.1,
    "rFillRange": [
      49.4,
      50.9
    ],
    "ringOuterR": 60,
    "numeralCapPx": 42,
    "numeralWidthPx": {
      "oneDigit": [
        52,
        59
      ],
      "12+": 76,
      "10+ / 20+": [
        80,
        87
      ]
    },
    "cy": "its band's centre (within 1 px on 20 of 20 one-line last bands: 1845.5-1846.5 for a band 1757-1935)",
    "fillLuma": [
      40,
      47
    ],
    "ring": "the pinline colour, 10 px, brighter towards its outer third"
  },
  "plate": {
    "n": 21,
    "fill": {
      "w": 203,
      "h": 84,
      "luma": 40.4
    },
    "outer": {
      "w": 231,
      "h": 112,
      "x": [
        1190,
        1420
      ]
    },
    "rim": 14,
    "cx": 1305.5,
    "cxRange": [
      1305.5,
      1306.5
    ],
    "cy": "its band's centre (1846 for a band 1757-1935; 1769 for 1601-1935; 1810 for 1683-1935)",
    "digitHeightPx": 52,
    "digitHeightRange": [
      46,
      53
    ],
    "digitInkMaxLuma": 255,
    "ends": "arcs, sagitta about 15 px over the 112 px height"
  },
  "oursVsPrint": {
    "eoe-25": {
      "textPx": 60,
      "ours": [
        1592,
        1760
      ],
      "print": [
        1591,
        1759
      ],
      "delta": [
        1,
        1
      ]
    },
    "eoe-81": {
      "textPx": 48,
      "ours": [
        1500,
        1760
      ],
      "print": [
        1513,
        1757
      ],
      "delta": [
        -13,
        3
      ]
    },
    "eoe-99": {
      "textPx": 46,
      "ours": [
        1492,
        1660
      ],
      "print": [
        1520,
        1671
      ],
      "delta": [
        -28,
        -11
      ]
    },
    "eoe-167": {
      "textPx": 56,
      "ours": [
        1760
      ],
      "print": [
        1756
      ],
      "delta": [
        4
      ]
    },
    "eoe-208": {
      "textPx": 60,
      "ours": [
        1604
      ],
      "print": [
        1601
      ],
      "delta": [
        3
      ]
    },
    "eoe-219": {
      "textPx": 46,
      "ours": [
        1660
      ],
      "print": [
        1678
      ],
      "delta": [
        -18
      ]
    },
    "eoe-238": {
      "textPx": 56,
      "ours": [
        1523,
        1760
      ],
      "print": [
        1538,
        1757
      ],
      "delta": [
        -15,
        3
      ]
    },
    "eoe-32": {
      "textPx": 56,
      "ours": [
        1760
      ],
      "print": [
        1757
      ],
      "delta": [
        3
      ]
    },
    "eoc-14": {
      "textPx": 44,
      "ours": [
        1500,
        1668
      ],
      "print": [
        1510,
        1636
      ],
      "delta": [
        -10,
        32
      ]
    },
    "eoe-241": {
      "textPx": 70,
      "ours": [
        1657
      ],
      "print": [
        1620
      ],
      "delta": [
        37
      ]
    },
    "eoe-35": {
      "textPx": 52,
      "ours": [
        1687
      ],
      "print": [
        1683
      ],
      "delta": [
        4
      ]
    },
    "eoe-250": {
      "textPx": 58,
      "ours": [
        1693
      ],
      "print": [
        1688
      ],
      "delta": [
        5
      ]
    },
    "eoe-253": {
      "textPx": 66,
      "ours": [
        1734
      ],
      "print": [
        1756
      ],
      "delta": [
        -22
      ]
    },
    "eoe-255": {
      "textPx": 52,
      "ours": [
        1711
      ],
      "print": [
        1678
      ],
      "delta": [
        33
      ]
    },
    "eoe-259": {
      "textPx": 58,
      "ours": [
        1693
      ],
      "print": [
        1678
      ],
      "delta": [
        15
      ]
    },
    "eoe-260": {
      "textPx": 66,
      "ours": [
        1734
      ],
      "print": [
        1757
      ],
      "delta": [
        -23
      ]
    }
  }
};
