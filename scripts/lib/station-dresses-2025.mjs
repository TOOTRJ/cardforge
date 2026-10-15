// ---------------------------------------------------------------------------
// The station frame's DRESSES (TODO 4.27a step 2, PR 4) — what the 26 paper
// station printings that are NOT the black-bordered station frame measured,
// as DATA. No scan is read by any build: these numbers are the record (as
// scripts/lib/station-2025.mjs holds the bordered frame's).
//
// Read 2026-10-14: Scryfall's `kw:station or t:spacecraft or t:planet`
// (include:extras, unique:prints) — 95 printings, 91 with the Station
// keyword, of which 61 paper black-bordered (done, PR 1–3), 3 Arena-only and
// the playtest card (black-bordered 2015 frame too), and these 26. PNG scans
// (745 x 1040) resampled to 1500 x 2100 with lanczos3; every figure is HD px.
//
//   border        width of the near-black run from the edge (luma ≤ 45) at
//                 the art's rows (y 800), the box's (y 1650) and the title's
//                 (y 150); top / bottom from the edge at the centre columns.
//                 0 = the art (or the print's own picture) reaches the edge.
//   typeBarLuma   median luma inside the type bar (x 850–1150, y 1225–1270);
//                 the bordered printings read 174–243 (a light bar).
//   opaqueDelta   median |ΔRGB| between a candidate master and the print over
//                 the master's opaque, non-black pixels (luma ≥ 40: the bars,
//                 rims and pinlines — the black border is left out, it is
//                 the same on every candidate), best vertical offset 0 px.
//                 "today" = the frame the import lands on today; "new" = the
//                 dress built here.
//
// Findings:
//   • EXTENDED ART (13: EOE #321–355, EOC #27 / #34, TRK #481) = Card
//     Conjurer's extended-art bars (no art-window rails: 0 px of border at
//     the art's rows on 11 of 13 — the other two's art is dark at the edge;
//     the BLACK type bar, luma 9–47, white ink) over the station box, the
//     field beside the box the picture, the black border beside and under
//     the box (41–98 px). The bars match the extended-art masters: 4.3–10.0
//     against the extended-art spell frame's 59.0–81.0 and the bordered
//     station frame's 38.0–81.0. A colourless one is the silver artifact
//     frame. The text drops the reminder ("Station" alone): the cards' own
//     text, not the frame.
//   • BORDERLESS (2: EOC #1 / #2, three-colour legendary commanders) = Card
//     Conjurer's borderless pack — no field, translucent bars with thick gold
//     rims floating on the art, the black bottom bar with its side fins, the
//     floating crown, white title and type ink — with the STATION box (the
//     light paper and the tier washes, black text) in place of the pack's
//     dark one: 16.0 / 16.7 on the borderless artifact masters (the same as
//     the frame they derive from: the box is not in the opaque measure),
//     121.7 / 122.3 on today's landing (the bordered artifact frame).
//   • SHOWCASE (11): two designs, NO frame to master —
//       – the ten "viewport" Planets (EOE #277 / 279 / 281 / 284 / 285 and
//         their galaxy-foil #372 / 374 / 376 / 379 / 380; five cards, one
//         per colour): borderless; the picture is the whole card, its lower
//         part painted near-black (the room behind a window — each card's
//         window frame is different and is the ART: struts, ribs, arches);
//         name, type line and text set directly on it in white, the tier's
//         badge alone of the station pieces (its ring in the colour);
//       – TRK #557 (Star Trek's showcase, one printing): a one-off "starship
//         schematic" design — linework, small caps, no bars.
//     Left as they land (4.11's showcase rule, the station gap), with the
//     bordered Planet / Spacecraft frame as their landing once verified.
// ---------------------------------------------------------------------------

export const STATION_DRESSES_MEASURED = {
  measured: "2026-10-14; Scryfall PNG 745 x 1040 resampled to 1500 x 2100 (lanczos3); HD px",
  printings: {
    "eoc-1": { name: "Hearthhull, the Worldseed", group: "borderless", colours: "BGR", border: { top: 0, bottom: 72, leftAtArt: 28, rightAtArt: 0, leftAtBox: 6, rightAtBox: 7, leftAtTitle: 0 }, typeBarLuma: 74, opaqueDelta: { today: 121.7, borderlessArtifact: 16, borderedStation: 68.7, new: 16 } },
    "eoc-2": { name: "Inspirit, Flagship Vessel", group: "borderless", colours: "RUW", border: { top: 0, bottom: 74, leftAtArt: 139, rightAtArt: 0, leftAtBox: 7, rightAtBox: 9, leftAtTitle: 49 }, typeBarLuma: 59, opaqueDelta: { today: 122.3, borderlessArtifact: 16.7, borderedStation: 67, new: 16.7 } },
    "eoc-27": { name: "Uthros Research Craft", group: "extended", colours: "U", border: { top: 88, bottom: 84, leftAtArt: 2, rightAtArt: 91, leftAtBox: 96, rightAtBox: 57, leftAtTitle: 59 }, typeBarLuma: 47, opaqueDelta: { today: 70.7, borderedStation: 46.7, new: 10 } },
    "eoc-34": { name: "Exploration Broodship", group: "extended", colours: "G", border: { top: 61, bottom: 73, leftAtArt: 0, rightAtArt: 0, leftAtBox: 71, rightAtBox: 58, leftAtTitle: 58 }, typeBarLuma: 31, opaqueDelta: { today: 81, borderedStation: 38, new: 9.3 } },
    "eoe-321": { name: "Lumen-Class Frigate", group: "extended", colours: "W", border: { top: 60, bottom: 73, leftAtArt: 0, rightAtArt: 0, leftAtBox: 41, rightAtBox: 57, leftAtTitle: 57 }, typeBarLuma: 31, opaqueDelta: { today: 68.7, borderedStation: 54.7, new: 4.7 } },
    "eoe-323": { name: "The Seriema", group: "extended", colours: "W", border: { top: 43, bottom: 72, leftAtArt: 200, rightAtArt: 175, leftAtBox: 97, rightAtBox: 98, leftAtTitle: 52 }, typeBarLuma: 36, opaqueDelta: { today: 79.7, borderedStation: 55, new: 4.3 } },
    "eoe-329": { name: "Synthesizer Labship", group: "extended", colours: "U", border: { top: 61, bottom: 72, leftAtArt: 0, rightAtArt: 0, leftAtBox: 59, rightAtBox: 98, leftAtTitle: 57 }, typeBarLuma: 44, opaqueDelta: { today: 70.7, borderedStation: 42.3, new: 9.3 } },
    "eoe-332": { name: "Entropic Battlecruiser", group: "extended", colours: "B", border: { top: 61, bottom: 75, leftAtArt: 0, rightAtArt: 0, leftAtBox: 58, rightAtBox: 58, leftAtTitle: 58 }, typeBarLuma: 40, opaqueDelta: { today: 70.3, borderedStation: 43, new: 5 } },
    "eoe-339": { name: "Warmaker Gunship", group: "extended", colours: "R", border: { top: 61, bottom: 73, leftAtArt: 0, rightAtArt: 0, leftAtBox: 59, rightAtBox: 57, leftAtTitle: 59 }, typeBarLuma: 9, opaqueDelta: { today: 59, borderedStation: 45.7, new: 10 } },
    "eoe-346": { name: "Sledge-Class Seedship", group: "extended", colours: "G", border: { top: 60, bottom: 73, leftAtArt: 0, rightAtArt: 0, leftAtBox: 55, rightAtBox: 57, leftAtTitle: 57 }, typeBarLuma: 44, opaqueDelta: { today: 60.7, borderedStation: 46.3, new: 9.3 } },
    "eoe-348": { name: "Infinite Guideline Station", group: "extended", colours: "BGRUW", border: { top: 43, bottom: 82, leftAtArt: 25, rightAtArt: 111, leftAtBox: 58, rightAtBox: 58, leftAtTitle: 52 }, typeBarLuma: 24, opaqueDelta: { today: 73.7, borderedStation: 70, new: 8.7 } },
    "eoe-351": { name: "Dawnsire, Sunstar Dreadnought", group: "extended", colours: "", border: { top: 43, bottom: 82, leftAtArt: 0, rightAtArt: 0, leftAtBox: 53, rightAtBox: 58, leftAtTitle: 52 }, typeBarLuma: 28, opaqueDelta: { today: 63, borderedStation: 73.3, new: 6.7 } },
    "eoe-354": { name: "The Eternity Elevator", group: "extended", colours: "", border: { top: 43, bottom: 76, leftAtArt: 0, rightAtArt: 0, leftAtBox: 59, rightAtBox: 97, leftAtTitle: 52 }, typeBarLuma: 34, opaqueDelta: { today: 62.3, borderedStation: 52, new: 5.3 } },
    "eoe-355": { name: "Extinguisher Battleship", group: "extended", colours: "", border: { top: 89, bottom: 72, leftAtArt: 6, rightAtArt: 44, leftAtBox: 58, rightAtBox: 58, leftAtTitle: 75 }, typeBarLuma: 19, opaqueDelta: { today: 68, borderedStation: 69.7, new: 5.3 } },
    "trk-481": { name: "U.S.S. Enterprise-D, Galaxy-Class", group: "extended", colours: "", border: { top: 43, bottom: 73, leftAtArt: 0, rightAtArt: 0, leftAtBox: 59, rightAtBox: 97, leftAtTitle: 52 }, typeBarLuma: 26, opaqueDelta: { today: 65.3, borderedStation: 81, new: 6.3 } },
  },
  showcase: {
    viewportPlanets: ["eoe-277", "eoe-279", "eoe-281", "eoe-284", "eoe-285", "eoe-372", "eoe-374", "eoe-376", "eoe-379", "eoe-380"],
    oneOff: ["trk-557"],
  },
};
