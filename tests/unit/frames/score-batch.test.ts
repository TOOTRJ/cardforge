import { describe, expect, it } from "vitest";
import type { SlotScore } from "@/lib/frames/align";
import {
  combosForTemplates,
  consensusNudge,
  createScoreBatchDecoder,
  encodeScoreBatchEvent,
  formatNudgePct,
  parseRecordedScore,
  planScoreBatch,
  runScoreBatch,
  slotWantsNudge,
  templatesForTreatment,
  treatmentSlotConsensus,
  type ScoreBatchEvent,
  type ScoreBatchResult,
} from "@/lib/frames/score-batch";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Verification throughput (TODO 4.12), the pure half: which combos a job
// scores (a colour with no printing is skipped, never "scored"), how the run
// stops at its time budget or a cancel without dropping the combo in
// flight, the NDJSON wire format, and how a slot's per-colour nudges become
// ONE template nudge (the layout override moves every colour at once) — and,
// across a treatment, one nudge for a slot several frames share.
// ---------------------------------------------------------------------------

const ok = (overall: number): ScoreBatchResult => ({
  ok: true,
  overall,
  global: { dxPct: 0, dyPct: 0, confidence: 0.9 },
  slots: {},
  referenceId: "ref",
  recorded: true,
});

const slot = (score: number, best: number, dxPct: number, dyPct: number): SlotScore => ({
  score,
  best,
  dxPct,
  dyPct,
});

describe("scope", () => {
  it("a treatment is its frame set, base frame first", () => {
    // …and 4.34's land joins the Borderless set.
    expect(templatesForTreatment("borderless")).toEqual(["m15borderless", "m15borderlessartifact", "m15borderlessland"]);
    expect(templatesForTreatment("fullartset")).toEqual([
      "m15fullartland",
      "fullartland",
      "m15textless",
      "m15textlessland",
    ]);
    expect(templatesForTreatment("nyxset")).toEqual(["nyx"]);
  });

  it("combos cover every colour of every template, in W U B R G C M order", () => {
    const combos = combosForTemplates(["saga", "battle"]);
    expect(combos).toHaveLength(14);
    expect(combos.slice(0, 7).map((c) => c.colorKey).join("")).toBe("wubrgcm");
    expect(combos[7]).toEqual({ template: "battle", colorKey: "w" });
  });
});

describe("planScoreBatch", () => {
  it("scores each combo against its own reference and skips the ones with no printing", () => {
    // alphatoken has no registry printing at all; m15 has all seven.
    const plan = planScoreBatch(
      [
        { template: "m15", colorKey: "w" },
        { template: "alphatoken", colorKey: "w" },
        { template: "m15", colorKey: "w" }, // duplicate
      ],
      new Map(),
    );
    expect(plan.toScore).toEqual([
      { template: "m15", colorKey: "w", referenceId: FRAME_REFERENCES.m15.w!.scryfallId },
    ]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ template: "alphatoken", colorKey: "w", reason: expect.stringMatching(/No real printing/) }),
    ]);
  });

  it("an admin-pinned printing wins over the registry default", () => {
    const pinned = "11111111-2222-4333-8444-555555555555";
    const plan = planScoreBatch(
      [{ template: "m15", colorKey: "u" }],
      new Map([["m15/u", { referenceScryfallId: pinned, referenceName: "Pinned", referenceSet: "tst" }]]),
    );
    expect(plan.toScore[0].referenceId).toBe(pinned);
  });
});

describe("runScoreBatch", () => {
  const combos = (["w", "u", "b", "r", "g"] as const).map((colorKey) => ({ template: "saga" as const, colorKey }));

  it("scores every combo and reports each one", async () => {
    const events: ScoreBatchEvent[] = [];
    const outcome = await runScoreBatch({
      combos,
      scoreOne: async (c) => ok(c.colorKey.charCodeAt(0) % 10),
      send: (e) => events.push(e),
      concurrency: 2,
    });
    expect(outcome).toEqual({ scored: 5, failed: 0, remaining: [], stopped: null });
    expect(events.filter((e) => e.type === "scoring")).toHaveLength(5);
    expect(events.filter((e) => e.type === "result").map((e) => (e as { colorKey: string }).colorKey).sort()).toEqual(
      ["b", "g", "r", "u", "w"],
    );
  });

  it("never runs more combos at once than its concurrency", async () => {
    let running = 0;
    let peak = 0;
    await runScoreBatch({
      combos,
      scoreOne: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running -= 1;
        return ok(1);
      },
      send: () => {},
      concurrency: 2,
    });
    expect(peak).toBe(2);
  });

  it("a thrown or failed score is a failed result, and the run carries on", async () => {
    const events: ScoreBatchEvent[] = [];
    const outcome = await runScoreBatch({
      combos: combos.slice(0, 3),
      scoreOne: async (c) => {
        if (c.colorKey === "w") throw new Error("render blew up");
        if (c.colorKey === "u") return { ok: false, error: "Could not download the scan." };
        return { ...ok(3), recorded: false };
      },
      send: (e) => events.push(e),
      concurrency: 1,
    });
    expect(outcome.scored).toBe(0);
    expect(outcome.failed).toBe(3);
    const results = events.filter((e) => e.type === "result");
    expect(results[0]).toMatchObject({ colorKey: "w", ok: false, error: "render blew up" });
    expect(results[1]).toMatchObject({ colorKey: "u", ok: false });
    // Scored but not recorded counts as failed: it can't count at sign-off.
    expect(results[2]).toMatchObject({ colorKey: "b", ok: true, recorded: false });
  });

  it("stops STARTING combos at the budget, finishes the one in flight, and hands back the rest", async () => {
    let clock = 0;
    const events: ScoreBatchEvent[] = [];
    const outcome = await runScoreBatch({
      combos,
      scoreOne: async () => {
        clock += 70;
        return ok(2);
      },
      send: (e) => events.push(e),
      budgetMs: 100,
      concurrency: 1,
      now: () => clock,
    });
    // w starts at 0 (→70), u starts at 70 (→140), b would start at 140 ≥ 100.
    expect(outcome.scored).toBe(2);
    expect(outcome.stopped).toBe("budget");
    expect(outcome.remaining.map((c) => c.colorKey)).toEqual(["b", "r", "g"]);
    expect(events.filter((e) => e.type === "result")).toHaveLength(2);
  });

  it("a cancel stops new combos; nothing left means no stop reason", async () => {
    let cancel = false;
    const outcome = await runScoreBatch({
      combos,
      scoreOne: async (c) => {
        if (c.colorKey === "u") cancel = true;
        return ok(1);
      },
      send: () => {},
      concurrency: 1,
      isCancelled: () => cancel,
    });
    expect(outcome.stopped).toBe("cancelled");
    expect(outcome.remaining.map((c) => c.colorKey)).toEqual(["b", "r", "g"]);

    // Cancelled after the last combo started: nothing was left undone.
    let late = false;
    const done = await runScoreBatch({
      combos: combos.slice(0, 1),
      scoreOne: async () => {
        late = true;
        return ok(1);
      },
      send: () => {},
      isCancelled: () => late,
    });
    expect(done).toEqual({ scored: 1, failed: 0, remaining: [], stopped: null });
  });
});

describe("the NDJSON wire format", () => {
  it("round-trips events split across arbitrary chunks and drops junk lines", () => {
    const events: ScoreBatchEvent[] = [
      { type: "start", combos: [{ template: "saga", colorKey: "w" }], skipped: [] },
      { type: "scoring", template: "saga", colorKey: "w" },
      { type: "result", template: "saga", colorKey: "w", ...ok(4.2) },
      { type: "done", scored: 1, failed: 0, remaining: [], stopped: null },
    ];
    const text = events.map(encodeScoreBatchEvent).join("") + "not json\n{\"type\":\"nope\"}\n";
    const decoder = createScoreBatchDecoder();
    const out: ScoreBatchEvent[] = [];
    for (let i = 0; i < text.length; i += 7) out.push(...decoder.push(text.slice(i, i + 7)));
    out.push(...decoder.flush());
    expect(out).toEqual(events);
  });

  it("a last line without its newline is read by flush", () => {
    const decoder = createScoreBatchDecoder();
    expect(decoder.push('{"type":"error","error":"x"}')).toEqual([]);
    expect(decoder.flush()).toEqual([{ type: "error", error: "x" }]);
  });
});

describe("parseRecordedScore", () => {
  it("reads overall, registration and the slots that are well-formed", () => {
    expect(
      parseRecordedScore({
        overall: 5.1,
        global: { dxPct: 0.1, dyPct: -0.2, confidence: 0.8 },
        slots: { title: slot(9, 7, 0, 0.3), junk: { score: "x" } },
      }),
    ).toEqual({
      overall: 5.1,
      global: { dxPct: 0.1, dyPct: -0.2, confidence: 0.8 },
      slots: { title: slot(9, 7, 0, 0.3) },
    });
  });

  it("an older record with only the overall still reads; no overall = no score", () => {
    expect(parseRecordedScore({ overall: 7 })).toEqual({ overall: 7, global: null, slots: {} });
    expect(parseRecordedScore({ slots: {} })).toBeNull();
    expect(parseRecordedScore(null)).toBeNull();
  });
});

describe("consensusNudge — one nudge for the template", () => {
  it("a nudge only counts when the colour's own search found a better spot", () => {
    expect(slotWantsNudge(slot(9, 7, 0, 0.3))).toBe(true);
    expect(slotWantsNudge(slot(9, 9, 0, 0.3))).toBe(false);
    expect(slotWantsNudge(slot(9, 7, 0, 0))).toBe(false);
  });

  it("suggests the median move when most colours agree", () => {
    const samples = [
      slot(10, 6, 0, 0.3),
      slot(11, 7, 0, 0.4),
      slot(9, 6, 0.1, 0.3),
      slot(10, 7, 0, 0.2),
      slot(8, 8, 0, 0), // stays
    ];
    expect(consensusNudge(samples)).toEqual({
      dxPct: 0,
      dyPct: 0.3,
      agree: 4,
      of: 5,
      meanScore: 9.6,
      meanBest: 6.8,
    });
  });

  it("no majority, no nudge: a split vote or a lone outlier leaves the slot alone", () => {
    expect(consensusNudge([slot(10, 6, 0, 0.5), slot(10, 10, 0, 0), slot(10, 10, 0, 0)])).toBeNull();
    expect(consensusNudge([slot(10, 6, 0, 0.5), slot(10, 6, 0, -0.5)])).toBeNull();
    // Nudges that don't improve the score are votes to stay.
    expect(consensusNudge([slot(10, 12, 0, 0.5), slot(10, 12, 0, 0.5), slot(10, 6, 0, 0.5)])).toBeNull();
    expect(consensusNudge([])).toBeNull();
  });

  it("half the colours is not a majority, even when the median moves", () => {
    // Median dy of [0, 0, 0.4, 0.4] is 0.2 — but only 2 of 4 agree.
    expect(
      consensusNudge([slot(10, 6, 0, 0.4), slot(10, 6, 0, 0.4), slot(10, 10, 0, 0), slot(10, 10, 0, 0)]),
    ).toBeNull();
    // One more colour on its side is.
    expect(
      consensusNudge([slot(10, 6, 0, 0.4), slot(10, 6, 0, 0.4), slot(10, 6, 0, 0.4), slot(10, 10, 0, 0)]),
    ).toMatchObject({ dxPct: 0, dyPct: 0.4, agree: 3, of: 4 });
  });

  it("moves under the threshold round to 'stays'", () => {
    expect(consensusNudge([slot(10, 9, 0.04, 0), slot(10, 9, 0.04, 0), slot(10, 9, 0.04, 0)])).toBeNull();
  });

  it("formats with a true minus", () => {
    expect(formatNudgePct(0.3)).toBe("+0.3");
    expect(formatNudgePct(-0.25)).toBe("−0.3");
    expect(formatNudgePct(0)).toBe("0");
  });
});

describe("treatmentSlotConsensus — kinds that share a slot pool their samples", () => {
  const rect = { topPct: 5, leftPct: 7, widthPct: 80, heightPct: 5 };
  const moved = { ...rect, topPct: 5.4 };

  it("pools every colour of the frames that draw the slot on the same rect", () => {
    const rows = treatmentSlotConsensus([
      {
        template: "m15borderless",
        rects: { title: rect, artSlot: rect },
        scores: [{ title: slot(10, 6, 0, 0.3) }, { title: slot(10, 6, 0, 0.3) }],
      },
      {
        template: "m15borderlessartifact",
        rects: { title: rect, artSlot: rect },
        scores: [{ title: slot(12, 8, 0, 0.3) }, { title: slot(9, 9, 0, 0) }],
      },
    ]);
    // artSlot is never pooled (art always differs, never nudged).
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: "title",
      templates: ["m15borderless", "m15borderlessartifact"],
      samples: 4,
      meanScore: 10.3,
      nudge: expect.objectContaining({ dyPct: 0.3, agree: 3, of: 4 }),
    });
  });

  it("a slot a kind moved is its own — not shared, not pooled", () => {
    const rows = treatmentSlotConsensus([
      { template: "a", rects: { title: rect }, scores: [{ title: slot(10, 6, 0, 0.3) }] },
      { template: "b", rects: { title: moved }, scores: [{ title: slot(10, 6, 0, 0.3) }] },
    ]);
    expect(rows).toEqual([]);
  });

  it("a shared slot with no current scores is listed with no samples and no nudge", () => {
    const rows = treatmentSlotConsensus([
      { template: "a", rects: { type: rect }, scores: [] },
      { template: "b", rects: { type: rect }, scores: [] },
    ]);
    expect(rows).toEqual([{ path: "type", templates: ["a", "b"], samples: 0, meanScore: 0, nudge: null }]);
  });
});
