import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("lab-first agent workflow", () => {
  it("makes lab acceptance a root rule before final-world wiring", () => {
    const rules = read("AGENTS.md");

    expect(rules).toMatch(/Build every feature in the persistent realtime feature lab first/i);
    expect(rules).toMatch(/only then wire it into the final world/i);
    expect(rules).toMatch(/Skip the lab-first gate only when .* authored full world/i);
  });

  it.each([
    ["skills/prd.md", /lab workbench.*deterministic fixture.*production path/is],
    ["skills/builder.md", /Do not add the feature to the final world until the root has accepted that proof/is],
    ["skills/critic.md", /require evidence from the production-backed feature lab/is],
  ])("keeps %s aligned with the lab gate", (path, policy) => {
    const prompt = read(path);

    expect(prompt).toContain("docs/feature-lab.md");
    expect(prompt).toMatch(policy);
  });

  it("keeps world-authoring exceptions narrow", () => {
    const workflow = read("docs/world-authoring.md");

    expect(workflow).toMatch(/This workflow owns proof of the authored full world/i);
    expect(workflow).toMatch(/Keep the exception narrow/i);
    expect(workflow).toMatch(/production-backed feature lab first/i);
  });

  it("generates lab-first run and critic handoffs", () => {
    const generator = read("tools/game-agent.ts");

    expect(generator).toContain("Fresh PRD draft with lab coverage for each feature");
    expect(generator).toContain("Feature round accepted in the lab");
    expect(generator).toContain("Require lab proof before final-world evidence");
  });

  it("runs both CI lab gates before their final-world smoke tests", () => {
    const workflow = read(".github/workflows/docs.yml");
    const labOffsets = [...workflow.matchAll(/run: npm run lab:test/g)].map((match) => match.index ?? -1);
    const smokeOffsets = [...workflow.matchAll(/run: npm run smoke/g)].map((match) => match.index ?? -1);

    expect(labOffsets).toHaveLength(2);
    expect(smokeOffsets).toHaveLength(2);
    expect(labOffsets[0]!).toBeLessThan(smokeOffsets[0]!);
    expect(labOffsets[1]!).toBeLessThan(smokeOffsets[1]!);
  });

  it("checks out the workflow policy files in both CI jobs", () => {
    const workflow = read(".github/workflows/docs.yml");
    const sparseCheckouts = [...workflow.matchAll(/sparse-checkout:\s*\|\r?\n((?:\s{12}.+\r?\n)+)/g)]
      .map((match) => match[1]!);

    expect(sparseCheckouts).toHaveLength(2);
    for (const paths of sparseCheckouts) {
      expect(paths).toMatch(/^\s+skills\s*$/m);
    }
  });
});
