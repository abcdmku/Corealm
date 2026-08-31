import { describe, expect, it } from "vitest";
import {
  particleCapFailure,
  shaderProgramGrowthFailure,
  SPELL_PARTICLE_CAP,
} from "../tools/verify-magic.js";

describe("magic browser verifier budgets", () => {
  it("uses the frozen 640-particle ceiling", () => {
    expect(SPELL_PARTICLE_CAP).toBe(640);
    expect(particleCapFailure(640)).toBeNull();
    expect(particleCapFailure(641)).toBe("641 live particles; the cap is 640");
  });

  it("fails when a cast adds a shader program", () => {
    expect(shaderProgramGrowthFailure("wind", "air_surge", 106, 106)).toBeNull();
    expect(shaderProgramGrowthFailure("wind", "air_surge", 106, 105)).toBeNull();
    expect(shaderProgramGrowthFailure("wind", "air_surge", 106, 107)).toContain(
      "shader program count rose from 106 to 107",
    );
  });
});
