import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/media/storage-origin.ts — each deployment registers its OWN storage
// origin with its database (migration 0127's public.storage_origins), so the
// migration can list production's origins only (review 2026-09-29: the dev
// branch's host listed there made production trust dev's storage, and a
// seeded `https://*.supabase.co` made every preview trust any project's).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  upserts: [] as { table: string; row: unknown; options: unknown }[],
  error: null as null | { message: string },
  throws: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: async (row: unknown, options: unknown) => {
        if (state.throws) throw new Error("network");
        state.upserts.push({ table, row, options });
        return { error: state.error };
      },
    }),
  }),
}));

import {
  ensureStorageOriginRegistered,
  ownStorageOrigin,
  resetStorageOriginRegistrationForTests,
} from "@/lib/media/storage-origin";

beforeEach(() => {
  resetStorageOriginRegistrationForTests();
  state.configured = true;
  state.upserts.length = 0;
  state.error = null;
  state.throws = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ownStorageOrigin", () => {
  it("is the origin of NEXT_PUBLIC_SUPABASE_URL — scheme, host, a non-default port", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    expect(ownStorageOrigin()).toBe("https://auth.pipglyph.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ABCDEF.supabase.co/");
    expect(ownStorageOrigin()).toBe("https://abcdef.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(ownStorageOrigin()).toBe("http://127.0.0.1:54321");
    // Every origin it can return fits 0127's CHECK on storage_origins.origin.
    for (const origin of ["https://auth.pipglyph.com", "https://abcdef.supabase.co", "http://127.0.0.1:54321"]) {
      expect(origin).toMatch(/^https?:\/\/(\*\.)?[a-z0-9.-]+(:[0-9]{1,5})?$/);
    }
  });

  it("is null for a missing, malformed or non-http URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(ownStorageOrigin()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    expect(ownStorageOrigin()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "javascript:alert(1)");
    expect(ownStorageOrigin()).toBeNull();
  });
});

describe("ensureStorageOriginRegistered", () => {
  it("upserts this deployment's origin — never overwriting a row — once per process", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://znipzaxgpaiandwiqabn.supabase.co");
    await Promise.all([ensureStorageOriginRegistered(), ensureStorageOriginRegistered()]);
    await ensureStorageOriginRegistered();
    expect(state.upserts).toEqual([
      {
        table: "storage_origins",
        row: { origin: "https://znipzaxgpaiandwiqabn.supabase.co", note: expect.stringContaining("storage-origin.ts") },
        options: { onConflict: "origin", ignoreDuplicates: true },
      },
    ]);
  });

  it("only ever registers its OWN origin — nothing a caller passes, no wildcard", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    await ensureStorageOriginRegistered();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preview-ref.supabase.co");
    await ensureStorageOriginRegistered();
    expect(state.upserts.map((u) => (u.row as { origin: string }).origin)).toEqual([
      "http://127.0.0.1:54321",
      "https://preview-ref.supabase.co",
    ]);
    expect(ensureStorageOriginRegistered.length).toBe(0);
  });

  it("a failure never throws and is retried on the next write", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    state.error = { message: 'relation "public.storage_origins" does not exist' };
    await expect(ensureStorageOriginRegistered()).resolves.toBeUndefined();
    state.throws = true;
    await expect(ensureStorageOriginRegistered()).resolves.toBeUndefined();
    state.throws = false;
    state.error = null;
    await ensureStorageOriginRegistered();
    await ensureStorageOriginRegistered();
    expect(state.upserts).toHaveLength(2); // the failed one + the one that stuck
    expect(console.warn).toHaveBeenCalled();
  });

  it("does nothing without the service role or a storage URL", async () => {
    state.configured = false;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    await ensureStorageOriginRegistered();
    state.configured = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await ensureStorageOriginRegistered();
    expect(state.upserts).toEqual([]);
  });
});
