import { describe, it, expect } from "vitest";
import { resetState, getDashboardSnapshot, ingestResourceEvent, createDemoEvent } from "@/lib/store";

describe("snapshot memoization profile", () => {
  it("returns cached derived state on repeated calls without state changes", () => {
    resetState();
    const first = getDashboardSnapshot();
    const start1 = performance.now();
    const second = getDashboardSnapshot();
    const elapsed = performance.now() - start1;

    expect(second.strategy).toBe(first.strategy);
    expect(second.readiness).toBe(first.readiness);
    expect(elapsed).toBeLessThan(5);
  });

  it("rebuilds derived state after ingest", () => {
    resetState();
    const first = getDashboardSnapshot();
    ingestResourceEvent(createDemoEvent("gmail-pii"));
    const second = getDashboardSnapshot();

    expect(second.strategy).not.toBe(first.strategy);
    expect(second.readiness).not.toBe(first.readiness);
  });

  it("handles rapid reset + snapshot cycles", () => {
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      resetState();
      getDashboardSnapshot();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(30000);
  });
});
