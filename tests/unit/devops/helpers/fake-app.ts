import { createServer, type Server } from "node:http";

// ---------------------------------------------------------------------------
// A stand-in for the APP's admin endpoint (POST /api/admin/storage-sweep,
// app/api/admin/storage-sweep/route.ts) for the owner-run storage script's
// tests: checks the bearer like cronRouteGuard, answers the three ops,
// records every call. `supabaseHost` is the database the fake claims to talk
// to (the script refuses an app on another one); `onFlaggedFile` decides each
// row action's outcome (default: done).
// ---------------------------------------------------------------------------

export type AppCall = { op: string; auth: string | undefined; body: Record<string, unknown> };
export type RowAction = { kind: string; [key: string]: unknown };
export type RowOutcome = { action: RowAction; status: string; detail: string };

export type FakeAppOptions = {
  secret: string;
  supabaseHost: () => string;
  vercel?: boolean;
  onFlaggedFile?: (file: { bucket: string; path: string }, actions: RowAction[]) => RowOutcome[];
  /** Answer purge-cards with this status (default 200). */
  purgeStatus?: () => number;
};

export function fakeApp(options: FakeAppOptions): Server & { calls: AppCall[] } {
  const calls: AppCall[] = [];
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(parts).toString() || "{}");
      } catch {
        return send(400, { ok: false, error: "The body must be JSON." });
      }
      calls.push({ op: String(body.op), auth: req.headers.authorization, body });
      if (req.method !== "POST" || req.url !== "/api/admin/storage-sweep") return send(404, { ok: false, error: "no route" });
      if (req.headers.authorization !== `Bearer ${options.secret}`) return send(401, { ok: false, error: "Unauthorized" });
      const where = { supabaseHost: options.supabaseHost(), vercel: options.vercel ?? true };
      if (body.op === "whoami") return send(200, { ok: true, ...where });
      if (body.op === "purge-cards") {
        const status = options.purgeStatus?.() ?? 200;
        if (status !== 200) return send(status, { ok: false, error: "purge refused" });
        return send(200, { ok: true, ...where, purged: (body.cardIds as string[]).length });
      }
      if (body.op === "flagged-file") {
        const actions = body.actions as RowAction[];
        const results =
          options.onFlaggedFile?.(body.file as { bucket: string; path: string }, actions) ??
          actions.map((action) => ({ action, status: "done", detail: "ok" }));
        return send(200, { ok: true, ...where, results });
      }
      return send(400, { ok: false, error: "unknown op" });
    });
  });
  return Object.assign(server, { calls });
}
