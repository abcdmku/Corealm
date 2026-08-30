import { describe, expect, it } from "vitest";
import { docsWorldMapUrl } from "../tools/gen-docs.js";

describe("generated guide asset URLs", () => {
  it("keeps the world-map URL stable across image revisions", () => {
    const url = docsWorldMapUrl("../assets/");

    expect(url).toBe("../assets/world-map.webp");
    expect(url).not.toContain("?");
  });
});
