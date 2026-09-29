import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Migration 0127 (TODO 3.14b): every user-media URL column holds only OUR
// storage objects in the writer's own folder (or a built-in image / a
// Scryfall printing image where the product stores one). Before it, the
// owner could PATCH any of them through PostgREST at any https URL — an
// outside picture that skipped the strip and the moderation scan, drawn by
// every public surface that shows it.
//
// This runs the attack with the seeded e2e user's real session over
// PostgREST, per column: their own folder passes, another user's folder and
// an outside host are refused (42501, `media_url_not_allowed`), keeping the
// current value or clearing it passes, and the service role is unrestricted.
// It also checks the signup-metadata avatar, a card's back face
// (cards_guard_back_card) and the upload rate limit (hit_upload_limit:
// sliding windows, the bounded prune). Needs the local stack
// (tests/README.md); CI boots one with every migration applied. The local
// origin is registered in public.storage_origins the way the app does it
// before its first upload (lib/media/storage-origin.ts) — no seed lists one.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const email = process.env.SUPABASE_E2E_USER_EMAIL ?? "";
const password = process.env.SUPABASE_E2E_USER_PASSWORD ?? "";
const hasStack =
  Boolean(url && publishableKey && serviceKey && email && password) && /127\.0\.0\.1|localhost/.test(url);

const OTHER = "99999999-9999-4999-8999-999999999999";
const OUTSIDE = "https://tracker.example/pixel.gif";
const SCRYFALL = "https://cards.scryfall.io/normal/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg?1562404626";

test.describe("media URL columns (migration 0127)", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  let admin: SupabaseClient;
  let user: SupabaseClient;
  let userId = "";
  let gameSystemId = "";
  const run = `e2e-media-${Date.now()}`;
  const cleanup: (() => PromiseLike<unknown>)[] = [];

  /** A public object URL in `bucket`, in `owner`'s folder. */
  const object = (bucket: string, owner: string, name = `${run}.png`) =>
    `${url}/storage/v1/object/public/${bucket}/${owner}/${name}`;

  test.beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    user = createClient(url, publishableKey, { auth: { persistSession: false } });
    const { data, error } = await user.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(`Seed the e2e user first: ${error?.message ?? "no user"}`);
    userId = data.user.id;
    const { data: system } = await admin.from("game_systems").select("id").limit(1).single();
    gameSystemId = system!.id;
    // What the app does before its first user-folder write.
    const registered = await admin
      .from("storage_origins")
      .upsert({ origin: new URL(url).origin, note: "e2e (as lib/media/storage-origin.ts)" }, { onConflict: "origin", ignoreDuplicates: true });
    expect(registered.error).toBeNull();
  });

  test.afterAll(async () => {
    for (const undo of cleanup.reverse()) await undo();
    await user?.auth.signOut();
  });

  /** PATCH `values` as the signed-in user; the refusal (if any). The row
   *  must be there to change (RLS silently matching nothing isn't a pass). */
  async function patch(table: string, values: Record<string, unknown>, match: Record<string, string>) {
    const { data, error } = await user.from(table).update(values).match(match).select("id");
    if (!error) expect(data, `${table} ${JSON.stringify(match)} matched a row`).toHaveLength(1);
    return error;
  }

  function expectRefused(error: { code?: string; message: string } | null, what: string) {
    expect(error, `${what} must be refused`).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message).toMatch(/media_url_not_allowed/);
  }

  test("cards: art, second-face art, watermark and set icon only from the owner's own folder", async () => {
    const { data: card, error } = await admin
      .from("cards")
      .insert({ owner_id: userId, title: "Media guard probe", slug: run, game_system_id: gameSystemId })
      .select("id")
      .single();
    expect(error).toBeNull();
    cleanup.push(() => admin.from("cards").delete().eq("id", card!.id));
    const match = { id: card!.id };

    const columns: { label: string; ok: Record<string, unknown>; bad: Record<string, unknown>[] }[] = [
      {
        label: "art_url",
        ok: { art_url: object("card-art", userId) },
        bad: [
          { art_url: object("card-art", OTHER) },
          { art_url: OUTSIDE },
          { art_url: `https://tracker.example/storage/v1/object/public/card-art/${userId}/x.png` },
          { art_url: object("profile-media", userId) },
        ],
      },
      {
        label: "back_face.art_url",
        ok: { back_face: { title: "Back", art_url: object("card-art", userId, "back.png") } },
        bad: [
          { back_face: { title: "Back", art_url: object("card-art", OTHER, "back.png") } },
          { back_face: { title: "Back", art_url: OUTSIDE } },
        ],
      },
      {
        label: "watermark.url",
        ok: { watermark: { kind: "custom", url: object("card-art", userId, "wm-1.png") } },
        bad: [
          { watermark: { kind: "custom", url: object("card-art", OTHER, "wm-1.png") } },
          { watermark: { kind: "custom", url: OUTSIDE } },
        ],
      },
      {
        label: "set_icon_url",
        ok: { set_icon_url: object("set-covers", userId, "icon.png") },
        bad: [{ set_icon_url: object("set-covers", OTHER, "icon.png") }, { set_icon_url: OUTSIDE }],
      },
    ];

    for (const column of columns) {
      for (const values of column.bad) expectRefused(await patch("cards", values, match), `cards ${column.label}`);
      expect(await patch("cards", column.ok, match), `own ${column.label}`).toBeNull();
    }

    // A value written before 0127 (the service role still may) is kept by an
    // edit that doesn't touch it, and by a save that sends it back unchanged.
    expect((await admin.from("cards").update({ art_url: OUTSIDE }).eq("id", card!.id)).error).toBeNull();
    expect(await patch("cards", { title: "Renamed" }, match)).toBeNull();
    expect(await patch("cards", { art_url: OUTSIDE, title: "Renamed again" }, match)).toBeNull();
    // Clearing is always allowed.
    expect(await patch("cards", { art_url: null, back_face: null, watermark: null, set_icon_url: null }, match)).toBeNull();

    // A new card can't be born with an outside or borrowed picture either.
    for (const art of [OUTSIDE, object("card-art", OTHER)]) {
      const born = await user
        .from("cards")
        .insert({ owner_id: userId, title: "Born with art", slug: `${run}-born`, game_system_id: gameSystemId, art_url: art })
        .select("id");
      for (const row of born.data ?? []) await admin.from("cards").delete().eq("id", row.id);
      expectRefused(born.error, "a card born with that art");
    }
  });

  test("profiles: own uploads and built-in images only; the service role is unrestricted", async () => {
    const { data: before } = await admin.from("profiles").select("avatar_url, banner_url").eq("id", userId).single();
    cleanup.push(() => admin.from("profiles").update(before!).eq("id", userId));
    const match = { id: userId };

    for (const values of [
      { avatar_url: OUTSIDE },
      { avatar_url: object("profile-media", OTHER, "avatar-x.png") },
      { avatar_url: "https://lh3.googleusercontent.com/a/forged=s96-c" },
      { avatar_url: "/defaults/avatars/avatar-26.webp" },
      { banner_url: OUTSIDE },
      { banner_url: "/defaults/avatars/avatar-01.webp" },
    ]) {
      expectRefused(await patch("profiles", values, match), `profiles ${Object.keys(values)[0]}`);
    }
    expect(await patch("profiles", { avatar_url: object("profile-media", userId, "avatar-x.png") }, match)).toBeNull();
    expect(await patch("profiles", { avatar_url: "/defaults/avatars/avatar-07.webp", banner_url: "/defaults/banners/banner-07.webp" }, match)).toBeNull();
    expect((await admin.from("profiles").update({ banner_url: OUTSIDE }).eq("id", userId)).error).toBeNull();
    expect(await patch("profiles", { bio: `${run}` }, match)).toBeNull();
  });

  test("decks, custom pips and deck entries", async () => {
    const { data: deck, error } = await admin
      .from("decks")
      .insert({ owner_id: userId, title: "Media guard deck", slug: run, format: "casual", visibility: "private" })
      .select("id")
      .single();
    expect(error).toBeNull();
    cleanup.push(() => admin.from("decks").delete().eq("id", deck!.id));

    // Deck cover: an upload (set-covers) or an AI cover (card-art) of their own.
    for (const cover of [OUTSIDE, object("set-covers", OTHER)]) {
      expectRefused(await patch("decks", { cover_url: cover }, { id: deck!.id }), "a deck cover");
    }
    expect(await patch("decks", { cover_url: object("set-covers", userId) }, { id: deck!.id })).toBeNull();
    expect(await patch("decks", { cover_url: object("card-art", userId, "ai-cover.jpg") }, { id: deck!.id })).toBeNull();

    // A deck entry's printing image: Scryfall's CDN only.
    const entry = await user
      .from("deck_cards")
      .insert({ deck_id: deck!.id, name: "Llanowar Elves", quantity: 1, board: "main", image_url: SCRYFALL })
      .select("id")
      .single();
    expect(entry.error).toBeNull();
    for (const image of [OUTSIDE, object("card-art", userId)]) {
      expectRefused(await patch("deck_cards", { image_url: image }, { id: entry.data!.id }), "a deck entry image");
    }
    expect(await patch("deck_cards", { quantity: 2 }, { id: entry.data!.id })).toBeNull();

    // Custom pips: their own custom-pips folder, versioned — the save
    // action's upsert path.
    cleanup.push(() => admin.from("custom_pips").delete().eq("owner_id", userId).eq("symbol", "C"));
    const pip = (image: string) =>
      user.from("custom_pips").upsert({ owner_id: userId, symbol: "C", image_url: image }, { onConflict: "owner_id,symbol" });
    expect((await pip(`${object("custom-pips", userId, "C.png")}?v=${Date.now()}`)).error).toBeNull();
    expectRefused((await pip(OUTSIDE)).error, "a custom pip");
    expectRefused((await pip(object("custom-pips", OTHER, "C.png"))).error, "another user's pip");
  });

  test("signup metadata: an email signup never brings its own avatar — not even a Google-hosted one", async () => {
    // Any email signup can send user metadata. A Google-hosted URL (the host
    // also serves any Google Photos image) was kept before the provider
    // check (review 2026-09-29); only a Google SIGN-IN keeps its picture.
    for (const [i, avatar] of [OUTSIDE, "https://lh3.googleusercontent.com/a/forged-account-shape=s96-c"].entries()) {
      const forged = await admin.auth.admin.createUser({
        email: `${run}-${i}@example.test`,
        password: `${run}-Pw!9`,
        email_confirm: true,
        user_metadata: { avatar_url: avatar },
      });
      expect(forged.error).toBeNull();
      const id = forged.data.user!.id;
      cleanup.push(() => admin.auth.admin.deleteUser(id));
      const { data: profile } = await admin.from("profiles").select("avatar_url").eq("id", id).single();
      expect(profile!.avatar_url, avatar).toMatch(/^\/defaults\/avatars\/avatar-\d{2}\.webp$/);
    }
  });

  test("a card's back face: only another of the owner's own cards", async () => {
    const mk = async (owner: string, title: string) => {
      const { data, error } = await admin
        .from("cards")
        .insert({ owner_id: owner, title, slug: `${run}-${title.toLowerCase().replaceAll(" ", "-")}`, game_system_id: gameSystemId })
        .select("id")
        .single();
      expect(error).toBeNull();
      cleanup.push(() => admin.from("cards").delete().eq("id", data!.id));
      return data!.id as string;
    };
    const created = await admin.auth.admin.createUser({ email: `${run}-other@example.test`, password: `${run}-Pw!9`, email_confirm: true });
    expect(created.error).toBeNull();
    const other = created.data.user!.id;
    cleanup.push(() => admin.auth.admin.deleteUser(other));

    const front = await mk(userId, "Front face");
    const ownBack = await mk(userId, "Own back");
    const theirs = await mk(other, "Their card");

    const refused = await patch("cards", { back_card_id: theirs }, { id: front });
    expectRefusedBack(refused, "another user's card");
    expect(refused!.message).toMatch(/back_card_not_allowed/);
    expectRefusedBack(await patch("cards", { back_card_id: front }, { id: front }), "itself");
    expect(await patch("cards", { back_card_id: ownBack }, { id: front })).toBeNull();
    expect(await patch("cards", { title: "Front face, renamed" }, { id: front })).toBeNull(); // kept
    expect(await patch("cards", { back_card_id: null }, { id: front })).toBeNull(); // cleared
    // A new card can't be born pointing at someone else's either.
    const born = await user
      .from("cards")
      .insert({ owner_id: userId, title: "Born flipped", slug: `${run}-born-flipped`, game_system_id: gameSystemId, back_card_id: theirs })
      .select("id");
    for (const row of born.data ?? []) await admin.from("cards").delete().eq("id", row.id);
    expect(born.error?.code).toBe("42501");
    // The service role is unrestricted.
    expect((await admin.from("cards").update({ back_card_id: theirs }).eq("id", front)).error).toBeNull();

    function expectRefusedBack(error: { code?: string; message: string } | null, what: string) {
      expect(error, what).not.toBeNull();
      expect(error!.code).toBe("42501");
    }
  });

  test("the upload rate limit: sliding windows per user, refusals uncounted, admins exempt, a bounded prune", async () => {
    const created = await admin.auth.admin.createUser({
      email: `${run}-limit@example.test`,
      password: `${run}-Pw!9`,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    cleanup.push(() => admin.auth.admin.deleteUser(id));

    type Hit = { allowed: boolean; retry_after_seconds: number; limited_by: string | null };
    const hit = async (who: string, perMinute: number, perDay = 300): Promise<Hit> => {
      const { data, error } = await admin.rpc("hit_upload_limit", { p_user_id: who, p_per_minute: perMinute, p_per_day: perDay });
      expect(error).toBeNull();
      return (data as Hit[])[0];
    };
    const count = async (who: string) =>
      (await admin.from("upload_hits").select("*", { count: "exact", head: true }).eq("user_id", who)).count;
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

    // 3 a minute: the 4th is refused, and not counted.
    for (let i = 0; i < 3; i += 1) expect((await hit(id, 3)).allowed).toBe(true);
    const fourth = await hit(id, 3);
    expect(fourth).toMatchObject({ allowed: false, limited_by: "minute" });
    expect(fourth.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(fourth.retry_after_seconds).toBeLessThanOrEqual(60);
    expect(await count(id)).toBe(3);

    // SLIDING: three hits 50 s ago still fill the last 60 seconds — a
    // calendar minute would have let a new burst through at the boundary —
    // and the wait is until the oldest of them is 60 s old.
    await admin.from("upload_hits").delete().eq("user_id", id);
    await admin.from("upload_hits").insert([ago(50), ago(49), ago(48)].map((t) => ({ user_id: id, hit_at: t })));
    const slid = await hit(id, 3);
    expect(slid).toMatchObject({ allowed: false, limited_by: "minute" });
    // ~10 s (the runner's clock and the database's share a host; a margin
    // for the round trips).
    expect(slid.retry_after_seconds).toBeGreaterThanOrEqual(5);
    expect(slid.retry_after_seconds).toBeLessThanOrEqual(15);
    // …and 61 s ago is outside the minute, inside the day.
    await admin.from("upload_hits").delete().eq("user_id", id);
    await admin.from("upload_hits").insert([ago(61), ago(62), ago(63)].map((t) => ({ user_id: id, hit_at: t })));
    expect((await hit(id, 3)).allowed).toBe(true);
    const daily = await hit(id, 3, 4);
    expect(daily).toMatchObject({ allowed: false, limited_by: "day" });
    expect(daily.retry_after_seconds).toBeGreaterThan(23 * 3600);

    // The prune: rows the day no longer reads go — anyone's, a bounded batch.
    await admin.from("upload_hits").insert({ user_id: id, hit_at: ago(25 * 3600) });
    const other = await admin.auth.admin.createUser({ email: `${run}-limit2@example.test`, password: `${run}-Pw!9`, email_confirm: true });
    expect(other.error).toBeNull();
    cleanup.push(() => admin.auth.admin.deleteUser(other.data.user!.id));
    expect((await hit(other.data.user!.id, 30)).allowed).toBe(true);
    const { data: stale } = await admin.from("upload_hits").select("hit_at").eq("user_id", id).lt("hit_at", ago(24 * 3600));
    expect(stale).toEqual([]);

    // The seeded e2e user is an admin: never refused, never counted.
    for (let i = 0; i < 3; i += 1) expect((await hit(userId, 1)).allowed).toBe(true);
    expect(await count(userId)).toBe(0);

    // The API roles can't call it or read the counters.
    const { error: direct } = await user.rpc("hit_upload_limit", { p_user_id: userId, p_per_minute: 30, p_per_day: 300 });
    expect(direct).not.toBeNull();
    const { data: rows } = await user.from("upload_hits").select("user_id");
    expect(rows ?? []).toEqual([]);
  });
});
