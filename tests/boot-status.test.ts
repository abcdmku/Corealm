import { describe, expect, it } from "vitest";
import type { AssetLoadStats } from "../game/src/render/assets.js";
import { formatBootAssetProgress } from "../game/src/app/bootStatus.js";

const stats = (overrides: Partial<AssetLoadStats> = {}): AssetLoadStats => ({
  total: 222,
  requested: 8,
  loaded: 6,
  failed: 0,
  queued: 1,
  inflight: 1,
  ...overrides,
});

describe("boot asset progress", () => {
  it("does not present a changing request count as a total", () => {
    expect(formatBootAssetProgress(stats(), null)).toBe(" · 6 assets ready, 2 loading");
    expect(formatBootAssetProgress(stats({ requested: 10, loaded: 8 }), null))
      .toBe(" · 8 assets ready, 2 loading");
  });

  it("uses a fixed denominator once the complete batch is scheduled", () => {
    expect(formatBootAssetProgress(stats(), 12)).toBe(" · assets 6/12 ready");
    expect(formatBootAssetProgress(stats({ requested: 14, loaded: 9 }), 12))
      .toBe(" · assets 9/12 ready");
  });

  it("keeps failures visible without changing the target", () => {
    expect(formatBootAssetProgress(stats({ loaded: 7, failed: 1, queued: 0, inflight: 0 }), 8))
      .toBe(" · assets 7/8 ready, 1 failed");
  });

  it("stays quiet before the manifest or any asset work exists", () => {
    expect(formatBootAssetProgress(stats({ total: 0 }), null)).toBe("");
    expect(formatBootAssetProgress(stats({ loaded: 0, requested: 0, queued: 0, inflight: 0 }), null)).toBe("");
  });
});
