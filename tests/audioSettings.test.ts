import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioVolumes } from "../game/src/contracts.js";
import { DEFAULT_SETTINGS, SettingsStore } from "../game/src/ui/settings.js";

const STORAGE_KEY = "corealm.settings.v1";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("audio settings", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes and persists independent AudioVolumes, including exact zero", () => {
    const store = new SettingsStore();
    const seen: AudioVolumes[] = [];
    const unsubscribe = store.subscribe(({ music, ambient, sfx }) => {
      seen.push({ music, ambient, sfx });
    });

    store.set({ music: 0, ambient: 0.34, sfx: 1 });
    unsubscribe();

    expect(seen).toEqual([
      {
        music: DEFAULT_SETTINGS.music,
        ambient: DEFAULT_SETTINGS.ambient,
        sfx: DEFAULT_SETTINGS.sfx,
      },
      { music: 0, ambient: 0.34, sfx: 1 },
    ]);
    expect(new SettingsStore().get()).toMatchObject({ music: 0, ambient: 0.34, sfx: 1 });
    expect(store.reset()).toMatchObject({
      music: DEFAULT_SETTINGS.music,
      ambient: DEFAULT_SETTINGS.ambient,
      sfx: DEFAULT_SETTINGS.sfx,
    });
    expect(new SettingsStore().get()).toMatchObject({
      music: DEFAULT_SETTINGS.music,
      ambient: DEFAULT_SETTINGS.ambient,
      sfx: DEFAULT_SETTINGS.sfx,
    });
  });

  it("rejects invalid stored gains and clamps programmatic changes to 0..1", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ music: -0.1, ambient: 1.1, sfx: "0" }));
    const store = new SettingsStore();
    expect(store.get()).toMatchObject({
      music: DEFAULT_SETTINGS.music,
      ambient: DEFAULT_SETTINGS.ambient,
      sfx: DEFAULT_SETTINGS.sfx,
    });

    expect(store.set({ music: -2, ambient: 2, sfx: Number.NaN })).toMatchObject({
      music: 0,
      ambient: 1,
      sfx: 0,
    });
  });

  it("does not republish or persist a setting that did not change", () => {
    const write = vi.spyOn(storage, "setItem");
    const store = new SettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ music: DEFAULT_SETTINGS.music });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});
