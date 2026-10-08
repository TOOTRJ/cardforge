import { describe, expect, it } from "vitest";
import { claimNotificationStream } from "@/lib/notifications/stream-claim";

// ---------------------------------------------------------------------------
// The queue behind RealtimeAlerts: one running stream per user, and a
// hand-over that stops the old stream BEFORE it starts the next — the
// Realtime client keeps one channel per topic, so a start that ran first
// would be handed the channel that is about to be removed.
// ---------------------------------------------------------------------------

function recorder() {
  const log: string[] = [];
  const stream = (name: string) => () => {
    log.push(`start ${name}`);
    return () => {
      log.push(`stop ${name}`);
    };
  };
  return { log, stream };
}

describe("claimNotificationStream", () => {
  it("starts the first claim at once and keeps later ones waiting", () => {
    const { log, stream } = recorder();
    const releaseA = claimNotificationStream("user-1", stream("a"));
    const releaseB = claimNotificationStream("user-1", stream("b"));
    expect(log).toEqual(["start a"]);
    releaseB();
    releaseA();
  });

  it("hands over in order: the holder's stream stops, then the next one starts", () => {
    const { log, stream } = recorder();
    const releaseA = claimNotificationStream("user-1", stream("a"));
    const releaseB = claimNotificationStream("user-1", stream("b"));
    const releaseC = claimNotificationStream("user-1", stream("c"));

    releaseA();
    expect(log).toEqual(["start a", "stop a", "start b"]);
    releaseB();
    expect(log).toEqual(["start a", "stop a", "start b", "stop b", "start c"]);
    releaseC();
    expect(log).toEqual(["start a", "stop a", "start b", "stop b", "start c", "stop c"]);
  });

  it("a waiting claim that leaves starts and stops nothing", () => {
    const { log, stream } = recorder();
    const releaseA = claimNotificationStream("user-1", stream("a"));
    const releaseB = claimNotificationStream("user-1", stream("b"));
    releaseB();
    expect(log).toEqual(["start a"]);
    releaseA();
    expect(log).toEqual(["start a", "stop a"]);
  });

  it("releasing twice is a no-op, and the stream is free for the next mount", () => {
    const { log, stream } = recorder();
    const releaseA = claimNotificationStream("user-1", stream("a"));
    releaseA();
    releaseA();
    expect(log).toEqual(["start a", "stop a"]);

    // Strict mode's second mount, a sign-out and back in, a remount.
    const releaseB = claimNotificationStream("user-1", stream("b"));
    expect(log).toEqual(["start a", "stop a", "start b"]);
    releaseB();
  });

  it("users do not queue behind each other", () => {
    const { log, stream } = recorder();
    const releaseA = claimNotificationStream("user-1", stream("a"));
    const releaseB = claimNotificationStream("user-2", stream("b"));
    expect(log).toEqual(["start a", "start b"]);
    releaseA();
    releaseB();
    expect(log).toEqual(["start a", "start b", "stop a", "stop b"]);
  });
});
