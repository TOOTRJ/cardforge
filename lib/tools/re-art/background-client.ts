// ---------------------------------------------------------------------------
// The browser's side of stopping the SERVER's part of a Re-art run (0218).
// No imports: it is loaded with the studio.
// ---------------------------------------------------------------------------

export const REART_STOP_BACKGROUND_ENDPOINT = "/api/tools/re-art-deck/stop-background";

/**
 * Asks the server to stop carrying a run. `keepalive`: the request is sent
 * even if the tab is closed right after the press. Tried once more when the
 * network or the server failed; a refusal (the tool closed, signed out) is
 * not asked again. True only when the server said it stopped.
 */
export async function requestReartBackgroundStop(jobId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(REART_STOP_BACKGROUND_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
        keepalive: true,
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
        if (body?.ok === true) return true;
      }
      if (response.status < 500) return false;
    } catch {
      // The network: once more.
    }
  }
  return false;
}
