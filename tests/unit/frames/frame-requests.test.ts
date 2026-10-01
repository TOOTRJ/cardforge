import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import type { ScryfallCard } from "@/lib/scryfall/client";
import type { FrameTemplate } from "@/types/card";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_SIGNATURE_KEYS, type FrameMatch } from "@/lib/scryfall/frame-signatures";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import {
  artFlagForImport,
  frameRequestCause,
  frameRequestFromImport,
  frameRequestSchema,
  isForGoodSignature,
  scryfallPrintingUrl,
  signatureBlockedBy,
} from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// The frame request row an import writes (TODO 1.6) and its art flag (TODO
// 1.18), over real printings run through the real mapper.
// ---------------------------------------------------------------------------

const SIGNATURE = signaturePrintings as unknown as Record<string, ScryfallCard>;
const IMPORTS = importPrintings as unknown as Record<string, ScryfallCard>;
const patchOf = (key: string) => mapScryfallToFormPatch(SIGNATURE[key] ?? IMPORTS[key]);

describe("frameRequestFromImport", () => {
  it("logs Zilortha IKO #275 (borderless + nickname) with its art window-cropped", () => {
    // Sheoldred DMU #435 was the example until Borderless drew its crown
    // (4.6f, wave 2a): it imports exact now (below).
    const row = frameRequestFromImport(patchOf("iko-275"), {
      artImported: true,
      source: "import",
    });
    expect(row).toEqual({
      signature: "borderless/standard+nickname",
      label: "Borderless frame",
      setCode: "iko",
      collectorNumber: "275",
      scryfallId: SIGNATURE["iko-275"].id,
      status: "nearest",
      cause: "missing",
      template: "m15",
      artFlag: "window-cropped",
      source: "import",
    });
  });

  it("writes nothing for Sheoldred DMU #435 on Borderless verified in black — exact since 4.6f; 'unverified' where it isn't", () => {
    const patch = patchOf("dmu-435");
    expect(patch.frame_match).toMatchObject({ status: "exact", template: "m15borderless", landOn: "m15" });
    expect(
      frameRequestFromImport(patch, { artImported: true, source: "import", verifiedKeys: new Set([frameComboKey("m15borderless", "b")]) }),
    ).toBeNull();
    expect(
      frameRequestFromImport(patch, { artImported: true, source: "import", verifiedKeys: new Set([frameComboKey("m15", "b")]) }),
    ).toMatchObject({ signature: "borderless/standard", status: "nearest", cause: "unverified", template: "m15", artFlag: "window-cropped" });
  });

  it("writes nothing for an exact printing (Llanowar Elves DOM #168 on the verified M15 frame)", () => {
    const patch = patchOf("dom-168");
    expect(patch.frame_match?.status).toBe("exact");
    expect(
      frameRequestFromImport(patch, {
        artImported: true,
        source: "import",
        verifiedKeys: new Set([frameComboKey("m15", "g")]),
      }),
    ).toBeNull();
  });

  it("logs an exact frame that isn't verified in the card's colour as nearest, cause 'unverified' (D1)", () => {
    const patch = patchOf("dom-168");
    const row = frameRequestFromImport(patch, {
      artImported: false,
      source: "import",
      verifiedKeys: new Set([frameComboKey("m15", "r")]),
    });
    expect(row).toMatchObject({
      signature: "era/2015",
      status: "nearest",
      cause: "unverified",
      artFlag: null,
    });
  });

  it("keeps the cause of a patch the named route already finalized (the real import path)", () => {
    // /api/scryfall/named downgrades the unverified exact match before the
    // form sees it; the form's own finalization must not lose why.
    const heliod = finalizeImportMatch(patchOf("thb-259"), new Set([frameComboKey("m15", "w")]));
    expect(heliod.frame_match).toMatchObject({ status: "nearest", template: "nyx", unverified: true });
    for (const verifiedKeys of [undefined, new Set([frameComboKey("m15", "w")])]) {
      expect(
        frameRequestFromImport(heliod, { artImported: false, source: "import", verifiedKeys }),
      ).toMatchObject({ signature: "showcase/thb/constellation", status: "nearest", cause: "unverified" });
    }
    // Verified in white, it is exact: nothing to log.
    const verified = finalizeImportMatch(patchOf("thb-259"), new Set([frameComboKey("nyx", "w")]));
    expect(frameRequestFromImport(verified, { artImported: false, source: "import" })).toBeNull();
  });

  it("files the registry's own nearest and unsupported answers as 'missing', verified or not", () => {
    const everything = new Set([frameComboKey("m15", "b"), frameComboKey("m15borderless", "b")]);
    for (const verifiedKeys of [undefined, new Set<string>(), everything]) {
      expect(
        frameRequestFromImport(patchOf("iko-275"), { artImported: false, source: "import", verifiedKeys })
          ?.cause,
      ).toBe("missing");
    }
    expect(
      frameRequestFromImport(patchOf("fut-18"), {
        artImported: false,
        source: "import",
        verifiedKeys: new Set(),
      }),
    ).toMatchObject({ status: "unsupported", cause: "missing" });
    // A 2003-frame textless promo is nearest by the registry's own answer
    // (A9), before and after its later frame is verified.
    for (const verifiedKeys of [new Set<string>(), new Set([frameComboKey("m15textless", "w")])]) {
      expect(
        frameRequestFromImport(patchOf("p07-1"), { artImported: false, source: "import", verifiedKeys }),
      ).toMatchObject({ status: "nearest", cause: "missing" });
    }
  });

  it("logs unsupported printings, deck pre-fills and where the card really landed", () => {
    const row = frameRequestFromImport(patchOf("fut-18"), {
      artImported: false,
      source: "deck_prefill",
      landedTemplate: "m15artifact",
    });
    expect(row).toMatchObject({
      signature: "future",
      status: "unsupported",
      source: "deck_prefill",
      template: "m15artifact",
      setCode: "fut",
      collectorNumber: "18",
    });
  });

  it("skips a patch without a frame match (an older cached patch)", () => {
    const { frame_match: _drop, ...older } = patchOf("dmu-435");
    void _drop;
    expect(frameRequestFromImport(older, { artImported: true, source: "import" })).toBeNull();
  });

  it("every non-exact fixture printing makes a row the action accepts", () => {
    const keys = [...Object.keys(SIGNATURE), ...Object.keys(IMPORTS)];
    let logged = 0;
    for (const key of keys) {
      const row = frameRequestFromImport(patchOf(key), { artImported: true, source: "import" });
      if (!row) continue;
      logged += 1;
      expect(row.cause, key).toBe("missing"); // no verification ran: the registry's own answer
      const parsed = frameRequestSchema.safeParse(row);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(logged).toBeGreaterThan(50);
  });

  it("with nothing verified, every fixture printing is logged, the exact ones as 'unverified'", () => {
    const keys = [...Object.keys(SIGNATURE), ...Object.keys(IMPORTS)];
    let unverified = 0;
    for (const key of keys) {
      const patch = patchOf(key);
      if (!patch.frame_match) continue;
      const row = frameRequestFromImport(patch, {
        artImported: false,
        source: "import",
        verifiedKeys: new Set(),
      });
      expect(row, key).not.toBeNull();
      // Exact once its frame is verified: the exact ones, and an M20+ token
      // whose full-art template would be exact (TODO 4.48, onceVerifiedMatch).
      const wouldBeExact = patch.frame_match.status === "exact" || patch.frame_match.onceVerifiedMatch?.status === "exact";
      expect(row!.cause, key).toBe(wouldBeExact ? "unverified" : "missing");
      if (row!.cause === "unverified") unverified += 1;
      expect(frameRequestSchema.safeParse(row).success, key).toBe(true);
    }
    expect(unverified).toBeGreaterThan(10);
  });
});

describe("frameRequestCause (D1)", () => {
  it("is 'unverified' only for a match withVerification downgraded", () => {
    const nearest: Pick<FrameMatch, "status" | "unverified"> = { status: "nearest" };
    expect(frameRequestCause({ ...nearest, unverified: true })).toBe("unverified");
    expect(frameRequestCause(nearest)).toBe("missing");
    expect(frameRequestCause({ status: "unsupported" })).toBe("missing");
    // A stray flag on an unsupported match can't make it "verify next".
    expect(frameRequestCause({ status: "unsupported", unverified: true })).toBe("missing");
  });
});

describe("artFlagForImport (TODO 1.18)", () => {
  it("is null without imported art", () => {
    expect(artFlagForImport(patchOf("dmu-435"), false)).toBeNull();
  });

  it("flags a borderless non-full-art printing as window-cropped", () => {
    expect(artFlagForImport(patchOf("dmu-435"), true)).toBe("window-cropped");
    expect(artFlagForImport(patchOf("eld-271"), true)).toBe("window-cropped");
  });

  it("flags full-art and textless printings as frame-in-crop, borderless or not", () => {
    expect(artFlagForImport(patchOf("fra-382"), true)).toBe("frame-in-crop"); // borderless full-art basic
    expect(artFlagForImport(patchOf("unf-235"), true)).toBe("frame-in-crop"); // borderless textless basic
    expect(artFlagForImport(patchOf("znr-266"), true)).toBe("frame-in-crop"); // black-bordered full-art basic
    expect(artFlagForImport(patchOf("sch-3"), true)).toBe("frame-in-crop"); // textless promo
  });

  it("leaves a black-bordered, windowed printing alone", () => {
    expect(artFlagForImport(patchOf("dmu-107"), true)).toBeNull();
    expect(artFlagForImport(patchOf("woe-328"), true)).toBeNull(); // extended art
  });

  it("reads the 1.16 treatment fields on an older patch without `printing`", () => {
    expect(
      artFlagForImport(
        { printing_treatment: "borderless", printing_detail: { set: "dmu", fullArt: false, textless: false } },
        true,
      ),
    ).toBe("window-cropped");
    expect(
      artFlagForImport(
        { printing_treatment: "fullart", printing_detail: { set: "znr", fullArt: true, textless: false } },
        true,
      ),
    ).toBe("frame-in-crop");
    expect(artFlagForImport({}, true)).toBeNull();
  });
});

describe("frameRequestSchema", () => {
  const valid = frameRequestFromImport(patchOf("iko-275"), { artImported: true, source: "import" })!;

  it("accepts a real row", () => {
    expect(frameRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an unknown signature, template, set code, status or source", () => {
    for (const bad of [
      { signature: "made/up" },
      { template: "notaframe" },
      { setCode: "DMU" },
      { setCode: "d" },
      { status: "exact" },
      { cause: "stale" },
      { cause: null },
      { status: "unsupported", cause: "unverified" },
      { source: "api" },
      { artFlag: "blurry" },
      { scryfallId: "not-a-uuid" },
      { label: "" },
      { collectorNumber: "x".repeat(17) },
    ]) {
      expect(frameRequestSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("registry facts for the admin page", () => {
  it("knows the families PipGlyph will never build", () => {
    expect(isForGoodSignature("borderless/poster")).toBe(true);
    expect(isForGoodSignature("frameless/slz")).toBe(true);
    expect(isForGoodSignature("substitute-card")).toBe(true);
    expect(isForGoodSignature("borderless/standard+crown")).toBe(false);
    expect(isForGoodSignature("made/up")).toBe(false);
  });

  it("names the TODO item that would make a signature exact", () => {
    expect(signatureBlockedBy("borderless/standard+crown")).toBe("4.6f");
    expect(signatureBlockedBy("era/2015")).toBeNull();
    expect(signatureBlockedBy("made/up")).toBeNull();
  });

  it("links a printing on Scryfall", () => {
    expect(scryfallPrintingUrl("dmu", "435")).toBe("https://scryfall.com/card/dmu/435");
    expect(scryfallPrintingUrl("plst", "ARB-1")).toBe("https://scryfall.com/card/plst/ARB-1");
    expect(scryfallPrintingUrl("sld", "1★")).toBe("https://scryfall.com/card/sld/1%E2%98%85");
    expect(scryfallPrintingUrl(null, "435")).toBeNull();
    expect(scryfallPrintingUrl("dmu", null)).toBeNull();
  });
});

describe("supabase/seeds/21_frame_requests.sql", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/seeds/21_frame_requests.sql"), "utf8");
  const devData = readFileSync(join(process.cwd(), "supabase/seeds/10_dev_data.sql"), "utf8");
  const DEV_USERS = new Set(
    [...devData.matchAll(/'(d0000000-[0-9a-f-]{27})'::uuid, '[a-z]+@dev\.pipglyph\.test'/g)].map(
      (m) => m[1],
    ),
  );
  // One value tuple per line: quoted literals, null, or the created_at
  // expression (matched first, so its quoted interval isn't read as a field).
  const TOKEN = /now\(\) - interval '([^']+)'|'([^']*)'|\b(null)\b/g;
  const tuples = [...sql.matchAll(/^\s*\(('fa000000-[^\n]*)\),?$/gm)].map((m) =>
    [...m[1].matchAll(TOKEN)].map((t) => (t[1] !== undefined ? `-${t[1]}` : t[3] ? null : t[2])),
  );
  const rows = tuples.map(
    ([id, userId, signature, label, set, collector, scryfallId, status, cause, template, artFlag, source, age]) => ({
      id: id!,
      userId,
      signature: signature!,
      label,
      set,
      collector,
      scryfallId,
      status,
      cause,
      template,
      artFlag,
      source,
      age,
    }),
  );
  const RETIRED = "retired/seed-example";

  it("seeds a handful of rows, every one in the shape this test reads", () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBe(sql.match(/\('fa000000-/g)?.length);
    for (const tuple of tuples) expect(tuple, String(tuple[0])).toHaveLength(13);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(DEV_USERS.size).toBe(5);
    for (const row of rows) {
      expect(["nearest", "unsupported"], row.id).toContain(row.status);
      expect(["import", "deck_prefill"], row.id).toContain(row.source);
      expect([null, "window-cropped", "frame-in-crop"], row.id).toContain(row.artFlag);
      expect(row.age, row.id).toMatch(/^-\d+ days?$/);
    }
  });

  it("fills both groups (D1), from dev accounts that exist, and ranks by distinct users (D4)", () => {
    expect(rows.filter((row) => row.cause === "missing").length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((row) => row.cause === "unverified").length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(["missing", "unverified"], row.id).toContain(row.cause);
      if (row.cause === "unverified") expect(row.status, row.id).toBe("nearest");
      expect(row.userId === null || DEV_USERS.has(row.userId), row.id).toBe(true);
    }
    // Some group has more distinct users but fewer requests than another —
    // so the page's order (users first) differs from a requests order.
    const groups = new Map<string, { users: Set<string>; n: number }>();
    for (const row of rows) {
      const key = `${row.signature}|${row.set}|${row.cause}`;
      const group = groups.get(key) ?? { users: new Set<string>(), n: 0 };
      group.n += 1;
      if (row.userId) group.users.add(row.userId);
      groups.set(key, group);
    }
    const all = [...groups.values()];
    expect(all.some((a) => all.some((b) => a.users.size > b.users.size && a.n < b.n))).toBe(true);
  });

  it("uses real signatures, with the label, status and cause the registry gives that printing", () => {
    const byId = new Map(
      [...Object.values(SIGNATURE), ...Object.values(IMPORTS)].map((card) => [card.id, card]),
    );
    for (const row of rows.filter((r) => r.signature !== RETIRED)) {
      expect(FRAME_SIGNATURE_KEYS).toContain(row.signature);
      const card = byId.get(row.scryfallId!);
      expect(card, `${row.set} #${row.collector} is a fixture printing`).toBeTruthy();
      expect(card!.set).toBe(row.set);
      expect(card!.collector_number).toBe(row.collector);
      const patch = mapScryfallToFormPatch(card!);
      const match = patch.frame_match!;
      expect({ signature: match.signature, label: match.exactLabel }).toEqual({
        signature: row.signature,
        label: row.label,
      });
      if (row.cause === "unverified") {
        // The registry says exact; the import logs it while that frame isn't
        // verified in the card's colour.
        expect(match.status, row.id).toBe("exact");
        expect(
          frameRequestFromImport(patch, { artImported: false, source: "import", verifiedKeys: new Set() }),
        ).toMatchObject({ status: "nearest", cause: "unverified" });
      } else {
        expect(match.status, row.id).toBe(row.status);
      }
    }
  });

  it("gives every row the status and cause a real import would log against production's verified frames", () => {
    // supabase/seed.sql mirrors production's verified combos (owner decision
    // A7); production also verified both full-art basics in w/u/b/r/g/c,
    // which that refresh brings in (as in import-correctness.test.ts). A row
    // filed 'unverified' whose frame production already verified — the FDN
    // #282 Plains on m15fullartland — would be a request no import can make.
    const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/
      .exec(sql)?.[1]
      .replace(/--.*$/gm, "");
    expect(block, "seed.sql's frame_reviews block").toBeTruthy();
    const verified = new Set<string>();
    const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block!)?.[1] ?? "";
    for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
      for (const colour of ["w", "u", "b", "r", "g", "c", "m"]) {
        verified.add(frameComboKey(template as FrameTemplate, colour));
      }
    }
    for (const [, template, colour] of block!.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
      verified.add(frameComboKey(template as FrameTemplate, colour));
    }
    expect(verified.has(frameComboKey("m15", "w"))).toBe(true);
    for (const template of ["m15fullartland", "fullartland"] as const) {
      for (const colour of ["w", "u", "b", "r", "g", "c"]) verified.add(frameComboKey(template, colour));
    }

    const byId = new Map(
      [...Object.values(SIGNATURE), ...Object.values(IMPORTS)].map((card) => [card.id, card]),
    );
    for (const row of rows.filter((r) => r.signature !== RETIRED)) {
      // What /api/scryfall/named sends, then what the form logs.
      const patch = finalizeImportMatch(mapScryfallToFormPatch(byId.get(row.scryfallId!)!), verified);
      expect(
        frameRequestFromImport(patch, { artImported: false, source: "import", verifiedKeys: verified }),
        row.id,
      ).toMatchObject({ signature: row.signature, status: row.status, cause: row.cause });
    }
  });

  it("plants exactly one key no rule has, so the page's flag (D6) has a row", () => {
    const retired = rows.filter((row) => !FRAME_SIGNATURE_KEYS.includes(row.signature));
    expect(retired.map((row) => row.signature)).toEqual([RETIRED]);
  });
});
