import { describe, expect, it } from "vitest";
import { jobStatusOf, openStepKeys } from "@/lib/ai/job-queue";

const steps = [
  { key: "card:0", status: "done" as const },
  { key: "card:1", status: "failed" as const },
  { key: "card:2", status: "pending" as const },
  { key: "card:3", status: "running" as const },
  { key: "cover", status: "failed" as const },
];

describe("openStepKeys", () => {
  it("queues pending and running steps by default, never failed ones", () => {
    expect(openStepKeys(steps)).toEqual(["card:2", "card:3"]);
  });
  it("queues failed steps too for an explicit retry, keeping deck order", () => {
    expect(openStepKeys(steps, { includeFailed: true })).toEqual(["card:1", "card:2", "card:3", "cover"]);
  });
});

describe("jobStatusOf", () => {
  it("mirrors the server's honest recompute", () => {
    expect(jobStatusOf(steps)).toBe("generating");
    expect(jobStatusOf([{ key: "a", status: "done" }, { key: "b", status: "failed" }])).toBe("done_with_errors");
    expect(jobStatusOf([{ key: "a", status: "failed" }])).toBe("failed");
    expect(jobStatusOf([{ key: "a", status: "done" }])).toBe("done");
  });
});
