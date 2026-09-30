import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Migration 0126 (TODO 3.14a follow-up): a signed-in user can no longer write
// storage or a card's render pointer straight from the Supabase client. Both
// used to be possible with nothing but the page's own session, skipping the
// upload actions (byte sniff, metadata strip, moderation scan) and the
// watermarked bake:
//
//   * storage.objects: every user bucket had owner-folder INSERT / UPDATE /
//     DELETE policies — now there are none (uploads are server actions on
//     the service role, lib/media/user-storage.ts);
//   * cards.rendered_image_url / rendered_thumb_url / rendered_at /
//     layout_version: writable like any other column of your own card — now
//     cards_guard_render_columns lets an API role only clear them.
//
// Card art (TODO 6.10, migration 0131) is the one file a browser sends to
// Storage itself: too big for a Vercel Function's body, it goes to a signed
// URL the server mints for ONE object in the PRIVATE `card-art-incoming`
// bucket. The last test holds that bucket to it: no direct write, one
// object per token, nobody but the service role reads it back, and the
// bucket's own size / type limits apply.
//
// This runs the attack itself, with the seeded e2e user's real session over
// PostgREST / Storage (no browser needed). Needs the local stack
// (tests/README.md); CI boots one with every migration applied.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const email = process.env.SUPABASE_E2E_USER_EMAIL ?? "";
const password = process.env.SUPABASE_E2E_USER_PASSWORD ?? "";
const hasStack =
  Boolean(url && publishableKey && serviceKey && email && password) && /127\.0\.0\.1|localhost/.test(url);

// A 1×1 PNG — a real image, so a refusal can't be a MIME / size limit.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const USER_BUCKETS = ["card-art", "card-art-incoming", "card-exports", "set-covers", "card-renders", "profile-media", "custom-pips"];

test.describe("direct client writes (migration 0126)", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  let admin: SupabaseClient;
  let user: SupabaseClient;
  let userId = "";
  const run = `e2e-direct-${Date.now()}`;
  const created: { bucket: string; key: string }[] = [];
  let cardId: string | null = null;

  test.beforeAll(async () => {
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    user = createClient(url, publishableKey, { auth: { persistSession: false } });
    const { data, error } = await user.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(`Seed the e2e user first: ${error?.message ?? "no user"}`);
    userId = data.user.id;
  });

  test.afterAll(async () => {
    for (const bucket of USER_BUCKETS) {
      const keys = created.filter((o) => o.bucket === bucket).map((o) => o.key);
      if (keys.length > 0) await admin.storage.from(bucket).remove(keys);
    }
    if (cardId) await admin.from("cards").delete().eq("id", cardId);
    await user?.auth.signOut();
  });

  async function exists(bucket: string, name: string): Promise<boolean> {
    const { data } = await admin.storage.from(bucket).list(userId, { search: name });
    return (data ?? []).some((o) => o.name === name);
  }

  for (const bucket of USER_BUCKETS) {
    test(`${bucket}: the user's own session can't upload into their own folder`, async () => {
      const key = `${userId}/${run}.png`;
      created.push({ bucket, key });
      const { error } = await user.storage.from(bucket).upload(key, PNG, { contentType: "image/png" });
      expect(error, `a direct upload to ${bucket} must be refused`).not.toBeNull();
      // Storage words an RLS refusal "new row violates row-level security
      // policy" (403 Unauthorized).
      expect(error!.message).toMatch(/row-level security|unauthorized/i);
      expect(await exists(bucket, `${run}.png`)).toBe(false);
    });
  }

  test("card-renders: the user can't overwrite or delete their card's bake object", async () => {
    // A bake the server wrote (service role), in the user's folder — the
    // folder where the owner still holds a SELECT policy (0038), which is
    // what made their overwrite / delete resolve before 0126.
    const name = `${run}-bake.png`;
    const key = `${userId}/${name}`;
    created.push({ bucket: "card-renders", key });
    const seeded = await admin.storage.from("card-renders").upload(key, PNG, { contentType: "image/png" });
    expect(seeded.error).toBeNull();

    const overwrite = await user.storage
      .from("card-renders")
      .upload(key, PNG, { contentType: "image/png", upsert: true });
    expect(overwrite.error, "an upsert over the bake must be refused").not.toBeNull();

    // Storage answers a refused delete with an empty list, not an error:
    // the proof is that the object is still there.
    await user.storage.from("card-renders").remove([key]);
    expect(await exists("card-renders", name)).toBe(true);
  });

  test("card-art-incoming: a server-signed URL takes ONE object from the user; only the service role reads it", async () => {
    const bucket = "card-art-incoming";
    const png = () => new Blob([new Uint8Array(PNG)], { type: "image/png" });
    const sign = async (name: string) => {
      const key = `${userId}/${name}`;
      created.push({ bucket, key });
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(key);
      expect(error).toBeNull();
      return { key, token: data!.token };
    };

    // The user's own client PUTs to the URL the server minted — no policy,
    // just the token (what lib/cards/art-upload-client.ts does).
    const { key, token } = await sign(`${run}.upload`);
    const put = await user.storage.from(bucket).uploadToSignedUrl(key, token, png(), { contentType: "image/png" });
    expect(put.error).toBeNull();
    // Once: the same token can't overwrite it.
    const again = await user.storage.from(bucket).uploadToSignedUrl(key, token, png(), { contentType: "image/png" });
    expect(again.error, "a second PUT with the same token must be refused").not.toBeNull();
    // The service role (the finish action) reads what the user put.
    const staged = await admin.storage.from(bucket).download(key);
    expect(staged.error).toBeNull();
    expect(Buffer.from(await staged.data!.arrayBuffer()).equals(PNG)).toBe(true);
    // …which is why the finish action overwrites a consumed key with its
    // tombstone (service role, upsert) instead of deleting it: the key stays
    // occupied, so the token (valid 2 hours) can't put a second file there.
    const tomb = await admin.storage.from(bucket).upload(key, new TextEncoder().encode("consumed"), { upsert: true, contentType: "image/png" });
    expect(tomb.error).toBeNull();
    const replay = await user.storage.from(bucket).uploadToSignedUrl(key, token, png(), { contentType: "image/png" });
    expect(replay.error, "a PUT over the tombstone must be refused").not.toBeNull();
    // …nor reach another key.
    const elsewhere = await user.storage.from(bucket).uploadToSignedUrl(`${userId}/${run}-other.upload`, token, png(), { contentType: "image/png" });
    created.push({ bucket, key: `${userId}/${run}-other.upload` });
    expect(elsewhere.error, "a token is for its own key only").not.toBeNull();

    // Storage can't arbitrate finishes racing on one staged upload: racing
    // uploads of ONE key without upsert all succeed (seen here in CI, which
    // is why the finish's claim is in the database). Migration 0132's
    // claim_card_art_upload() answers true to exactly one caller per
    // (user, name) — the finish reads nothing without it.
    const claimName = `${run}.upload`;
    const claims = await Promise.all(
      Array.from({ length: 5 }, () => admin.rpc("claim_card_art_upload", { p_user_id: userId, p_staged_name: claimName })),
    );
    expect(claims.map((c) => c.error)).toEqual([null, null, null, null, null]);
    expect(claims.filter((c) => c.data === true), "exactly one racing claim may win").toHaveLength(1);
    expect((await admin.rpc("claim_card_art_upload", { p_user_id: userId, p_staged_name: claimName })).data).toBe(false);
    // …and it is the service role's alone: the user's session can neither
    // claim nor read the claims.
    expect((await user.rpc("claim_card_art_upload", { p_user_id: userId, p_staged_name: `${run}-mine.upload` })).error).not.toBeNull();
    expect((await user.from("card_art_upload_claims").select("staged_name")).error).not.toBeNull();
    await admin.from("card_art_upload_claims").delete().eq("user_id", userId).eq("staged_name", claimName);

    // Private: no public URL, no read or list with the user's own session.
    expect((await fetch(`${url}/storage/v1/object/public/${bucket}/${key}`)).ok).toBe(false);
    expect((await user.storage.from(bucket).download(key)).error).not.toBeNull();
    expect((await user.storage.from(bucket).list(userId)).data ?? []).toEqual([]);
    // The replay left the tombstone in place.
    const read = await admin.storage.from(bucket).download(key);
    expect(read.error).toBeNull();
    expect(Buffer.from(await read.data!.arrayBuffer()).toString()).toBe("consumed");

    // The bucket's own limits apply to a signed PUT: 20 MiB, image types only.
    const big = await sign(`${run}-big.upload`);
    const tooBig = await user.storage
      .from(bucket)
      .uploadToSignedUrl(big.key, big.token, new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }), { contentType: "image/png" });
    expect(tooBig.error, "over 20 MiB must be refused").not.toBeNull();
    const text = await sign(`${run}-text.upload`);
    const wrongType = await user.storage
      .from(bucket)
      .uploadToSignedUrl(text.key, text.token, new Blob(["<svg/>"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(wrongType.error, "a non-image type must be refused").not.toBeNull();
  });

  test("cards: the owner can clear their card's render pointer but never point it at a picture", async () => {
    const { data: system } = await admin.from("game_systems").select("id").limit(1).single();
    expect(system).toBeTruthy();
    const { data: card, error: insertError } = await admin
      .from("cards")
      .insert({ owner_id: userId, title: "Direct write probe", slug: run, game_system_id: system!.id })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    cardId = card!.id;
    const bake = `${url}/storage/v1/object/public/card-renders/${userId}/${cardId}.png?v=1`;
    // The server (service role) may set it — that's how every bake lands.
    const persisted = await admin
      .from("cards")
      .update({ rendered_image_url: bake, rendered_at: new Date().toISOString(), layout_version: 1 })
      .eq("id", cardId);
    expect(persisted.error).toBeNull();

    const attempts: Record<string, unknown>[] = [
      { rendered_thumb_url: "https://tracker.example/pixel.webp" },
      { rendered_image_url: `${url}/storage/v1/object/public/card-art/${userId}/raw-upload.png` },
      { rendered_at: new Date(Date.now() + 86_400_000).toISOString() },
      { layout_version: 999 },
    ];
    for (const patch of attempts) {
      const { error } = await user.from("cards").update(patch).eq("id", cardId);
      expect(error, `PATCH ${Object.keys(patch)[0]} must be refused`).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toMatch(/render_columns_server_only/);
    }
    const { data: after } = await admin
      .from("cards")
      .select("rendered_image_url, rendered_thumb_url, layout_version")
      .eq("id", cardId)
      .single();
    expect(after).toEqual({ rendered_image_url: bake, rendered_thumb_url: null, layout_version: 1 });

    // A new card can't be born with a render either.
    const born = await user
      .from("cards")
      .insert({
        owner_id: userId,
        title: "Born with a render",
        slug: `${run}-born`,
        game_system_id: system!.id,
        rendered_image_url: "https://tracker.example/pixel.png",
      })
      .select("id");
    // (Should it ever get through, don't leave it behind.)
    for (const row of born.data ?? []) await admin.from("cards").delete().eq("id", row.id);
    expect(born.error?.code).toBe("42501");

    // Clearing is allowed (a failed bake, going private): the card falls
    // back to the live preview.
    const cleared = await user
      .from("cards")
      .update({ rendered_image_url: null, rendered_thumb_url: null, rendered_at: null, layout_version: null })
      .eq("id", cardId)
      .select("id");
    expect(cleared.error).toBeNull();
    expect(cleared.data).toHaveLength(1);
  });
});
