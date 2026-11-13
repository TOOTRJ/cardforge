import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralLadder } from "@/components/referrals/referral-ladder";
import { buildLadderView } from "@/lib/referrals/ladder-view";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The Refer a friend page's ladder, drawn (owner 2026-11-11: "more flashy… a
// chart or animation"): a staircase on a wide column, rows on a phone — ONE
// list either way, whose words say everything the picture shows, and whose
// motion never runs for a reader who asked for none.
// ---------------------------------------------------------------------------

const settings = DEFAULT_REFERRAL_SETTINGS;
const html = (earned: number, s = settings) =>
  renderToStaticMarkup(
    <ReferralLadder
      view={buildLadderView(s, earned)}
      progress={{ rewardsEarned: earned, ladderLength: s.ladder.length, nextRewardPhrase: buildLadderView(s, earned).nextPhrase, pastLadder: earned >= s.ladder.length }}
    />,
  );
const words = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
/** The list's items, each as its words. */
const items = (markup: string) => {
  const list = /<ol[^>]*aria-label="Rewards by referral"[^>]*>([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? "";
  return list.split("</li>").filter((li) => li.includes("<li")).map(words);
};

describe("ReferralLadder", () => {
  it("is ONE named list: a step per referral, each saying its number, its state and its reward — then the tail", () => {
    const list = items(html(2));
    expect(list).toHaveLength(11);
    expect(list[0]).toContain("Referral 1, earned: 7 free days");
    expect(list[1]).toContain("Referral 2, earned: 5 AI credits");
    expect(list[2]).toContain("Referral 3, next: 7 free days");
    expect(list[3]).toContain("Referral 4: 10 AI credits");
    expect(list[9]).toContain("Referral 10: 30 free days");
    expect(list[10]).toContain("Referral 11 and every one after: 7 free days each");
  });

  it("the three figures: earned so far, the next referral, still on the ladder", () => {
    const out = html(4);
    expect(words(out)).toContain("Earned so far14 free days and 15 AI credits");
    expect(words(out)).toContain("Your next referral14 free days");
    expect(words(out)).toContain("Still on the ladder86 free days and 70 AI credits");
    expect(words(html(0))).toContain("Earned so farnothing yet");
    const done = words(html(10));
    expect(done).toContain("Every further referral7 free days");
    expect(done).toContain("Still on the ladderAll of it earned");
  });

  it("every column's height is the view's, inline, and the picture is hidden from a screen reader (the words are the list)", () => {
    const out = html(3);
    const heights = [...out.matchAll(/style="height:(\d+)%/g)].map((m) => Number(m[1]));
    expect(heights).toEqual(buildLadderView(settings, 3).steps.map((s) => s.heightPct));
    // Each stair box, its gain label and the legend are aria-hidden.
    expect(out.match(/class="relative hidden h-44 items-end @lg:flex" aria-hidden="true"/g)).toHaveLength(10);
    expect(out).toMatch(/<p class="hidden[^"]*@lg:flex[^"]*" aria-hidden="true">/);
  });

  it("the earned steps carry a tick, the others their number; the next one is the only one that breathes", () => {
    const out = html(3);
    expect(out.match(/lucide-check/g)).toHaveLength(3);
    expect(out.match(/ladder-next/g)).toHaveLength(1);
    // An element runs one animation: the breathing step does not also rise.
    const next = /<div class="([^"]*ladder-next[^"]*)"/.exec(out)?.[1] ?? "";
    expect(next).not.toContain("ladder-rise");
    expect(out.match(/ladder-rise/g)).toHaveLength(9);
  });

  it("motion is opt-in for the reader: every animation is behind motion-safe, and both keyframes exist", () => {
    const out = html(3);
    for (const [cls] of out.matchAll(/[\w:-]*animate-\[[^\]]+\]/g)) expect(cls.startsWith("motion-safe:")).toBe(true);
    const source = readFileSync(join(process.cwd(), "components/referrals/referral-ladder.tsx"), "utf8");
    expect(source.match(/animate-\[/g)?.length).toBe(source.match(/motion-safe:animate-\[/g)?.length);
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("@keyframes ladder-rise");
    expect(css).toContain("@keyframes ladder-next");
  });

  it("the steps rise one after another: each earned or coming column starts later than the one before it", () => {
    const delays = [...html(0).matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([70, 140, 210, 280, 350, 420, 490, 560, 630]);
  });

  it("a phone gets the thin progress bar and the rows; the staircase and its legend only from the container's own width", () => {
    const out = html(2);
    expect(out).toMatch(/<div class="@container /);
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuenow="2"/);
    expect(out).toMatch(/<div class="flex flex-col gap-1\.5 @lg:hidden">/);
    // The sentence is the page's, beside the heading: here the bar keeps it
    // as its name and does not print it a second time.
    expect(out).toMatch(/role="progressbar" aria-label="2 of 10 referrals rewarded — next: 7 free days\."/);
    expect(out.match(/2 of 10 referrals rewarded/g)).toHaveLength(1);
    expect(out).toContain("grid-cols-2");
    expect(out).toContain("@lg:grid-cols-[repeat(var(--ladder-steps),minmax(0,1fr))_minmax(0,1fr)]");
    expect(out).toContain("--ladder-steps:10");
  });

  it("the staircase has room above it: the tallest step's label sits ABOVE its column, so it must not touch the figures (owner 2026-11-13)", () => {
    const list = /<ol[^>]*aria-label="Rewards by referral"[^>]*>/.exec(html(0))?.[0] ?? "";
    // Only at the staircase's size: the phone's rows keep their own spacing.
    expect(list).toMatch(/class="[^"]*@lg:pt-7[^"]*"/);
    expect(list).not.toMatch(/class="[^"]*(?:^|\s)pt-\d/);
    // The label is placed over its column's top, so the last step's is over the box's.
    expect(html(0)).toContain("bottom:calc(100% + 0.25rem)");
  });

  it("the gain above a column is an icon and a number — days and credits by their own icon, never colour alone", () => {
    const out = html(0);
    expect(out.match(/lucide-calendar-days/g)).toHaveLength(6);
    expect(out.match(/lucide-sparkles/g)).toHaveLength(4);
  });

  it("an empty ladder draws the tail alone, and a step that gives nothing has no gain", () => {
    const empty = html(0, { ...settings, ladder: [] });
    expect(items(empty)).toEqual([expect.stringContaining("Referral 1 and every one after: 7 free days each")]);
    const none = html(0, { ...settings, ladder: [{ kind: "none" }, { kind: "days", days: 7 }] });
    expect(items(none)[0]).toContain("Referral 1, next: nothing");
    expect(none.match(/lucide-calendar-days/g)).toHaveLength(1);
  });
});

describe("the Refer a friend page's frame", () => {
  const page = readFileSync(join(process.cwd(), "app/(app)/dashboard/referrals/page.tsx"), "utf8");

  it("is the dashboard's wide frame — never capped at a page of forms' width", () => {
    expect(page).toMatch(/<DashboardShell>/);
    expect(page).not.toMatch(/<DashboardShell\s+readable/);
    expect(page).not.toMatch(/max-w-(?:3xl|4xl|5xl|6xl|7xl)/);
  });

  it("extra width is a second column: the link, then the main column, then the rest of the rail — placed, not reordered in the markup", () => {
    const link = page.indexOf('aria-labelledby="referral-link"');
    const main = page.indexOf("xl:col-start-1 xl:row-span-2 xl:row-start-1");
    const rail = page.indexOf('<aside className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-2"');
    expect(link).toBeGreaterThan(0);
    expect(main).toBeGreaterThan(link);
    expect(rail).toBeGreaterThan(main);
    expect(page).toContain("xl:grid-cols-[minmax(0,1fr)_22rem]");
    // One column below xl, and every column may shrink (nothing scrolls sideways).
    expect(page).toContain('"mt-8 grid grid-cols-1 gap-6');
    expect(page.match(/min-w-0/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("draws the ladder with the staircase component, from the settings and the viewer's rewarded count", () => {
    expect(page).toContain("<ReferralLadder view={buildLadderView(settings, summary.rewardsEarned)} progress={progress} />");
    expect(page).not.toContain("LadderProgressBar");
  });
});
