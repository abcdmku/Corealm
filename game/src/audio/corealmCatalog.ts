import type { AudioCueId } from "../contracts.js";
import type { AudioCueDefinition } from "./catalog.js";
import { defineAudioCatalog } from "./catalog.js";

const publicBase = import.meta.env?.BASE_URL ?? "/";
const publicAsset = (pathname: string): string => `${publicBase.replace(/\/?$/, "/")}${pathname.replace(/^\/+/, "")}`;
const noxSfx = (name: string): string => publicAsset(`audio/sfx/nox/${name}.ogg`);
const noxAmbience = (name: string): string => publicAsset(`audio/ambience/nox/${name}.ogg`);
const tom = (name: string): string => publicAsset(`audio/sfx/tommusic/${name}.ogg`);
const cow1 = (name: string): string => publicAsset(`audio/sfx/filmcow-v1/${name}.ogg`);
const cow4 = (name: string): string => publicAsset(`audio/sfx/filmcow-v4/${name}.ogg`);
const oga = (name: string): string => publicAsset(`audio/sfx/oga/${name}.ogg`);
const custom = (name: string): string => publicAsset(`audio/sfx/custom/${name}.ogg`);
const music = (name: string): string => publicAsset(`audio/music/${name}.mp3`);
/**
 * Animal voices, all Ogg Vorbis like every other SFX directory.
 *
 * Four frog croaks arrived as mp3 and the two real cow moos as wav; both were transcoded at
 * `-q:a 5` by `tools/animals/stage-audio.py`'s companion step, because `tests/audioCatalog.test.ts`
 * asserts every sfx URL ends in `.ogg` and that convention is worth more than saving one re-encode
 * of an already-lossy source.
 *
 * Routed through `publicAsset` like the rest: the game is served under a base path on Pages, and a
 * hard-coded leading slash would 404 every animal call there.
 */
const animal = (name: string): string => publicAsset(`audio/sfx/animals/${name}.ogg`);

/**
 * Every semantic cue has an explicit grounded-fantasy source. The curation ledgers under `docs/`
 * explain why these files were accepted and which modern, comic, firearm, and electronic sounds
 * were rejected. Variants are intentionally small so the browser decodes only useful material.
 */
const cues = {
  "ui.click": { variants: [cow1("ui-button-press-01")], gain: 0.34, minIntervalMs: 70, maxConcurrent: 2 },
  "ui.confirm": { variants: [tom("lock-unlock")], gain: 0.32, playbackRate: [1.02, 1.08] },
  "ui.cancel": { variants: [cow1("door-latch-01")], gain: 0.24, playbackRate: 0.9 },
  "ui.error": { variants: [cow4("shield-metal-strike-01")], gain: 0.24, playbackRate: 0.82 },
  "ui.level_up": {
    variants: [custom("starter-plains-drums")],
    gain: 0.42,
    playbackRate: 1,
    minIntervalMs: 180,
    maxConcurrent: 1,
  },

  "movement.footstep_grass": { variants: [noxSfx("footstep-grass-01"), noxSfx("footstep-grass-02")], gain: 0.5, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_dirt": { variants: [oga("footstep-ground-01"), { url: oga("footstep-ground-02"), gain: 0.57 }], gain: 0.23, playbackRate: 0.82, maxConcurrent: 2 },
  "movement.footstep_forest": { variants: [noxSfx("footstep-forest-01"), noxSfx("footstep-forest-02")], gain: 0.32, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_stone": { variants: [{ url: noxSfx("footstep-stone-01"), gain: 0.57 }, noxSfx("footstep-stone-02")], gain: 0.22, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_wood": { variants: [noxSfx("footstep-wood-01"), noxSfx("footstep-wood-02")], gain: 0.3, playbackRate: [0.96, 1.04], maxConcurrent: 2 },
  "movement.footstep_cave": { variants: [noxSfx("footstep-cave-01"), noxSfx("footstep-cave-02")], gain: 0.34, playbackRate: [0.95, 1.03], maxConcurrent: 2 },

  "gather.mining_swing": { variants: [tom("sword-swing-01"), tom("sword-swing-02")], gain: 0.28, playbackRate: [0.72, 0.8], minIntervalMs: 240 },
  "gather.mining_impact": { variants: [cow4("mining-rock-impact-01"), cow4("mining-rock-impact-02"), oga("mining-impact-stone-01")], gain: 0.62, playbackRate: [0.94, 1.04], minIntervalMs: 240 },
  "gather.rock_break": { variants: [oga("rock-break")], gain: 0.72, maxConcurrent: 1 },
  "gather.wood_swing": { variants: [tom("sword-swing-01"), tom("sword-swing-02")], gain: 0.3, playbackRate: [0.84, 0.92], minIntervalMs: 240 },
  "gather.wood_impact": { variants: [cow4("wood-chop-impact-01"), cow4("wood-chop-impact-02"), cow1("wood-hit-light-01")], gain: 0.62, playbackRate: [0.94, 1.04], minIntervalMs: 240 },
  "gather.tree_fall": { variants: [oga("tree-chop-fall"), cow4("tree-wood-break-01")], gain: 0.68, maxConcurrent: 1 },
  "gather.fishing_cast": { variants: [cow1("fishing-splash-small-01")], gain: 0.42, maxConcurrent: 1 },
  "gather.fishing_reel": { variants: [tom("fishing-splash-01"), tom("fishing-splash-02")], gain: 0.32, playbackRate: [0.96, 1.04], minIntervalMs: 240 },
  "gather.fishing_catch": { variants: [cow1("fishing-fish-flop-01")], gain: 0.48, maxConcurrent: 1 },

  "production.smith": { variants: [oga("smithing-anvil"), oga("smithing-metal-hit-01"), oga("smithing-metal-hit-02")], gain: 0.55, playbackRate: [0.96, 1.03], minIntervalMs: 220 },
  "production.smelt": { variants: [oga("metal-sheet"), oga("smithing-metal-hit-01")], gain: 0.42, playbackRate: [0.9, 0.98], minIntervalMs: 320 },
  "production.craft": { variants: [oga("building-hammer-01"), oga("building-hammer-02"), oga("craft-hammer")], gain: 0.45, playbackRate: [0.96, 1.04], minIntervalMs: 220 },
  "production.cook": { variants: [noxSfx("campfire-crackle-01")], gain: 0.34, minIntervalMs: 320 },
  "production.fletch": { variants: [cow1("wood-hit-light-01"), cow1("cloth-ruffle-01")], gain: 0.3, playbackRate: [1.02, 1.1], minIntervalMs: 220 },

  "combat.melee_swing": { variants: [tom("sword-swing-01"), tom("sword-swing-02")], gain: 0.5, playbackRate: [0.96, 1.04], minIntervalMs: 180 },
  "combat.melee_hit": { variants: [tom("sword-impact-01"), tom("sword-impact-02"), cow4("armour-hit-01")], gain: 0.62, playbackRate: [0.95, 1.04], minIntervalMs: 180 },
  "combat.melee_miss": { variants: [tom("sword-swing-01"), tom("sword-swing-02")], gain: 0.3, playbackRate: [1.08, 1.16], minIntervalMs: 180 },
  "combat.magic_cast": { variants: [tom("magic-ember-cast-01"), tom("magic-ember-cast-02"), tom("magic-stone-cast-01"), tom("magic-stone-cast-02")], gain: 0.5, playbackRate: [0.97, 1.04], minIntervalMs: 180 },
  "combat.magic_hit": { variants: [tom("magic-impact-01"), tom("magic-impact-02")], gain: 0.58, playbackRate: [0.96, 1.05], minIntervalMs: 180 },
  "combat.special": { variants: [cow4("boss-ground-impact-01")], gain: 0.74, maxConcurrent: 1 },
  "combat.player_hit": { variants: [cow4("damage-body-impact-01"), cow4("damage-body-impact-02"), cow4("armour-hit-01")], gain: 0.56, playbackRate: [0.94, 1.03], minIntervalMs: 160 },
  "combat.enemy_death": { variants: [cow4("melee-body-impact-01"), cow4("damage-body-impact-02")], gain: 0.62, playbackRate: [0.82, 0.92], maxConcurrent: 2 },
  "combat.player_death": { variants: [cow4("damage-body-impact-01")], gain: 0.7, playbackRate: 0.72, maxConcurrent: 1 },

  "interaction.door_open": { variants: [tom("door-open-01"), tom("door-open-02"), cow1("door-open-wood-01")], gain: 0.45, playbackRate: [0.97, 1.03], maxConcurrent: 1 },
  "interaction.portal": { variants: [tom("magic-stone-cast-01"), tom("magic-stone-cast-02")], gain: 0.46, playbackRate: [0.78, 0.86], maxConcurrent: 1 },
  "interaction.climb": { variants: [cow1("cloth-movement-01")], gain: 0.35, playbackRate: 0.94, maxConcurrent: 1 },
  "interaction.vault": { variants: [cow1("cloth-ruffle-01")], gain: 0.4, playbackRate: 1.08, maxConcurrent: 1 },
  "interaction.loot": { variants: [cow1("loot-rocks-handle-01"), cow1("loot-metal-drop-01")], gain: 0.4, playbackRate: [0.97, 1.04], maxConcurrent: 1 },
  "interaction.equip": { variants: [tom("weapon-unsheathe-01"), tom("weapon-sheathe-01"), cow1("cloth-movement-01")], gain: 0.38, playbackRate: [0.98, 1.04], maxConcurrent: 1 },
  "interaction.consume": { variants: [oga("apple-bite")], gain: 0.36, playbackRate: [0.96, 1.04], maxConcurrent: 1 },
  "interaction.bank": { variants: [cow1("chest-open-wood-01"), tom("chest-open-01"), tom("chest-open-02")], gain: 0.42, playbackRate: [0.97, 1.03], maxConcurrent: 1 },
  "interaction.trade": { variants: [cow1("loot-metal-drop-01"), cow1("parchment-handle-01")], gain: 0.32, playbackRate: [1.0, 1.06], maxConcurrent: 1 },
  "interaction.dialogue_open": { variants: [cow1("parchment-handle-01")], gain: 0.23, playbackRate: 1.05, maxConcurrent: 1 },
  "interaction.dialogue_close": { variants: [cow1("parchment-handle-01")], gain: 0.2, playbackRate: 0.92, maxConcurrent: 1 },
  "interaction.activity_stop": { variants: [cow1("cloth-ruffle-01")], gain: 0.2, playbackRate: 0.88, minIntervalMs: 180 },

  // Animal voices. Sources and CC0 evidence are in docs/audio-source-animals.md.
  //
  // Every one carries a long `minIntervalMs` and a low `maxConcurrent` on purpose: a nine-strong
  // shoal or a seven-strong flock would otherwise all call on the same frame the player walks into
  // aggro range, and thirteen simultaneous voices is a wall of noise rather than a place with
  // animals in it. The rate ranges pull individuals apart in pitch so a flock does not sound like
  // one bird played seven times.
  "creature.hen_cluck": { variants: [animal("hen-cluck-01"), animal("hen-cluck-02")], gain: 0.30, playbackRate: [1.06, 1.18], minIntervalMs: 900, maxConcurrent: 2 },
  "creature.frog_croak": { variants: [animal("frog-croak-01"), animal("frog-croak-02"), animal("frog-croak-03"), animal("frog-ribbit-01")], gain: 0.34, playbackRate: [0.94, 1.08], minIntervalMs: 700, maxConcurrent: 3 },
  "creature.goat_bleat": { variants: [animal("goat-bleat-01")], gain: 0.34, playbackRate: [0.92, 1.06], minIntervalMs: 1100, maxConcurrent: 2 },
  // The cow clips are the two real moos in an otherwise sci-fi CC0 pack. Slowed slightly, because
  // an aurochs is the same voice one size down in pitch.
  "creature.cow_low": { variants: [animal("cow-moo-01"), animal("cow-moo-02")], gain: 0.36, playbackRate: [0.86, 0.96], minIntervalMs: 1400, maxConcurrent: 2 },
  "creature.coney_squeak": { variants: [animal("rodent-squeak-01"), animal("rodent-squeak-02")], gain: 0.24, playbackRate: [1.1, 1.25], minIntervalMs: 800, maxConcurrent: 2 },
  "creature.viper_hiss": { variants: [animal("serpent-hiss-01"), animal("serpent-hiss-02")], gain: 0.32, playbackRate: [0.94, 1.05], minIntervalMs: 1000, maxConcurrent: 2 },
  "creature.stag_bell": { variants: [animal("stag-bellow-01"), animal("stag-bellow-02")], gain: 0.38, playbackRate: [0.9, 1.0], minIntervalMs: 1600, maxConcurrent: 1 },
  "creature.hog_grunt": { variants: [animal("boar-grunt-01"), animal("boar-grunt-02"), animal("boar-grunt-03")], gain: 0.34, playbackRate: [0.9, 1.04], minIntervalMs: 900, maxConcurrent: 2 },
  "creature.coyote_howl": { variants: [animal("coyote-howl-01"), animal("coyote-bark-01"), animal("coyote-bark-02")], gain: 0.38, playbackRate: [0.98, 1.1], minIntervalMs: 1200, maxConcurrent: 2 },
  // The loudest voice in the game after the boss slam, and the only one that should carry across a
  // valley. Two real bear growls plus one pack roar for the aggro moment.
  "creature.bear_roar": { variants: [animal("bear-growl-01"), animal("bear-growl-02"), animal("bear-roar-01")], gain: 0.46, playbackRate: [0.88, 0.98], minIntervalMs: 1600, maxConcurrent: 1 },
  "creature.chitin_click": { variants: [animal("chitin-click-01"), animal("chitin-click-02"), animal("chitin-click-03")], gain: 0.30, playbackRate: [0.96, 1.12], minIntervalMs: 700, maxConcurrent: 3 },
} satisfies Record<AudioCueId, AudioCueDefinition>;

export const COREALM_AUDIO_CATALOG = defineAudioCatalog({
  cues,
  loops: {
    "music.starter-plains": { url: music("starter-plains"), bus: "music", gain: 0.62, fadeMs: 1800 },
    "music.distant-plains": { url: music("distant-plains"), bus: "music", gain: 0.62, fadeMs: 1800 },
    "music.deep-woodland": { url: music("deep-woodland"), bus: "music", gain: 0.62, fadeMs: 1800 },
    "music.stone-city": { url: music("stone-city"), bus: "music", gain: 0.62, fadeMs: 1800 },
    "ambient.open-plains": { url: noxAmbience("open-plains-wind"), bus: "ambient", gain: 0.5, fadeMs: 1400 },
    "ambient.deep-woodland": { url: noxAmbience("deep-woodland-birds"), bus: "ambient", gain: 0.52, fadeMs: 1400 },
    "ambient.rocky-highlands": { url: noxAmbience("rocky-highlands-wind"), bus: "ambient", gain: 0.48, fadeMs: 1400 },
    "ambient.cave": { url: noxAmbience("cave-room-tone"), bus: "ambient", gain: 0.56, fadeMs: 1400 },
  },
  regions: {
    fallowmarch: {
      music: ["music.starter-plains", "music.distant-plains"],
      ambient: "ambient.open-plains",
    },
    vellenwood: { music: "music.deep-woodland", ambient: "ambient.deep-woodland" },
    karrowmoor: { music: "music.stone-city", ambient: "ambient.rocky-highlands" },
    // The supplied music library names no ember-foothills theme, so Kilnhalt ships ambience only,
    // exactly like the Gravelmaw. Dry upland wind is the closest rights-traced ambience family.
    kilnhalt: { ambient: "ambient.rocky-highlands" },
    gravelmaw: { ambient: "ambient.cave" },
  },
});

export const FUTURE_REGION_MUSIC_FILES = [
  "desert.mp3", "jungle.mp3", "goblin-village.mp3", "mire-swamp.mp3", "swamp.mp3",
] as const;
