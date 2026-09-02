/** Installed before boot so the harness never races an undefined debug surface. */
export function installBootPlaceholder(): void {
  (window as unknown as { __gameDebug?: unknown }).__gameDebug = {
    getState: () => ({ ready: false, booting: true }),
    getPlayer: () => null,
    getPlayerPosition: () => ({ x: 0, y: 0, z: 0 }),
    getCamera: () => null,
    getEntities: () => [],
    getCurrentActivity: () => null,
    getObjectives: () => [],
    getNavigationState: () => ({ status: "uninitialized" }),
    reset: () => undefined,
    ready: () => false,
  };
}
