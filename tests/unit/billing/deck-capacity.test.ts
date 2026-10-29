import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPPED_DECK_VISIBILITIES,
  CARD_CAPACITY_UNLIMITED,
  DECK_CAPACITY,
} from "@/lib/billing/plans";
import {
  deckCapBlocks,
  deckCapacityFull,
  deckCapacityRefusal,
  deckCountsTowardCap,
  deckUsageLabel,
  describeDeckCapacity,
  describeDeckUsage,
  isDeckCapacityViolation,
  overDeckCapacity,
  remainingDeckCapacity,
  type DeckCapacity,
} from "@/lib/billing/deck-capacity-copy";

// ---------------------------------------------------------------------------
// The private-deck cap (owner decision D1, 2026-10-28; TODO DK3.1): the
// app's numbers and the database trigger (migration 0145) must agree, the
// trigger must resolve the tier EXACTLY as 0104's card_capacity_for does,
// and the copy must say the right thing at the right count. The SQL itself
// is proved on the local stack (the PR body has the run); this holds the
// file to what the app relies on.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const DECKS = squash(strip(readFileSync(join(dir, "0145_deck_capacity.sql"), "utf8")));
const CARDS = squash(strip(readFileSync(join(dir, "0104_card_capacity_enforcement.sql"), "utf8")));

/** The body of `create or replace function public.<name>(` … `$$;`. */
function fn(sql: string, name: string): string {
  const m = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$;`, "i").exec(sql);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
}

/** The tier rule: the subscription case, the comp case and the ranking. */
function tierRule(body: string): string[] {
  const pick = (re: RegExp) => {
    const m = re.exec(body);
    if (!m) throw new Error(`no ${re}`);
    return m[0];
  };
  return [
    pick(/case when subscription_tier in .*? end as subscribed/),
    pick(/case when comp_tier in .*? end as comp/),
    pick(/case when comp is not null .*? end as tier/),
  ];
}

describe("migration 0145 mirrors DECK_CAPACITY", () => {
  const cap = fn(DECKS, "deck_capacity_for");

  it("uses the same plus / free caps and the unlimited sentinel for pro and admins", () => {
    expect(cap).toContain(`when is_admin then ${CARD_CAPACITY_UNLIMITED}`);
    expect(cap).toContain(`when tier = 'pro' then ${DECK_CAPACITY.pro}`);
    expect(cap).toContain(`when tier = 'plus' then ${DECK_CAPACITY.plus}`);
    expect(cap).toContain(`else ${DECK_CAPACITY.free} end`);
    expect(DECK_CAPACITY).toEqual({ free: 1, plus: 3, pro: CARD_CAPACITY_UNLIMITED });
    // A missing profile row falls back to the free cap, never to a free pass.
    expect(DECKS).toContain(`coalesce(public.deck_capacity_for(new.owner_id), ${DECK_CAPACITY.free})`);
  });

  it("resolves the tier exactly as card_capacity_for (0104): active/trialing, unexpired comp, the higher wins", () => {
    expect(tierRule(cap)).toEqual(tierRule(fn(CARDS, "card_capacity_for")));
  });

  it("never reads card_limit_override — it is a CARD override", () => {
    expect(cap).not.toContain("card_limit_override");
  });
});

describe("migration 0145 — the trigger", () => {
  const body = fn(DECKS, "enforce_deck_capacity");

  it("fires before an insert and before an update of visibility or owner_id, per row", () => {
    expect(DECKS).toContain(
      "create trigger decks_enforce_capacity before insert or update of visibility, owner_id on public.decks for each row execute function public.enforce_deck_capacity();",
    );
    expect(DECKS).toContain("drop trigger if exists decks_enforce_capacity on public.decks;");
  });

  it("counts the visibilities the app counts, and only those (public decks are unlimited)", () => {
    const list = `in (${CAPPED_DECK_VISIBILITIES.map((v) => `'${v}'`).join(", ")})`;
    expect(body).toContain(`if new.visibility not ${list} then return new;`);
    expect(body).toContain(`and d.visibility ${list}`);
    expect([...CAPPED_DECK_VISIBILITIES].sort()).toEqual(["private", "unlisted"]);
    expect(deckCountsTowardCap("public")).toBe(false);
    expect(deckCountsTowardCap("private")).toBe(true);
    expect(deckCountsTowardCap("unlisted")).toBe(true);
  });

  it("grandfathers: an update that keeps a deck private / unlisted under the same owner is never checked", () => {
    expect(body).toContain(
      "if tg_op = 'UPDATE' and old.visibility in ('private', 'unlisted') and new.owner_id is not distinct from old.owner_id then return new;",
    );
  });

  it("takes the per-owner lock BEFORE it counts, never counts the deck itself, and raises the app's error", () => {
    const lock = body.indexOf("perform pg_advisory_xact_lock(hashtextextended('deck_capacity:' || new.owner_id::text, 0));");
    const count = body.indexOf("select count(*) into v_count");
    expect(lock).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(lock);
    // An idempotent seed's ON CONFLICT re-insert of an existing private deck
    // must not count that very deck (BEFORE INSERT fires before the conflict).
    expect(body).toContain("and d.id <> new.id;");
    expect(body).toContain("if v_count >= v_cap then raise exception 'deck_capacity_exceeded");
    expect(body).toContain("errcode = 'check_violation'");
    // Unlimited plans return before the lock: no serialisation for them.
    expect(body.indexOf("if v_cap = -1 then return new;")).toBeLessThan(lock);
  });

  it("is SECURITY DEFINER with an empty search_path, like the helper", () => {
    expect(body).toContain("security definer set search_path = ''");
    expect(fn(DECKS, "deck_capacity_for")).toContain("security definer set search_path = ''");
  });

  it("states its grants: tooling may call the helper, end users may call neither (0104's)", () => {
    expect(DECKS).toContain("revoke all on function public.deck_capacity_for(uuid) from public, anon, authenticated;");
    expect(DECKS).toContain("grant execute on function public.deck_capacity_for(uuid) to service_role;");
    expect(DECKS).toContain("revoke all on function public.enforce_deck_capacity() from public, anon, authenticated;");
  });

  it("the app recognises the trigger's message", () => {
    expect(isDeckCapacityViolation("deck_capacity_exceeded: 1 of 1 private or unlisted decks")).toBe(true);
    expect(isDeckCapacityViolation("card_capacity_exceeded: 50 of 50 saved cards")).toBe(false);
    expect(isDeckCapacityViolation(null)).toBe(false);
  });
});

const free = (used: number): DeckCapacity => ({ used, cap: DECK_CAPACITY.free, tier: "free" });
const plus = (used: number): DeckCapacity => ({ used, cap: DECK_CAPACITY.plus, tier: "plus" });
const pro = (used: number): DeckCapacity => ({ used, cap: CARD_CAPACITY_UNLIMITED, tier: "pro" });

describe("the numbers", () => {
  it("remaining, over and full", () => {
    expect(remainingDeckCapacity(free(0))).toBe(1);
    expect(remainingDeckCapacity(free(3))).toBe(0);
    expect(remainingDeckCapacity(pro(40))).toBeNull();
    expect(overDeckCapacity(free(3))).toBe(2);
    expect(overDeckCapacity(free(1))).toBe(0);
    expect(overDeckCapacity(pro(40))).toBe(0);
    expect(deckCapacityFull(free(1))).toBe(true);
    expect(deckCapacityFull(plus(2))).toBe(false);
    expect(deckCapacityFull(pro(40))).toBe(false);
    expect(deckCapacityFull(null)).toBe(false);
  });

  it("only a capped visibility on a full plan is blocked — never a public deck, never a deck that already holds its slot", () => {
    expect(deckCapBlocks(free(1), "private")).toBe(true);
    expect(deckCapBlocks(free(1), "unlisted")).toBe(true);
    expect(deckCapBlocks(free(1), "public")).toBe(false);
    expect(deckCapBlocks(free(1), "unlisted", true)).toBe(false);
    expect(deckCapBlocks(free(0), "private")).toBe(false);
    expect(deckCapBlocks(pro(99), "private")).toBe(false);
    expect(deckCapBlocks(null, "private")).toBe(false);
  });
});

describe("the meter", () => {
  it("reads 'Private decks: N of M' and says where the plan stands, never repeating the numbers", () => {
    expect(deckUsageLabel(free(0))).toBe("Private decks: 0 of 1");
    expect(describeDeckUsage(free(0))).toEqual({ tone: "info", message: "1 left on Free. Public decks are unlimited." });
    expect(describeDeckUsage(plus(1))).toMatchObject({ tone: "info", message: "2 left on Plus. Public decks are unlimited." });
    // The last of several slots warns; Free's single slot is plain until used.
    expect(describeDeckUsage(plus(2))).toMatchObject({ tone: "warning", message: "1 left on Plus. Public decks are unlimited." });
    expect(describeDeckUsage(free(1))).toEqual({ tone: "danger", message: "All in use on Free. Public decks are unlimited." });
  });

  it("over the cap (a lapsed plan): the decks are safe and editable", () => {
    expect(deckUsageLabel(free(3))).toBe("Private decks: 3 of 1");
    expect(describeDeckUsage(free(3))?.message).toBe(
      "2 over Free's 1 — they're safe and stay editable, but a new private deck needs room. Public decks are unlimited.",
    );
  });

  it("says nothing on an unlimited plan or without a capacity", () => {
    expect(deckUsageLabel(pro(12))).toBeNull();
    expect(describeDeckUsage(pro(12))).toBeNull();
    expect(describeDeckUsage(null)).toBeNull();
  });
});

describe("before a deck is made or turned private", () => {
  it("says nothing for a public deck, an unlimited plan, room to spare, or a deck already counted", () => {
    expect(describeDeckCapacity(free(1), "public")).toBeNull();
    expect(describeDeckCapacity(pro(50), "private")).toBeNull();
    expect(describeDeckCapacity(plus(0), "private")).toBeNull();
    expect(describeDeckCapacity(free(1), "private", true)).toBeNull();
    expect(describeDeckCapacity(null, "private")).toBeNull();
  });

  it("warns on the last slot", () => {
    expect(describeDeckCapacity(free(0), "private")).toEqual({
      tone: "warning",
      message: "This uses your last private deck on Free (1 of 1). Public decks are unlimited.",
    });
    expect(describeDeckCapacity(plus(2), "unlisted")?.message).toContain("(3 of 3)");
  });

  it("at the cap names the three ways out", () => {
    const full = describeDeckCapacity(free(1), "unlisted");
    expect(full?.tone).toBe("danger");
    expect(full?.message).toBe(
      "Free includes 1 private or unlisted deck, and yours is in use. Make this deck public, or free a slot — make another deck public or delete one — or upgrade.",
    );
    expect(describeDeckCapacity(plus(3), "private")?.message).toContain("Plus includes 3 private or unlisted decks, and yours are in use.");
    expect(describeDeckCapacity(free(4), "private")?.message).toContain("You have 4 private or unlisted decks, more than Free's 1.");
  });

  it("the action's refusal says the same", () => {
    expect(deckCapacityRefusal({ cap: 1, tier: "free" })).toBe(
      "Free includes 1 private or unlisted deck, and yours is in use. Make this deck public, make another one public or delete it, or upgrade.",
    );
    // Billing off reads every entitlement as unlimited while the database
    // still holds the line (0104's posture): no number to quote.
    expect(deckCapacityRefusal(null)).toMatch(/^Your plan's private decks are all in use/);
  });
});
