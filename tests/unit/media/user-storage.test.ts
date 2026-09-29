import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/media/user-storage.ts — the one door into a user's storage folder since
// migration 0126 took every user write policy off storage.objects. It writes
// with the service role, so it must do what RLS used to: keep every key
// inside `{userId}/`, whatever name a caller (or stored data) hands it.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  clients: 0,
  buckets: [] as string[],
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    state.clients += 1;
    return {
      storage: {
        from: (bucket: string) => {
          state.buckets.push(bucket);
          return {
            upload: async (...args: unknown[]) => {
              state.calls.push({ op: "upload", args });
              return { data: null, error: null };
            },
            remove: async (...args: unknown[]) => {
              state.calls.push({ op: "remove", args });
              return { data: [], error: null };
            },
            copy: async (...args: unknown[]) => {
              state.calls.push({ op: "copy", args });
              return { data: { path: args[1] }, error: null };
            },
            getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${key}` } }),
          };
        },
      },
    };
  },
}));

import {
  fileNameInFolder,
  userFolder,
  userObjectPath,
} from "@/lib/media/user-storage";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

const BAD_NAMES = [
  "",
  `../${OTHER}/avatar.png`,
  `${OTHER}/avatar.png`,
  "nested/file.png",
  "..",
  "a..png",
  ".hidden.png",
  "-dash.png",
  "back\\slash.png",
  "space name.png",
  "%2e%2e%2fescape.png",
  "new\nline.png",
  "x".repeat(201),
];

beforeEach(() => {
  state.clients = 0;
  state.buckets.length = 0;
  state.calls.length = 0;
});

describe("userObjectPath", () => {
  it("is `{userId}/{name}` for a bare generated name", () => {
    for (const name of ["3f1c9f2e-0000-4000-8000-000000000000.jpg", "avatar-abc.png", "wm-x.webp", "W.png", "W.pending.png", "ai-1.jpg", "c.thumb.webp"]) {
      expect(userObjectPath(ME, name)).toBe(`${ME}/${name}`);
    }
  });

  it("refuses anything that could leave the folder or isn't a plain name", () => {
    for (const name of BAD_NAMES) {
      expect(() => userObjectPath(ME, name), JSON.stringify(name)).toThrow(/invalid file name/i);
    }
  });

  it("refuses an owner that isn't a uuid (never a folder named after request input)", () => {
    for (const owner of ["", "user-1", `${ME}/..`, "..", `${OTHER}/${ME}`]) {
      expect(() => userObjectPath(owner, "a.png"), owner).toThrow(/uuid/i);
    }
  });
});

describe("fileNameInFolder (paths read back from stored data)", () => {
  it("answers the name only for an object directly in the user's own folder", () => {
    expect(fileNameInFolder(ME, `${ME}/avatar-1.png`)).toBe("avatar-1.png");
    expect(fileNameInFolder(ME, `${OTHER}/avatar-1.png`)).toBeNull();
    expect(fileNameInFolder(ME, `${ME}/nested/avatar-1.png`)).toBeNull();
    expect(fileNameInFolder(ME, `${ME}/../${OTHER}/avatar-1.png`)).toBeNull();
    expect(fileNameInFolder(ME, `${ME}x/avatar-1.png`)).toBeNull();
    expect(fileNameInFolder(ME, `${ME}/`)).toBeNull();
    expect(fileNameInFolder(ME, "avatar-1.png")).toBeNull();
    expect(fileNameInFolder("not-a-uuid", "not-a-uuid/avatar-1.png")).toBeNull();
  });
});

describe("userFolder", () => {
  it("writes, removes and links inside `{userId}/` with the service-role client", async () => {
    const folder = userFolder("profile-media", ME);
    expect(await folder.upload("avatar-1.png", new Uint8Array([1]), { contentType: "image/png", upsert: false })).toEqual({ error: null });
    expect(await folder.remove(["avatar-0.png", "avatar-1.png"])).toEqual({ error: null });
    expect(folder.publicUrl("avatar-1.png")).toBe(`https://storage.test/profile-media/${ME}/avatar-1.png`);
    expect(folder.path("avatar-1.png")).toBe(`${ME}/avatar-1.png`);

    expect(state.clients).toBe(1);
    expect(state.buckets).toEqual(["profile-media"]);
    expect(state.calls).toEqual([
      { op: "upload", args: [`${ME}/avatar-1.png`, new Uint8Array([1]), { contentType: "image/png", upsert: false }] },
      { op: "remove", args: [[`${ME}/avatar-0.png`, `${ME}/avatar-1.png`]] },
    ]);
  });

  it("answers an invalid name with an error and never reaches storage", async () => {
    const folder = userFolder("card-art", ME);
    for (const name of BAD_NAMES) {
      expect(await folder.upload(name, new Uint8Array([1]), {}), JSON.stringify(name)).toEqual({
        error: { message: "Invalid storage path." },
      });
      // One bad name poisons the whole remove — nothing is deleted.
      expect(await folder.remove(["ok.png", name])).toEqual({ error: { message: "Invalid storage path." } });
    }
    expect(state.calls).toEqual([]);
    expect(state.clients).toBe(0);
  });

  it("a folder for a non-uuid owner can't write anything", async () => {
    const folder = userFolder("card-art", "user-1");
    expect((await folder.upload("a.png", new Uint8Array([1]), {})).error).not.toBeNull();
    expect((await folder.remove(["a.png"])).error).not.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("an empty remove makes no request", async () => {
    expect(await userFolder("custom-pips", ME).remove([])).toEqual({ error: null });
    expect(state.calls).toEqual([]);
  });
});

// A remix save gives the remixer their own copy of the parent's pictures
// (lib/cards/remix-media.ts, migration 0127): the SOURCE may be any user's
// object (read from stored data), the copy always lands in `{userId}/`.
describe("userFolder.copyIn", () => {
  it("copies another user's object into the caller's own folder", async () => {
    expect(await userFolder("card-art", ME).copyIn(`${OTHER}/front.jpg`, "remix-1.jpg")).toEqual({ error: null });
    expect(state.buckets).toEqual(["card-art"]);
    expect(state.calls).toEqual([{ op: "copy", args: [`${OTHER}/front.jpg`, `${ME}/remix-1.jpg`] }]);
  });

  it("refuses a bad destination name, a nested or traversing source, and a non-uuid source folder", async () => {
    const folder = userFolder("card-art", ME);
    for (const name of BAD_NAMES) {
      expect(await folder.copyIn(`${OTHER}/front.jpg`, name), JSON.stringify(name)).toEqual({
        error: { message: "Invalid storage path." },
      });
    }
    for (const source of [
      `${OTHER}/nested/front.jpg`,
      `${OTHER}/../${ME}/x.jpg`,
      "front.jpg",
      "not-a-uuid/front.jpg",
      `${OTHER}/`,
      `${OTHER}/..`,
    ]) {
      expect(await folder.copyIn(source, "remix-1.jpg"), source).toEqual({ error: { message: "Invalid storage path." } });
    }
    expect(await userFolder("card-art", "user-1").copyIn(`${OTHER}/front.jpg`, "a.jpg")).toEqual({
      error: { message: "Invalid storage path." },
    });
    expect(state.calls).toEqual([]);
    expect(state.clients).toBe(0);
  });
});
