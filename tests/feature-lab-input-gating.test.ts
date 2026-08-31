import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";

const inputSource = readFileSync(
  new URL("../game/src/input/mouse.ts", import.meta.url),
  "utf8",
);
const contextMenuSource = readFileSync(
  new URL("../game/src/ui/contextMenu.ts", import.meta.url),
  "utf8",
);
const mapPanelSource = readFileSync(
  new URL("../game/src/ui/mapPanel.ts", import.meta.url),
  "utf8",
);
const minimapSource = readFileSync(
  new URL("../game/src/ui/minimap.ts", import.meta.url),
  "utf8",
);

/** Extracts one method without requiring a browser DOM or exporting input internals for tests. */
function methodBody(source: string, signature: string): string {
  const signatureAt = source.indexOf(signature);
  if (signatureAt < 0) throw new Error(`Missing method signature: ${signature}`);
  const bodyMarker = source.indexOf("): void {", signatureAt + signature.length);
  if (bodyMarker < 0) throw new Error(`Missing method body: ${signature}`);
  const bodyAt = bodyMarker + "): void ".length;

  let depth = 0;
  for (let index = bodyAt; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(signatureAt, index + 1);
    }
  }
  throw new Error(`Unterminated method body: ${signature}`);
}

describe("feature-lab input gating source contract", () => {
  it("keeps inspection available while left-click movement and interactions are suspended", () => {
    const leftClick = methodBody(inputSource, "private handleLeftClick(");
    const disabledGate = leftClick.indexOf("if (!this.movementEnabled)");
    const inspect = leftClick.indexOf("this.inspectEntity", disabledGate);
    const gateReturn = leftClick.indexOf("return;", inspect);
    const firstMove = leftClick.indexOf("this.moveTo(");
    const firstInteraction = leftClick.indexOf("this.runInteraction(");

    expect(disabledGate).toBeGreaterThanOrEqual(0);
    expect(inspect).toBeGreaterThan(disabledGate);
    expect(gateReturn).toBeGreaterThan(inspect);
    expect(firstMove).toBeGreaterThan(gateReturn);
    expect(firstInteraction).toBeGreaterThan(gateReturn);

    const interaction = methodBody(inputSource, "private runInteraction(");
    expect(interaction).toContain(
      'if (!this.movementEnabled && interaction !== "inspect") return;',
    );
    expect(interaction).toContain('if (interaction === "inspect")');
    expect(methodBody(inputSource, "private inspectEntity(")).toContain(
      "this.api.inspect(entityId)",
    );
  });

  it("guards every InputController moveTo call at the final input boundary", () => {
    const moveTo = methodBody(inputSource, "private moveTo(");
    const guard = moveTo.indexOf("if (!this.movementEnabled) return;");
    const apiCall = moveTo.indexOf("this.api.moveTo(target)");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(apiCall).toBeGreaterThan(guard);

    const directInput = methodBody(inputSource, "update(): void");
    expect(directInput).toContain("this.movementEnabled");
    expect(directInput).toMatch(/forward:\s*0,\s*strafe:\s*0/);
  });

  it("passes authoring state to menus and disables both Walk here entries", () => {
    const rightClick = methodBody(inputSource, "private handleRightClick(");
    expect(rightClick).toContain("{ movementEnabled: this.movementEnabled }");
    expect(rightClick).toContain("openForEntity");
    expect(rightClick).toContain("openForGround");

    const entityMenu = methodBody(contextMenuSource, "openForEntity(");
    expect(entityMenu).toContain(
      'options.movementEnabled !== false || interaction === "inspect"',
    );
    expect(entityMenu).toContain("enabled: availability.enabled && movementAllowed");
    expect(entityMenu).toMatch(
      /id:\s*"walk-here"[\s\S]*?enabled:\s*options\.movementEnabled !== false/,
    );

    const groundMenu = methodBody(contextMenuSource, "openForGround(");
    expect(groundMenu).toMatch(
      /id:\s*"walk-here"[\s\S]*?enabled:\s*options\.movementEnabled !== false/,
    );
  });

  it("blocks every central API movement command, clears pending intent, and restores commands", () => {
    const state = { player: { health: 10, position: [0, 0, 0] } };
    const store = {
      get: vi.fn(() => state),
      markDirty: vi.fn(),
    };
    const startPath = vi.fn(() => ({ pathLength: 4, etaMs: 1_000 }));
    const stop = vi.fn(() => true);
    const movement = { startPath, stop };
    const nav = { isReady: vi.fn(() => true) };
    const api = new CorealmGameApi(
      store as never,
      {} as never,
      nav as never,
      movement as never,
      { elapsedMs: 250 } as never,
    );

    Reflect.set(api, "pending", {
      entityId: "target",
      interaction: "inspect",
      expiresAtMs: 5_000,
    });
    api.setMovementCommandsEnabled(false);

    expect(Reflect.get(api, "pending")).toBeNull();
    expect(stop).toHaveBeenCalledWith(state, 250, "movement-disabled");
    expect(store.markDirty).toHaveBeenCalledTimes(1);

    const blocked = api.moveTo({ position: [4, 0, 2] });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("UNAVAILABLE");
    expect(startPath).not.toHaveBeenCalled();

    api.setMovementCommandsEnabled(true);
    const restored = api.moveTo({ position: [4, 0, 2] });
    expect(restored).toEqual({ ok: true, value: { pathLength: 4, etaMs: 1_000 } });
    expect(startPath).toHaveBeenCalledTimes(1);
  });

  it("routes map and minimap walking through the gated GameApi moveTo command", () => {
    expect(minimapSource).toContain(
      "this.api.moveTo({ position: [x, height, z] as Vec3 })",
    );
    expect(mapPanelSource).toContain(
      "this.ctx.api.moveTo({ locationId: place.locationId })",
    );
    expect(mapPanelSource).toContain(
      "this.ctx.api.moveTo({ entityId: place.entityId })",
    );
    expect(minimapSource).not.toContain("movement.startPath");
    expect(mapPanelSource).not.toContain("movement.startPath");
  });
});
