/**
 * Player-facing settings, and the only place they are stored.
 *
 * Deliberately small and deliberately real: every setting here changes something the player can see
 * on the next frame, and the root subscribes to apply it. A setting that does nothing is worse than
 * no settings screen, because it teaches the player that the screen is decoration.
 *
 * Audio is not here. There is no audio system yet, and a volume slider over silence is exactly the
 * kind of setting this rule exists to keep out.
 *
 * Persisted separately from the save. These are preferences about the client, not about the
 * character, so "New Game" must not reset them and a save transferred between browsers must not
 * carry them.
 *
 * The four here are the four that are applied. `boot.ts` subscribes once and wires each of them:
 * shadows flip the sun's cast, inversion lands on the camera, damage numbers are never created
 * rather than created-and-hidden, and compact density puts `.is-compact` on `#ui-root`, which
 * `ui/styles/title.css` answers with smaller type, tighter padding and narrower side panels.
 */

export interface UiSettings {
  /** Floating damage numbers over combat. */
  damageNumbers: boolean;
  /** Real-time shadows. The first thing to turn off on a weak GPU. */
  shadows: boolean;
  /** Invert the vertical axis while orbiting the camera. */
  invertCameraY: boolean;
  /** Panel and HUD density. */
  uiScale: "compact" | "normal";
}

export const DEFAULT_SETTINGS: UiSettings = {
  damageNumbers: true,
  shadows: true,
  invertCameraY: false,
  uiScale: "normal",
};

const STORAGE_KEY = "corealm.settings.v1";

type Listener = (settings: UiSettings) => void;

/**
 * The live settings, with change notification.
 *
 * One instance, created by `createUi` and handed to the root so it can wire the effects. Reading is
 * synchronous; writing notifies every listener and persists.
 */
export class SettingsStore {
  private settings: UiSettings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...readStored() };
  }

  get(): UiSettings {
    return { ...this.settings };
  }

  /** Applies a partial change, persists it, and notifies. */
  set(patch: Partial<UiSettings>): UiSettings {
    this.settings = { ...this.settings, ...patch };
    writeStored(this.settings);
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }

  reset(): UiSettings {
    return this.set({ ...DEFAULT_SETTINGS });
  }

  /** Fires immediately with the current value, then on every change. Returns an unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => { this.listeners.delete(listener); };
  }
}

/**
 * Reads what is in storage, field by field.
 *
 * The stored blob is JSON, so it is `unknown` no matter what the type says: an older build, a
 * hand-edited value or a half-written string all end up here. Anything that is not the right shape
 * is dropped and the default stands, because a `uiScale` of `"huge"` would otherwise be spread
 * straight into the store and every reader would trust it.
 */
function readStored(): Partial<UiSettings> {
  let parsed: unknown;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt or unavailable store falls back to defaults. Preferences are never worth a crash.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const source = parsed as Record<string, unknown>;
  const out: Partial<UiSettings> = {};
  if (typeof source["damageNumbers"] === "boolean") out.damageNumbers = source["damageNumbers"];
  if (typeof source["shadows"] === "boolean") out.shadows = source["shadows"];
  if (typeof source["invertCameraY"] === "boolean") out.invertCameraY = source["invertCameraY"];
  if (source["uiScale"] === "compact" || source["uiScale"] === "normal") out.uiScale = source["uiScale"];
  return out;
}

function writeStored(settings: UiSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing, quota, or no storage at all. The session still honours the setting.
  }
}
