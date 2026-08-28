import path from "node:path";
import { describe, expect, it } from "vitest";
import { argValue, resolveInside, runsRoot, safeName } from "../tools/lib/paths.js";

describe("harness paths", () => {
  it("normalizes artifact names", () => {
    expect(safeName("  first checkpoint  ")).toBe("first-checkpoint");
  });

  it("keeps run paths inside the runs directory", () => {
    expect(resolveInside(runsRoot, "runs/demo")).toBe(path.join(runsRoot, "demo"));
    expect(() => resolveInside(runsRoot, "../outside")).toThrow(/Path must stay inside/);
  });

  it("reads command flags", () => {
    expect(argValue(["--run", "runs/demo"], "--run")).toBe("runs/demo");
  });
});
