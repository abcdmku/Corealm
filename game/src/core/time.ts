/** Fixed-step sim clock, decoupled from render. See runs/corealm/architecture.md section 4. */
export const SIM_TICK_MS = 100;
export const COMBAT_TICK_MS = 600;
export const GATHER_TICK_MS = 1800;

export class SimClock {
  /** Sim time in milliseconds since boot, advanced only in whole ticks. */
  elapsedMs = 0;
  tick = 0;
  timeScale = 1;
  paused = false;

  private accumulator = 0;

  /**
   * Feeds real frame time in and returns how many whole sim ticks to run.
   * Capped so a long stall (tab in the background, a slow asset load) cannot produce a
   * thousand-tick catch-up burst.
   */
  advance(realDeltaMs: number, maxTicks = this.maxTicksPerFrame()): number {
    if (this.paused) return 0;
    this.accumulator += realDeltaMs * this.timeScale;
    let ticks = 0;
    while (this.accumulator >= SIM_TICK_MS && ticks < maxTicks) {
      this.accumulator -= SIM_TICK_MS;
      ticks += 1;
    }
    if (this.accumulator > SIM_TICK_MS * maxTicks) this.accumulator = 0;
    return ticks;
  }

  /**
   * How many sim ticks one frame may run.
   *
   * Normally 8, which keeps a stall from producing a thousand-tick catch-up burst. But the cap is
   * also a hard ceiling on how fast the simulation can advance: at time scale 25 a frame needs 250
   * ticks, and clamping to 8 silently ignores the scale. Tests that fast-forward are the only
   * caller that needs more, so the budget grows with the scale and stays modest at 1x.
   */
  private maxTicksPerFrame(): number {
    return Math.max(8, Math.ceil(this.timeScale * 12));
  }

  /** Called once per tick actually run. */
  commitTick(): void {
    this.tick += 1;
    this.elapsedMs += SIM_TICK_MS;
  }

  /** Debug-only jump used by advanceGameTime. Does not simulate the frames between. */
  skipMs(ms: number): void {
    this.elapsedMs += ms;
    this.tick += Math.floor(ms / SIM_TICK_MS);
  }

  reset(): void {
    this.elapsedMs = 0;
    this.tick = 0;
    this.accumulator = 0;
    this.timeScale = 1;
    this.paused = false;
  }
}
