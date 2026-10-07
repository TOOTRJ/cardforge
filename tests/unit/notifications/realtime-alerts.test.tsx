// @vitest-environment happy-dom
import { Component, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RealtimeChannel, RealtimeClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// RealtimeAlerts against the REAL Realtime client — only the socket is faked,
// so a channel behaves here exactly as it does in the browser: the client
// hands back the channel a topic already has, and `.on("postgres_changes")`
// throws once that channel is subscribed.
//
// That is what broke every in-app 404 for a signed-in visitor (2026-10): the
// 404 page drew a second site header, the second header mounted a second
// RealtimeAlerts for the same user, its effect threw
// "cannot add `postgres_changes` callbacks … after `subscribe()`", and the
// root error boundary replaced the page. Two headers that mounted in the same
// beat did not throw — they bound twice, and one notification toasted twice.
//
// The rules these tests hold:
//   - one stream per user per tab, however many subscribers are mounted;
//   - nothing the stream does reaches an error boundary or goes unhandled —
//     a subscription that fails falls back to polling.
// ---------------------------------------------------------------------------

type Frame = [
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
];

const s = vi.hoisted(() => ({
  supabase: null as unknown,
  router: { push: vi.fn(), refresh: vi.fn() },
  toast: vi.fn(),
  fetchById: vi.fn(),
  unread: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => s.router }));
vi.mock("sonner", () => ({ toast: s.toast }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => s.supabase }));
vi.mock("@/lib/notifications/actions", () => ({
  fetchNotificationById: s.fetchById,
  fetchUnreadNotificationCount: s.unread,
}));

import { RealtimeAlerts } from "@/components/notifications/realtime-alerts";
import { subscribeNotificationArrivals } from "@/lib/notifications/bus";

const USER = "d0000000-0000-4000-a000-000000000001";
const TOPIC = `realtime:notifications:${USER}`;
const POLL_MS = 45_000;

/** The other end of the wire: a Realtime server that answers joins, leaves
 *  and heartbeats, and can push a row change or close a channel. It handles
 *  a socket's messages in order, as the real one does. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static all: FakeSocket[] = [];
  /** How the server answers a join; "hold" processes it and keeps the reply
   *  back until `server.release()`. */
  static joinReply: "ok" | "error" | "hold" = "ok";

  readyState: number = FakeSocket.CONNECTING;
  binaryType = "arraybuffer";
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: Frame[] = [];
  held: (() => void)[] = [];
  /** topic → the live join's ref and the ids the server gave its bindings. */
  joined = new Map<string, { joinRef: string | null; ids: number[] }>();
  private nextId = 100;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: string) {
    const frame = JSON.parse(data) as Frame;
    this.sent.push(frame);
    const [joinRef, ref, topic, event, payload] = frame;
    if (event === "heartbeat") {
      this.receive([null, ref, topic, "phx_reply", { status: "ok", response: {} }]);
    } else if (event === "phx_leave") {
      const left = this.joined.get(topic);
      this.receive([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      // The real server then closes the channel it was asked to leave. The
      // close carries THAT join's ref, so a newer channel on the topic must
      // ignore it.
      if (left && left.joinRef === joinRef) {
        this.joined.delete(topic);
        this.receive([joinRef, joinRef, topic, "phx_close", {}]);
      }
    } else if (event === "phx_join") {
      if (FakeSocket.joinReply === "error") {
        this.receive([joinRef, ref, topic, "phx_reply", { status: "error", response: { reason: "unavailable" } }]);
        return;
      }
      const config = (payload.config ?? {}) as { postgres_changes?: Record<string, unknown>[] };
      const bindings = (config.postgres_changes ?? []).map((filter) => ({ id: this.nextId++, ...filter }));
      this.joined.set(topic, { joinRef, ids: bindings.map((b) => b.id) });
      const reply = () =>
        this.receive([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]);
      if (FakeSocket.joinReply === "hold") this.held.push(reply);
      else reply();
    }
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "", wasClean: true });
  }

  receive(frame: Frame) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }), 0);
  }
}

const server = {
  socket: () => FakeSocket.all[FakeSocket.all.length - 1],
  sent: (event: string, topic = TOPIC) =>
    FakeSocket.all.flatMap((socket) => socket.sent).filter(([, , t, e]) => t === topic && e === event),
  /** The token each join was authorised with, in order. */
  joinTokens: () => server.sent("phx_join").map(([, , , , payload]) => payload.access_token ?? null),
  /** Lets the held join replies through. */
  release() {
    for (const reply of server.socket().held.splice(0)) reply();
  },
  /** A `notifications` row inserted for the user — one message carrying every
   *  binding the channel registered, as the server sends it. */
  insert(row: { id: string; type: string }) {
    const live = server.socket().joined.get(TOPIC);
    if (!live) throw new Error("no channel is joined for the topic");
    server.socket().receive([
      null,
      null,
      TOPIC,
      "postgres_changes",
      {
        ids: live.ids,
        data: {
          schema: "public",
          table: "notifications",
          commit_timestamp: "2026-10-06T00:00:00Z",
          type: "INSERT",
          columns: [
            { name: "id", type: "uuid" },
            { name: "type", type: "text" },
          ],
          record: row,
          errors: null,
        },
      },
    ]);
  },
};

type TestSupabase = {
  realtime: RealtimeClient;
  channel: ReturnType<typeof vi.fn<(name: string) => RealtimeChannel>>;
  removeChannel: (channel: RealtimeChannel) => Promise<unknown>;
  auth: { getSession: ReturnType<typeof vi.fn> };
};

const session = (token: string | null) => ({
  data: { session: token ? { access_token: token } : null },
  error: null,
});

/** What lib/supabase/client hands the component: ONE client per tab (the
 *  browser client is a singleton), whose `channel` / `removeChannel` are the
 *  Realtime client's own, as in supabase-js. */
function makeSupabase(): TestSupabase {
  const realtime = new RealtimeClient("ws://localhost:54321/realtime/v1", {
    transport: FakeSocket as never,
    params: { apikey: "test-key" },
  });
  return {
    realtime,
    channel: vi.fn((name: string) => realtime.channel(name)),
    removeChannel: (channel) => realtime.removeChannel(channel),
    auth: { getSession: vi.fn(async () => session("jwt-1")) },
  };
}

/** Stands in for app/error.tsx: whatever an effect or its cleanup throws
 *  lands here. */
class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.message ? <p role="alert">{this.state.message}</p> : this.props.children;
  }
}

/** One site header per id, each with its own subscriber for the user — all
 *  under one boundary that outlives them, so a throwing cleanup shows too. */
function Headers({ ids, userId = USER }: { ids: string[]; userId?: string }) {
  return (
    <Boundary>
      {ids.map((id) => (
        <RealtimeAlerts key={id} userId={userId} isAdmin={false} />
      ))}
    </Boundary>
  );
}

const supabase = () => s.supabase as TestSupabase;
const settle = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const reachedBoundary = () => screen.queryAllByRole("alert").map((node) => node.textContent);
/** Channels the component asked the client for. */
const opens = () => supabase().channel.mock.calls.length;
/** Times it looked: every attempt starts by reading the session. */
const looks = () => supabase().auth.getSession.mock.calls.length;
const channelStates = () => supabase().realtime.getChannels().map((channel) => channel.state);

let arrivals: { id: string; type: string }[] = [];
let stopListening = () => {};
let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  FakeSocket.joinReply = "ok";
  s.supabase = makeSupabase();
  s.router.push.mockReset();
  s.router.refresh.mockReset();
  s.toast.mockReset();
  s.fetchById.mockReset().mockImplementation(async (id: string) => ({
    id,
    type: "follow",
    createdAt: "2026-10-06T00:00:00Z",
    readAt: null,
    actor: { username: "ana", displayName: "Ana", avatarUrl: null },
    card: null,
    threadId: null,
    payload: {},
  }));
  s.unread.mockReset().mockResolvedValue(0);
  arrivals = [];
  stopListening = subscribeNotificationArrivals((arrival) => arrivals.push(arrival));
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  stopListening();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Node reports an unhandled rejection a turn later. None, in any test:
  // nothing the stream does may go unhandled.
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
});

describe("RealtimeAlerts — one stream per user, however many are mounted", () => {
  it("a second header mounting after the first subscribed throws nothing, joins nothing new, and one notification toasts once", async () => {
    const view = render(<Headers ids={["layout"]} />);
    await settle();
    expect(server.joinTokens()).toEqual(["jwt-1"]);

    // The 404 page's own header arrives a beat later, for the same user.
    view.rerender(<Headers ids={["layout", "not-found"]} />);
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_join")).toHaveLength(1);
    expect(channelStates()).toEqual(["joined"]);

    server.insert({ id: "n1", type: "follow" });
    await settle();
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(s.toast.mock.calls[0][0]).toMatch(/^Ana /);
    expect(arrivals).toEqual([{ id: "n1", type: "follow" }]);
  });

  it("two headers mounting in the same beat share one subscription: one notification, one toast, one badge bump", async () => {
    render(<Headers ids={["layout", "not-found"]} />);
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_join")).toHaveLength(1);

    server.insert({ id: "n1", type: "follow" });
    await settle();
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(arrivals).toEqual([{ id: "n1", type: "follow" }]);
  });

  it("the second header takes the stream over when the first unmounts", async () => {
    const view = render(<Headers ids={["layout", "not-found"]} />);
    await settle();

    view.rerender(<Headers ids={["not-found"]} />);
    await settle();

    expect(reachedBoundary()).toEqual([]);
    // The first one's channel was left, and a fresh one joined in its place.
    expect(server.sent("phx_leave")).toHaveLength(1);
    expect(server.sent("phx_join")).toHaveLength(2);
    expect(channelStates()).toEqual(["joined"]);

    server.insert({ id: "n2", type: "follow" });
    await settle();
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(arrivals).toEqual([{ id: "n2", type: "follow" }]);
  });

  it("…also when the first one was still joining, its reply arriving after it left", async () => {
    FakeSocket.joinReply = "hold";
    const view = render(<Headers ids={["layout", "not-found"]} />);
    await settle();
    expect(channelStates()).toEqual(["joining"]);

    FakeSocket.joinReply = "ok";
    view.rerender(<Headers ids={["not-found"]} />);
    await settle();
    server.release();
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(channelStates()).toEqual(["joined"]);
    server.insert({ id: "n2", type: "follow" });
    await settle();
    expect(s.toast).toHaveBeenCalledTimes(1);
  });

  it("strict mode's mount → cleanup → mount leaves exactly one joined channel", async () => {
    render(
      <StrictMode>
        <Headers ids={["layout"]} />
      </StrictMode>,
    );
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_join")).toHaveLength(1);
    expect(channelStates()).toEqual(["joined"]);
  });

  it("two headers under strict mode still end on one joined channel and one toast", async () => {
    render(
      <StrictMode>
        <Headers ids={["layout", "not-found"]} />
      </StrictMode>,
    );
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(channelStates()).toEqual(["joined"]);

    server.insert({ id: "n3", type: "follow" });
    await settle();
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(arrivals).toEqual([{ id: "n3", type: "follow" }]);
  });

  it("another user signing in leaves the old user's stream and joins their own", async () => {
    const other = "d0000000-0000-4000-a000-000000000003";
    const view = render(<Headers ids={["layout"]} />);
    await settle();

    view.rerender(<Headers ids={["layout"]} userId={other} />);
    await settle();

    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_leave")).toHaveLength(1);
    expect(server.sent("phx_join", `realtime:notifications:${other}`)).toHaveLength(1);
    expect(supabase().realtime.getChannels().map((channel) => channel.topic)).toEqual([
      `realtime:notifications:${other}`,
    ]);
  });

  it("the last unmount leaves the channel, and nothing runs afterwards", async () => {
    const view = render(<Headers ids={["layout"]} />);
    await settle();
    view.rerender(<Headers ids={[]} />);
    await settle();

    expect(server.sent("phx_leave")).toHaveLength(1);
    expect(supabase().realtime.getChannels()).toEqual([]);
    await settle(10 * 60_000);
    expect(opens()).toBe(1);
    expect(looks()).toBe(1);
    expect(s.unread).not.toHaveBeenCalled();
  });
});

describe("RealtimeAlerts — a failed subscription is not fatal", () => {
  it("subscribe() throwing reaches no error boundary, and the polling fallback takes over", async () => {
    vi.spyOn(RealtimeChannel.prototype, "subscribe").mockImplementation(() => {
      throw new Error("WebSocket not available: blocked by the network");
    });
    s.unread.mockResolvedValueOnce(2).mockResolvedValue(3);

    render(<Headers ids={["layout"]} />);
    await settle();
    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_join")).toHaveLength(0);
    // Reported once, for whoever is debugging — not swallowed.
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/realtime subscription failed/);

    // First poll learns the count; the next one sees it rise.
    await settle(POLL_MS);
    expect(s.unread).toHaveBeenCalledTimes(1);
    expect(s.toast).not.toHaveBeenCalled();
    await settle(POLL_MS);
    expect(s.unread).toHaveBeenCalledTimes(2);
    expect(s.toast).toHaveBeenCalledTimes(1);
    expect(s.toast.mock.calls[0][0]).toBe("You have new notifications.");
    expect(arrivals).toHaveLength(1);
    expect(reachedBoundary()).toEqual([]);
    // Still failing, still one line in the console.
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("a channel already subscribed under the topic (`.on()` throws) polls instead of throwing", async () => {
    // Something else in the tab holds the topic — the state a second
    // subscriber used to find.
    supabase().realtime.channel(`notifications:${USER}`).subscribe();
    await settle();

    render(<Headers ids={["layout"]} />);
    await settle();
    expect(reachedBoundary()).toEqual([]);

    await settle(POLL_MS);
    expect(s.unread).toHaveBeenCalledTimes(1);
  });

  it("the session read failing polls instead of going unhandled", async () => {
    supabase().auth.getSession.mockRejectedValueOnce(new Error("storage unavailable"));

    render(<Headers ids={["layout"]} />);
    await settle();
    expect(reachedBoundary()).toEqual([]);
    expect(server.sent("phx_join")).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(1);

    await settle(POLL_MS);
    expect(s.unread).toHaveBeenCalledTimes(1);
  });

  it("unmounting while the socket is being authorised never subscribes the channel it already removed", async () => {
    let authorised = () => {};
    vi.spyOn(supabase().realtime, "setAuth").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          authorised = resolve;
        }),
    );
    const subscribe = vi.spyOn(RealtimeChannel.prototype, "subscribe");

    const view = render(<Headers ids={["layout"]} />);
    await settle();
    view.rerender(<Headers ids={[]} />);
    await settle();
    authorised();
    await settle();

    expect(subscribe).not.toHaveBeenCalled();
    expect(server.sent("phx_join")).toHaveLength(0);
    expect(supabase().realtime.getChannels()).toEqual([]);
  });

  it("a refused join that the client's own retry fixes stops the polling", async () => {
    FakeSocket.joinReply = "error";
    render(<Headers ids={["layout"]} />);
    await settle();

    FakeSocket.joinReply = "ok";
    await settle(15_000);
    expect(channelStates()).toEqual(["joined"]);
    expect(opens()).toBe(1);

    await settle(10 * 60_000);
    expect(opens()).toBe(1);
    expect(looks()).toBe(1);
    expect(s.unread).not.toHaveBeenCalled();
  });

  it("unmounting while it is down stops the polling", async () => {
    FakeSocket.joinReply = "error";
    const view = render(<Headers ids={["layout"]} />);
    await settle();
    await settle(POLL_MS);
    expect(s.unread).toHaveBeenCalledTimes(1);
    const looked = looks();

    view.rerender(<Headers ids={[]} />);
    await settle(10 * 60_000);
    expect(s.unread).toHaveBeenCalledTimes(1);
    expect(looks()).toBe(looked);
    expect(opens()).toBe(1);
    expect(supabase().realtime.getChannels()).toEqual([]);
  });

  it.each([
    ["throws", () => { throw new Error("cannot leave"); }],
    ["rejects", () => Promise.reject(new Error("cannot leave"))],
  ] as const)("a channel that will not leave (removeChannel %s) does not fail the unmount", async (_how, removeChannel) => {
    const view = render(<Headers ids={["layout"]} />);
    await settle();
    supabase().removeChannel = removeChannel as TestSupabase["removeChannel"];

    view.rerender(<Headers ids={[]} />);
    await settle();
    expect(reachedBoundary()).toEqual([]);
  });
});
