# Chunk 14 — Server-Side Upload Byte Sniffing (M1)

## Goal

Today's upload flow validates `file.type` client-side and trusts
Supabase Storage's `allowed_mime_types` policy to enforce the declared
Content-Type. That stops obvious tricks like uploading a `.exe`, but a
client can still upload a non-image blob under `Content-Type: image/png`
because the bucket validates the declared header, not the bytes.

Close the M1 hardening item by adding server-side byte validation via
`sharp` before the file lands in storage.

## Scope

In scope:
- A new server action that accepts the upload, decodes the first bytes
  via `sharp`, rejects anything that isn't a real raster image, and
  uploads via the user's session.
- Re-encode optionally (Sharp can normalize JPEG → JPEG-optimized; we
  don't need to but it's cheap).
- The client uploader switches to call the new server action.

Out of scope:
- Image transforms (no resize / crop on upload).
- Animated GIF inspection beyond Sharp's default decode.
- SVG support (we never allowed SVG; this chunk keeps SVG rejected).
- Migrating the Scryfall art-import route to use Sharp — that route
  already host-locks the source and uses the Content-Type check; if we
  want byte sniffing there too, that's a small extension after this.

## Files to add / modify

- Package: add `sharp` to dependencies
- New: `lib/cards/upload-art-server.ts` — server-only upload action that
  takes a `FormData` with the file, validates via Sharp, uploads
- Modify: `components/creator/art-uploader.tsx`
  - Replace the client-side `uploadCardArt(file)` call with a
    `<form action={uploadCardArtServerAction}>` or an `await
    uploadCardArtServerAction(formData)` call
  - Same UX, different transport
- Deprecate: `lib/cards/upload-art.ts` — keep for now as a fallback,
  add a deprecation comment
- Optional: `lib/scryfall/import-art-validation.ts` — extracted Sharp
  validator the Scryfall route can also call

## Implementation approach

- Sharp is a native module — confirm it works on Vercel's Fluid
  Compute Node 24 runtime (it does, but the build needs the
  `sharp-libvips-linuxmusl-x64` etc. binaries Vercel ships).
- The server action signature:
  `uploadCardArtServerAction(formData: FormData): Promise<UploadArtResult>`
- Inside:
  1. Auth check via `getCurrentUser()`
  2. Pull the file from `formData.get("file")`
  3. Size check (8 MB)
  4. `await sharp(buffer).metadata()` — throws on non-images
  5. Confirm `metadata.format` is png/jpeg/webp/gif
  6. (Optional) re-encode at original format with sharp to strip EXIF
     metadata
  7. Upload to `card-art/{userId}/{uuid}.{ext}` via the user's session
- Client side: pass a `FormData` to the server action.

## Acceptance criteria

- Uploading a `.exe` renamed `.png` is rejected ("That doesn't look
  like an image").
- Uploading an SVG with embedded JS is rejected.
- Uploading a valid PNG / JPEG / WebP / GIF works as before.
- File size limit unchanged at 8 MB.
- Storage path layout unchanged.
- Existing card-art uploads still load.

## Dependencies

None. Could ship anytime.

## Estimated effort

~2 hours.

## Done when

Try to upload a text file renamed `evil.png` → rejected before the
network round-trip even reaches Supabase. Try a real PNG → works.
Pull a card you uploaded prior to this chunk → still loads.
