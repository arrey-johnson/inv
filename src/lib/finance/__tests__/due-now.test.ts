import { describe, expect, it } from "vitest";
import { splitDueNow } from "../due-now";

describe("splitDueNow", () => {
  it("splits 40/60 on a net payable in XAF", () => {
    const split = splitDueNow(3_577_500, 40, "XAF");
    expect(split).toEqual({
      percent: 40,
      dueNow: 1_431_000,
      dueLater: 2_146_500,
      laterPercent: 60,
    });
  });

  it("returns null when blank, 100%, or invalid", () => {
    expect(splitDueNow(1000, null, "XAF")).toBeNull();
    expect(splitDueNow(1000, 100, "XAF")).toBeNull();
    expect(splitDueNow(1000, 0, "XAF")).toBeNull();
    expect(splitDueNow(1000, -5, "XAF")).toBeNull();
  });
});
