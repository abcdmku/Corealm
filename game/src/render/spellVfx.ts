/**
 * The spell effect layer: charge, flight and impact for all sixteen attack spells, in ONE draw call.
 *
 * This is `render/vfx.ts`'s `Ambience` applied to a second problem, and it holds the same line for
 * the same reason: `npm run perf` measures Highcairn at 397 draw calls against a budget of 400
 * (`app/config.ts` `RENDER_BUDGET`), so a layer that is allowed to exist at all is a layer that
 * costs one call. Everything below follows from that. One `InstancedMesh`, one `PlaneGeometry`, one
 * additive `MeshBasicMaterial`; sixteen sprites reached through a per-instance UV offset rather than
 * sixteen materials; four elements reached through a per-instance tint rather than four textures;
 * and `count = 0, visible = false` when nothing is in the air, so an idle layer costs nothing.
 *
 * The particles are stateless, exactly as `Ambience`'s are: a particle's position is a pure function
 * of (phase, integer hashes off the cast id and the particle index). There is no simulation to step,
 * nothing is allocated per frame, and NOT ONE DRAW COMES FROM AN RNG STREAM — so adding or removing
 * a cast cannot shift a seeded sequence and no acceptance check can flap on this file.
 *
 * WHAT WAS MEASURED HERE, rather than assumed:
 *
 *  - THE V FLIP. `tools/build-vfx-atlas.ts` bakes cell `index = row * 4 + col` with row 0 at the TOP
 *    of the PNG. `THREE.Texture.flipY` defaults true, which uploads the image bottom row first, so
 *    v = 0 is the BOTTOM of the picture. The offset for a cell is therefore `v = (3 - row) * 0.25`,
 *    not `row * 0.25`. Getting this backwards draws the wrong sprite in silence — a fire impact
 *    would throw snowflakes and nothing anywhere would error.
 *
 *  - THE PROGRAM CACHE KEY. three keys a shader program on the material's PROPERTIES and appends
 *    `customProgramCacheKey()`, which defaults to the empty string; `onBeforeCompile` is NOT part of
 *    the key. `Ambience`'s material is parameter-identical to this one — MeshBasicMaterial, map,
 *    transparent, AdditiveBlending, depthWrite false, fog false, toneMapped true, on an
 *    InstancedMesh with an instanceColor — so without a key of its own, whichever of the two
 *    compiled second would be handed the other's program. Half the time that means the whole spell
 *    atlas samples through unpatched UVs and every sprite becomes cell 0 stretched over the quad;
 *    the other half it means world ambience starts reading an `aAtlasOffset` attribute it does not
 *    have. `render/scene.ts:3070` guards `stoneDetail` against the same trap for the same reason.
 *
 *  - THE WARM-UP. `WebGLRenderer.compile` gathers materials with `scene.traverse`, not
 *    `traverseVisible` (three 0.185.1, `WebGLRenderer.js:1433` — only the LIGHT walk above it is
 *    visibility-filtered). So this mesh being hidden while idle does not stop `Renderer.warmup` from
 *    compiling its program, provided the layer is constructed before warmup runs. That matters:
 *    ground-diagnosis finding 12 measured a single mid-session program compile at an 1,130 ms frame,
 *    and the frame a fight's first spell leaves the staff is the worst possible place to pay it.
 *    That reading is right about the traversal and WRONG about the outcome, which is why this is
 *    measured rather than argued: the program count still climbs by one on the first cast
 *    (106 -> 107, second cast adds nothing), and handing the material to
 *    `Renderer.warmup({ materials })` on a proxy mesh did not stop it. So this layer compiles its
 *    own program by DRAWING one degenerate instance on its first idle frame — see `primeShader`.
 *
 *  - THE COVERAGE TRIM. The sixteen cells are wildly unequal as light sources. Mean red channel over
 *    each 256 px cell of the committed atlas: `shard` 142.8, `splat` 97.2, `smoke` 91.4, `ring`
 *    58.9, `flash` 53.2, `flake` 44.2, `spark` 42.6, `glow` 36.0, `streak` 36.0, `slash` 33.7,
 *    `rune` 29.8, `trail` 19.0, `arc` 15.6, `glyph` 12.6, `crack` 11.3, `scorch` 7.9. Untrimmed, an
 *    earth shard prints four times the light of a fire spark at the same size and the same tint, so
 *    an earth impact blows out while a wind impact disappears. `ATLAS_CELLS.gain` is `36 / mean`
 *    where the mean is PRINTED by `tools/build-vfx-atlas.ts` on every bake, so swapping a source
 *    cannot silently invalidate one of these numbers — which it did once, when `spark` moved from a
 *    star outline to the pack's own `Point1` spark texture and its mean went 42.6 -> 74.8.
 *    clamped to 2.4 — a mechanical normalisation against `glow`, with the clamp so the three nearly
 *    empty decal cells are not amplified into their own compression noise. Anything about ROLE (a
 *    trail is dimmer than the head that dropped it) belongs in the per-particle brightness instead,
 *    and lives there.
 *
 *  - SPRITE HANDEDNESS. `streak` (ProjectileFree1) and `trail` (Trail67) both carry their dense head
 *    at the LEFT of the cell and taper to a point at the right, checked against the baked atlas. So
 *    the quad's local -X is what points along travel, and the roll is `screenAngle + PI`. Rolling by
 *    `screenAngle` flies every bolt tail-first, which reads as a bolt being sucked backwards.
 *
 *  - THE HDR GAIN. Hovl Studio's originals are deliberately dim because Unity's particle shader
 *    drove them through an HDR `_Color` of {2, 2, 2}. Nothing in the bake compensates
 *    (`tools/build-vfx-atlas.ts` says so explicitly and leaves the gain here), so `ATLAS_HDR_GAIN`
 *    carries it as one named number that can be tuned against real scene exposure — the renderer
 *    runs ACES tone mapping at exposure 1.00 and these sprites are `toneMapped: true`, so the gain
 *    is not a free multiplier and a larger one buys less than it looks like it should.
 *
 * `hash01` and `hashString` are duplicated from `render/vfx.ts` rather than imported: that file does
 * not export them and it belongs to another owner this wave. They must stay identical in shape, so
 * that both particle layers scatter the same way. A shared `render/hash.ts` is the right home for
 * them and is a job for whoever owns both files at once.
 */
import * as THREE from "three";
import type { SpellElement, SpellRung, Vec3 } from "../contracts.js";
import { ASSET_BASE_URL, SPELL_FLIGHT, spellFlightMs } from "../app/config.js";

/**
 * The element palette, and the only place it is defined.
 *
 * `ui/spellbookPanel.ts` and the audio layer import this rather than re-deriving four more hex
 * pairs, because sixteen spells sharing one sprite set only works if "wind" means the same colour
 * everywhere the player meets it. `core` is the hot centre — the charge glow, the head of the bolt,
 * the impact flash — and `edge` is everything thrown outward from it.
 *
 * These are sRGB hexes. `THREE.Color.setHex` converts them into the linear working space on the way
 * in, which is what makes the additive maths below behave.
 */
export const ELEMENT_COLOURS: Readonly<Record<SpellElement, { core: number; edge: number }>> = {
  wind: { core: 0xe8f0ff, edge: 0x7fa8e8 },
  water: { core: 0xdff2ff, edge: 0x3d8fc4 },
  earth: { core: 0xffe3ae, edge: 0x8a6b3c },
  fire: { core: 0xfff0c4, edge: 0xe0621f },
};

export interface SpellVfxDeps {
  /** Where the mesh is parented. `scene.overlayGroup`. */
  parent: THREE.Object3D;
  /** Billboards copy this object's world rotation verbatim. */
  camera: THREE.Camera;
  /**
   * Terrain height, so a cast rune, a shockwave ring and a scorch decal lie on the ground the player
   * is standing on. Optional: without it everything flat falls back to the impact point's own feet
   * Y, which is right on flat ground and sinks into a slope.
   */
  groundHeightAt?(x: number, z: number): number;
}

export interface SpellCastRequest {
  /** Unique per cast. Dedupes a repeated request, and seeds every hash in the effect. */
  id: string;
  element: SpellElement;
  rung: SpellRung;
  /** Caster position, at the feet. */
  from: Vec3;
  /** Target position, at the feet. */
  to: Vec3;
  /** A miss still flies. It fizzles short of the target instead of bursting on it. */
  hit: boolean;
  /**
   * How long the bolt should take, in REAL milliseconds. Defaults to `flightMs(rung, distance)`.
   *
   * Exists because the damage and the bolt are measured on different clocks. `systems/combat.ts`
   * schedules the hit in SIM milliseconds; this layer flies on the render clock, the way every
   * other effect in the game does. At the normal time scale of 1 those agree, and at any other one
   * they do not - under the harness's `setTimeScale(20)` the sim would land the damage twenty times
   * sooner than the bolt could arrive. `app/loop.ts` divides by the live time scale and passes the
   * result here, so the two stay together at any scale.
   */
  flightMsOverride?: number;
}

// --------------------------------------------------------------------------- atlas

/** Cell ids, in the order `tools/build-vfx-atlas.ts` bakes them. That file carries the full table. */
type CellId =
  | "glow" | "flash" | "spark" | "smoke"
  | "streak" | "trail" | "arc" | "flake"
  | "shard" | "splat" | "scorch" | "crack"
  | "ring" | "rune" | "glyph" | "slash";

interface AtlasCell {
  /** Index into the 4x4 grid. Row 0 is the TOP row of the PNG; see the header on the V flip. */
  readonly index: number;
  /** Coverage trim, `36 / measuredMean` clamped to 2.4. See the header. */
  readonly gain: number;
}

const ATLAS_CELLS: Readonly<Record<CellId, AtlasCell>> = {
  glow: { index: 0, gain: 1.00 },
  flash: { index: 1, gain: 0.68 },
  spark: { index: 2, gain: 0.48 },
  smoke: { index: 3, gain: 0.39 },
  streak: { index: 4, gain: 1.00 },
  trail: { index: 5, gain: 1.89 },
  arc: { index: 6, gain: 2.31 },
  flake: { index: 7, gain: 0.81 },
  shard: { index: 8, gain: 0.25 },
  splat: { index: 9, gain: 0.37 },
  scorch: { index: 10, gain: 2.40 },
  crack: { index: 11, gain: 2.40 },
  ring: { index: 12, gain: 0.61 },
  rune: { index: 13, gain: 1.21 },
  glyph: { index: 14, gain: 2.40 },
  slash: { index: 15, gain: 1.07 },
};

const ATLAS_GRID = 4;
const ATLAS_CELL_SPAN = 1 / ATLAS_GRID;
/** Relative to `ASSET_BASE_URL`, the convention `render/assets.ts` already loads every GLB through. */
const ATLAS_URL = `${ASSET_BASE_URL}vfx/spell-atlas.png`;
/**
 * The gain the source pack was authored against. See the header: Unity drove these through an HDR
 * colour of 2.0 and the bake does not compensate, so the whole atlas is dim by design without this.
 */
const ATLAS_HDR_GAIN = 2.0;

// --------------------------------------------------------------------------- elements and rungs

interface ElementProfile {
  /**
   * The element's own sprites. Everything thrown outward or drawn inward uses these and nothing
   * else, which is the entire budget for "these sixteen spells look different": one tint pair and
   * one or two signature cells. Wind arcs, water freezes and spatters, earth throws chunks, fire
   * throws embers.
   */
  readonly motes: readonly CellId[];
  /** The surge rung's ground mark. Burn for the two that burn, fracture for the two that break. */
  readonly decal: CellId;
  /** Multiplies the CORE tint only. Fire's centre is hotter than the other three at equal size. */
  readonly coreGain: number;
}

const ELEMENTS: Readonly<Record<SpellElement, ElementProfile>> = {
  wind: { motes: ["arc"], decal: "scorch", coreGain: 1.0 },
  water: { motes: ["flake", "splat"], decal: "crack", coreGain: 1.0 },
  earth: { motes: ["shard"], decal: "crack", coreGain: 1.0 },
  fire: { motes: ["spark"], decal: "scorch", coreGain: 1.3 },
};

interface RungProfile {
  /** Projectile radius in metres. Every size in the effect is a multiple of this. */
  readonly radius: number;
  /** How long the impact keeps painting after the hit frame. Not part of `totalMs`. */
  readonly tailMs: number;
  readonly chargeMotes: number;
  readonly trail: number;
  readonly impactMotes: number;
  readonly smoke: number;
  /**
   * Velocity-stretched sparks, per stage: at the caster, streaming off the bolt, and on impact.
   *
   * Weighted A FEW / A FEW / A LOT, which is the shape a thrown spell has — the caster's hand
   * spits a little, the bolt sheds a little in passing, and the ground where it lands is where
   * everything ends up. Spreading them evenly reads as a firework carried on a stick.
   *
   * QUANTITY IS THE ONLY THING THAT SCALES. A spark is a fixed 1.8-4 cm whatever threw it
   * (`SPARK_WIDTH_MIN`), so a surge is not a lash with bigger grains — it is the same grains, seven
   * times as many of them. Scaling the size instead was the first attempt and it produced 12 cm
   * sparks stretched to 70 cm, which read as debris rather than as sparks.
   *
   * That also makes this the cheapest axis in the whole effect: a spark is one instance in the same
   * draw call, with no new material, texture or geometry behind it.
   */
  readonly chargeSparks: number;
  readonly flightSparks: number;
  readonly impactSparks: number;
  readonly ring: boolean;
  readonly runes: boolean;
  readonly slash: boolean;
  readonly decal: boolean;
  /** Path fraction between two trail drops. Derived, so the ribbon covers a fixed share of flight. */
  readonly trailStep: number;
  /** Worst-case instances this rung ever has alive at once, for the particle reservation. */
  readonly peak: number;
}

/**
 * Fills in the two derived fields, so that neither can drift out of step with the counts above it.
 *
 * `peak` is the max across the three stages rather than their sum, because the stages do not
 * overlap: the charge is over before the bolt leaves and the bolt is gone before the impact paints.
 */
function rungProfile(base: Omit<RungProfile, "peak" | "trailStep">): RungProfile {
  const charge = base.chargeMotes + base.chargeSparks + 2 + (base.runes ? 2 : 0);
  const flight = 2 + base.trail + base.flightSparks + (base.slash ? 1 : 0);
  const impact = base.impactMotes + base.impactSparks
    + 1 + (base.ring ? 1 : 0) + base.smoke + (base.decal ? 1 : 0);
  return {
    ...base,
    // The ribbon spans 45% of the path whatever the drop count, so a surge's eleven sprites read as
    // a denser ribbon than a bolt's seven rather than as a four-times-longer one.
    trailStep: base.trail > 0 ? 0.45 / base.trail : 0,
    peak: Math.max(charge, flight, impact),
  };
}

/**
 * Spec section 6, honoured literally. Radius, impact particle count and flight time are the spec's
 * numbers; everything else is what "extra layers" costs in instances.
 *
 * The rungs are cumulative on purpose — a burst keeps the bolt's trail and ring and adds runes and
 * smoke — because the ladder has to read as one spell growing, not as four unrelated effects. A lash
 * is one dart and one small flash and nothing else, which is the whole point of the low end.
 *
 * `totalMs` is the spec's flight column, and the charge is carved OUT of it rather than added in
 * front: `systems/combat.ts` delays the DAMAGE itself by exactly this long, so anything spent
 * winding up before the bolt leaves is time the number is already waiting through. Peaks that come
 * out of `rungProfile`: lash 11, bolt 20, burst 37, surge 54 instances.
 */
const RUNGS: Readonly<Record<SpellRung, RungProfile>> = {
  lash: rungProfile({
    radius: 0.18, tailMs: 420,
    chargeSparks: 6, flightSparks: 4, impactSparks: 26,
    chargeMotes: 4, trail: 0, impactMotes: 10, smoke: 0,
    ring: false, runes: false, slash: false, decal: false,
  }),
  bolt: rungProfile({
    radius: 0.26, tailMs: 520,
    chargeSparks: 10, flightSparks: 7, impactSparks: 58,
    chargeMotes: 6, trail: 7, impactMotes: 18, smoke: 0,
    ring: true, runes: false, slash: false, decal: false,
  }),
  burst: rungProfile({
    radius: 0.36, tailMs: 720,
    chargeSparks: 16, flightSparks: 11, impactSparks: 105,
    chargeMotes: 9, trail: 9, impactMotes: 30, smoke: 5,
    ring: true, runes: true, slash: false, decal: false,
  }),
  surge: rungProfile({
    radius: 0.48, tailMs: 950,
    chargeSparks: 24, flightSparks: 16, impactSparks: 175,
    chargeMotes: 12, trail: 11, impactMotes: 44, smoke: 7,
    ring: true, runes: true, slash: true, decal: true,
  }),
};

// --------------------------------------------------------------------------- tuning

/**
 * Hard cap on live spell instances, separate from Ambience's 640.
 *
 * Raised from 320 when the spark stages landed: a surge's impact alone is now 90 sparks on top of
 * its motes, smoke, ring, flash and decal, and it peaks around 140 instances against the 54 it used
 * to. At 320 that left room for barely two, so a second cast landing while the first was still
 * painting would have started evicting a burst the player was looking at.
 *
 * 640 is still ONE draw call and one buffer — instances are the cheap axis here, which is exactly
 * why the detail was bought in sparks rather than in more layers. It leaves room for four of the
 * largest spell in the game at once, which no single caster on a 3000 ms cast can reach.
 */
const MAX_PARTICLES = 640;

/**
 * Beyond this from the camera a cast paints nothing, though it still ages and still reaps.
 *
 * Far more generous than Ambience's 30–75 m culls, deliberately. Smoke is scenery and can be culled
 * on a look; a spell is a gameplay signal, and a bolt that vanished because the camera drifted would
 * read as a bug. `CAMERA.far` is 280, so this only ever fires on something well off screen.
 */
const CULL_METRES = 110;

/** Below this an instance is not worth a slot: under one 8-bit step even after the HDR gain. */
const MIN_BRIGHTNESS = 0.004;

/** Forward nudge from the emission point toward the target, so the bolt clears the caster's body. */
const HAND_REACH = 0.35;
/** Impact height above the target's feet: centre of mass on the entity scale the rigs use. */
const IMPACT_HEIGHT = 1.0;

/**
 * Midpoint lift as a share of the throw distance. 8% of a 6 m throw is a 0.48 m rise, which is
 * enough to stop the bolt reading as a laser at the default camera pitch and not enough to make it
 * look lobbed.
 */
const ARC_SHARE = 0.08;

/**
 * Debris gravity, m/s^2. Faster than the real 9.81 so that every thrown mote is back on the ground
 * before its own tail runs out; a slower one leaves sparks hanging in the air after the light that
 * threw them has gone, which reads as a leak rather than as an impact.
 */
const DEBRIS_GRAVITY = 11;

/**
 * Spark gravity, m/s^2. Heavier than the debris it flies with.
 *
 * A spark is small and hot and has to arc HARD — it is thrown fast, turns over quickly and dies in
 * the air, which is what separates a spray of sparks from a slow shower of glowing chunks. At the
 * debris value the fast ones sailed off flat and left the burst looking like a starburst decal.
 */
const SPARK_GRAVITY = 26;

/**
 * Spark width in METRES, and deliberately not a multiple of the rung radius.
 *
 * The first pass scaled it off `radius` like everything else in the effect, which made a surge's
 * sparks 12 cm across and, stretched, 70 cm long — grains of light the size of the caster's forearm.
 * A spark is a fixed physical thing: a bigger spell throws MORE of them, never bigger ones. That is
 * what the reference actually shows, and it is why this is an absolute number while the flash, ring
 * and decal beside it all still scale.
 *
 * 1.8 to 4 cm wide, so at the default camera pitch a spark is a few pixels of core with its glow
 * around it — which is the whole look.
 */
const SPARK_WIDTH_MIN = 0.018;
const SPARK_WIDTH_MAX = 0.040;

/**
 * How far a spark is stretched along its own velocity, as a multiple of its width.
 *
 * The range is per-particle rather than fixed so a burst is a mix of near-points and long streaks;
 * one uniform length reads as a printed pattern. The low end stays above 1 because a spark that is
 * not stretched at all is the round dot this replaced. Raised with the size cut: at 2 cm wide a
 * streak needs to be proportionally longer before it reads as travelling at all.
 */
const SPARK_STRETCH_MIN = 2.4;
const SPARK_STRETCH_MAX = 7.0;

/** Spark width for a particle, from one of its stable hashes. */
function sparkWidth(h: number): number {
  return SPARK_WIDTH_MIN + (SPARK_WIDTH_MAX - SPARK_WIDTH_MIN) * h;
}

const TAU = Math.PI * 2;

interface LiveCast {
  readonly id: string;
  readonly profile: RungProfile;
  readonly element: ElementProfile;
  readonly seed: number;
  readonly hit: boolean;
  readonly bornAtMs: number;
  /**
   * Charge plus travel for THIS cast, in ms.
   *
   * Per cast rather than per rung, because travel now scales with how far the bolt actually has to
   * go. `app/loop.ts` computes the same number from the same distance to schedule the damage
   * number, so the two agree by construction.
   */
  readonly totalMs: number;
  readonly chargeMs: number;
  /** Charge end to impact. */
  readonly travelMs: number;
  readonly tailMs: number;
  readonly endMs: number;
  /** Staff hand. */
  readonly originX: number; readonly originY: number; readonly originZ: number;
  /** Where the bolt ends: the target's chest, or short of it on a miss. */
  readonly impactX: number; readonly impactY: number; readonly impactZ: number;
  readonly arcLift: number;
  readonly casterGroundY: number;
  readonly impactGroundY: number;
  /** Linear core and edge tints, with the element's core gain already folded in. */
  readonly coreR: number; readonly coreG: number; readonly coreB: number;
  readonly edgeR: number; readonly edgeG: number; readonly edgeB: number;
}

/**
 * Every spell effect in the game, as one additive InstancedMesh.
 *
 * See the file header for the five things that are load-bearing and non-obvious: the V flip, the
 * program cache key, the warm-up path, the per-cell coverage trim and the sprite handedness.
 */
/** Scratch for `primeShader`, allocated once at module scope so the prime frame allocates nothing. */
const ZERO_SCALE = new THREE.Matrix4();
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0);
const IDENTITY_QUATERNION = new THREE.Quaternion();
/** Well under any terrain, so a rounding error cannot put the degenerate quad in front of the camera. */
const FAR_BELOW = new THREE.Vector3(0, -10_000, 0);

export class SpellVfx {
  private readonly mesh: THREE.InstancedMesh;
  private readonly texture: THREE.Texture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly atlasOffsets: Float32Array;
  /** One-shot: see `primeShader`. */
  private primed = false;
  private readonly atlasAttribute: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private readonly casts: LiveCast[] = [];
  private live = 0;
  /** Sum of `peak` over the live casts. What the cap is enforced against, in `cast()`. */
  private reserved = 0;

  // Scratch. Allocated once, mutated in place; `update()` must not allocate.
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly viewer = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private readonly inverseFacing = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly orient = new THREE.Quaternion();
  private readonly colour = new THREE.Color();
  private readonly spriteNormal = new THREE.Vector3(0, 0, 1);
  private readonly flatFacing =
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  /** Tints of the cast currently being written. Set once per cast, read once per instance. */
  private coreR = 1; private coreG = 1; private coreB = 1;
  private edgeR = 1; private edgeG = 1; private edgeB = 1;

  constructor(private readonly deps: SpellVfxDeps) {
    this.capacity = MAX_PARTICLES;

    this.texture = loadAtlas();

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.atlasOffsets = new Float32Array(this.capacity * 2);
    this.atlasAttribute = new THREE.InstancedBufferAttribute(this.atlasOffsets, 2);
    this.atlasAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aAtlasOffset", this.atlasAttribute);

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Same reason `Ambience` turns it off: fog on an additive sprite ADDS the fog colour on top of
      // the world instead of fading the sprite into it, so a spell cast at 60 m would print brighter
      // than the same spell cast at 6 m.
      fog: false,
      toneMapped: true,
    });

    // Required, and the sharpest trap in this file. See the header: without a key of its own this
    // material and `Ambience`'s are indistinguishable to three's program cache, and whichever
    // compiles second silently inherits the other's shader.
    this.material.customProgramCacheKey = (): string => "corealm-spell-atlas-v1";
    this.material.onBeforeCompile = (shader): void => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aAtlasOffset;")
        // Patching AFTER the stock chunk rather than replacing its body: `uv_vertex` writes a dozen
        // different varyings depending on which maps are bound, and `vMapUv` is the one
        // `map_fragment` reads. Rewriting it in place survives a three upgrade that adds another map
        // to that chunk; a pasted copy of the chunk body would not.
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>\n\tvMapUv = aAtlasOffset + vMapUv * ${ATLAS_CELL_SPAN.toFixed(6)};`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
    this.mesh.name = "spell-vfx";
    const instanceColour = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    instanceColour.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = instanceColour;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Last of the transparent layers: Ambience is 7, the telegraph ring 8 and 9, and the overlay
    // markers in `render/overlays.ts` are 10. Additive blending is commutative, so this is not a
    // correctness requirement against the other additive layer — but the telegraph and the overlay
    // markers are NORMAL-blended, and a spell landing inside a boss telegraph or on a marked target
    // should print on top of both rather than under whichever way three happens to break the tie.
    this.mesh.renderOrder = 11;
    // Instances follow whatever is being cast at, so a bounding sphere would span the fight and the
    // frustum test would never cull anything it did not also have to recompute. Cull by distance in
    // `update()` instead, the way Ambience does.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.deps.parent.add(this.mesh);
  }

  /**
   * Total ms from `cast()` to the impact frame. `app/loop.ts` delays the damage number by this.
   *
   * An instance method rather than a static one because the envelope is this object's business: a
   * caller holding a `SpellVfx` should not also have to know which module the table lives in.
   */
  /**
   * Delegates to `app/config.ts`, which is the one place this timing lives.
   *
   * It stopped being a render decision when the sim started scheduling DAMAGE against it: a spell
   * hurts nothing until it arrives, so `systems/combat.ts` reads the same function to decide when
   * the health bar moves. Two copies of the table would be a bolt that lands visibly before or
   * after the damage it carries.
   */
  flightMs(rung: SpellRung, distanceM = 0): number {
    return spellFlightMs(rung, distanceM);
  }

  /**
   * Starts one cast. Everything the effect needs is resolved here, once, so that `update()` does no
   * terrain queries, no colour conversion and no allocation.
   */
  cast(request: SpellCastRequest, nowMs: number): void {
    for (const existing of this.casts) {
      if (existing.id === request.id) return;
    }

    const profile = RUNGS[request.rung];
    const element = ELEMENTS[request.element];

    // Over the cap, drop the OLDEST cast whole. Starving the newest instead would leave the effect
    // the player is actually watching missing its impact, which is the one frame that carries
    // whether the spell landed.
    while (this.casts.length > 0 && this.reserved + profile.peak > this.capacity) {
      const dropped = this.casts.shift();
      if (dropped) this.reserved -= dropped.profile.peak;
    }

    const fromX = request.from[0];
    const fromY = request.from[1];
    const fromZ = request.from[2];
    const toX = request.to[0];
    const toY = request.to[1];
    const toZ = request.to[2];

    const spanX = toX - fromX;
    const spanZ = toZ - fromZ;
    const ground = Math.hypot(spanX, spanZ);
    // Degenerate throw — a target standing inside the caster. Pick an axis rather than divide by
    // zero; every direction is equally wrong, and a NaN here poisons the whole instance buffer.
    const unitX = ground > 1e-4 ? spanX / ground : 0;
    const unitZ = ground > 1e-4 ? spanZ / ground : 1;

    // `from` IS the muzzle, whatever the caller decided that is. It used to be the caster's feet,
    // lifted here by a fixed 1.25 m to approximate a hand; `app/loop.ts` now passes the point
    // directly (`castOrigin`, the caster's centre at 1.1 m) because that is the layer that can see
    // the rig and the equipment. Reading the staff's crown through the hand bone was tried in
    // between and read WORSE — the crown swings through a wide arc during the cast, so the bolt
    // appeared flung from wherever the arm happened to be rather than aimed.
    //
    // The forward nudge stays: it is relative to whatever the caller gave, and it keeps the first
    // frames of the bolt from drawing inside the caster's own silhouette.
    const originX = fromX + unitX * HAND_REACH;
    const originY = fromY;
    const originZ = fromZ + unitZ * HAND_REACH;

    let impactX = toX;
    let impactY = toY + IMPACT_HEIGHT;
    let impactZ = toZ;
    if (!request.hit) {
      // A miss dies SHORT, and slightly low. Both halves matter: short is what the player reads at a
      // glance, and the sag is what stops a short bolt looking like a bolt that simply stopped.
      const shortfall = Math.min(1.4, ground * 0.2);
      impactX -= unitX * shortfall;
      impactZ -= unitZ * shortfall;
      impactY -= 0.25;
    }

    // `ground` is the XZ span computed above, so the effect's own clock and the damage number's
    // deadline in `app/loop.ts` are derived from the same distance.
    // The caller's duration when it gave one, so the bolt lands with the damage whatever the sim
    // clock is doing. Clamped to something drawable: at a very high time scale the honest real-time
    // duration is a couple of frames, and a bolt that exists for one frame reads as a teleport.
    const totalMs = request.flightMsOverride !== undefined
      ? Math.max(90, request.flightMsOverride)
      : this.flightMs(request.rung, ground);
    // Charge is carved OUT of the flight rather than added in front of it, so `totalMs` really is
    // release-to-impact — which is what `systems/combat.ts` scheduled the damage against. Read from
    // the same shared table for the same reason.
    const chargeMs = Math.min(SPELL_FLIGHT[request.rung].chargeMs, totalMs * 0.5);
    const tailMs = request.hit ? profile.tailMs : profile.tailMs * 0.55;

    // Ground heights are sampled once, here. The alternative — sampling per frame — would hit the
    // heightfield up to four times a frame per cast, for marks that never move.
    const casterGroundY = this.deps.groundHeightAt?.(fromX, fromZ) ?? fromY;
    // The fallback is the target's FEET, not the impact point 1.0 m above them: a shockwave ring
    // seated at chest height reads as a floating disc, which is worse than a ring buried in a slope.
    const impactGroundY = this.deps.groundHeightAt?.(impactX, impactZ) ?? toY;

    const palette = ELEMENT_COLOURS[request.element];
    this.colour.setHex(palette.core);
    const coreR = this.colour.r * element.coreGain;
    const coreG = this.colour.g * element.coreGain;
    const coreB = this.colour.b * element.coreGain;
    this.colour.setHex(palette.edge);

    this.casts.push({
      id: request.id,
      profile,
      element,
      seed: hashString(request.id),
      hit: request.hit,
      bornAtMs: nowMs,
      totalMs,
      chargeMs,
      travelMs: Math.max(1, totalMs - chargeMs),
      tailMs,
      endMs: nowMs + totalMs + tailMs,
      originX, originY, originZ,
      impactX, impactY, impactZ,
      arcLift: Math.hypot(impactX - originX, impactZ - originZ) * ARC_SHARE,
      casterGroundY,
      impactGroundY,
      coreR, coreG, coreB,
      edgeR: this.colour.r, edgeG: this.colour.g, edgeB: this.colour.b,
    });
    this.reserved += profile.peak;
  }

  /** Rewrites every live instance. Ticks on the render clock, like `Vfx.update`. */
  update(nowMs: number): void {
    if (this.casts.length === 0) {
      this.live = 0;
      if (this.mesh.visible) {
        this.mesh.count = 0;
        this.mesh.visible = false;
      }
      return;
    }

    this.deps.camera.getWorldPosition(this.viewer);
    this.deps.camera.getWorldQuaternion(this.facing);
    this.inverseFacing.copy(this.facing).invert();
    this.live = 0;

    // Newest first. The reservation in `cast()` already keeps the total inside the buffer, so this
    // order only decides who loses if that ever fails — and it should be the cast the player has
    // already stopped looking at.
    for (let index = this.casts.length - 1; index >= 0; index -= 1) {
      const cast = this.casts[index];
      if (!cast) continue;
      if (nowMs >= cast.endMs) {
        this.casts.splice(index, 1);
        this.reserved -= cast.profile.peak;
        continue;
      }
      const dx = (cast.originX + cast.impactX) * 0.5 - this.viewer.x;
      const dz = (cast.originZ + cast.impactZ) * 0.5 - this.viewer.z;
      if (dx * dx + dz * dz > CULL_METRES * CULL_METRES) continue;
      this.writeCast(cast, nowMs);
    }

    this.mesh.count = this.live;
    this.mesh.visible = this.live > 0;
    if (this.live > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.atlasAttribute.needsUpdate = true;
    }

    this.primeShader();
  }

  /**
   * Draws ONE degenerate instance on the first idle frame, so this layer's program is compiled by a
   * real draw rather than by the first spell of a fight.
   *
   * This exists because the two cheaper answers were both tried and both measured as not working.
   * `WebGLRenderer.compile` gathers materials with a plain `scene.traverse` (three 0.185.1,
   * three.module.js:17426), so the mesh being hidden should not matter — but `getMetrics().programs`
   * still climbed 106 -> 107 on the first cast of a session. Handing the material to
   * `Renderer.warmup({ materials })` on a one-instance proxy did not stop it either: the proxy
   * carries the same material and `customProgramCacheKey`, and something in the pairing still
   * differs enough that the real draw compiles again. Rather than keep guessing which parameter,
   * this compiles the ACTUAL mesh, geometry, attributes and material — the thing that will really be
   * drawn — by drawing it.
   *
   * The instance is a zero-scale matrix with a black colour, so it covers no pixels and adds no
   * light; the cost is one frame with `count = 1` instead of `count = 0`, once per session. The
   * flag is set before the early return so a frame that happens to be culled cannot retry forever.
   */
  private primeShader(): void {
    if (this.primed) return;
    this.primed = true;
    if (this.live > 0) return;
    ZERO_SCALE.compose(FAR_BELOW, IDENTITY_QUATERNION, ZERO_VECTOR);
    this.mesh.setMatrixAt(0, ZERO_SCALE);
    this.colour.setRGB(0, 0, 0);
    this.mesh.setColorAt(0, this.colour);
    this.atlasAttribute.setXY(0, 0, 0);
    this.mesh.count = 1;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.atlasAttribute.needsUpdate = true;
  }

  /** Live instances. 0 means the layer costs nothing at all this frame. */
  liveParticles(): number {
    return this.live;
  }

  /** Draw calls this layer is adding. Exactly 0 or 1, by construction. */
  drawCalls(): number {
    return this.mesh.visible ? 1 : 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    // The texture is this layer's own — nothing else in the project loads the atlas — so it is
    // disposed here rather than left to the material, which does not own it.
    this.texture.dispose();
    this.mesh.dispose();
    this.casts.length = 0;
    this.reserved = 0;
    this.live = 0;
  }

  // ------------------------------------------------------------- internals

  private writeCast(cast: LiveCast, nowMs: number): void {
    this.coreR = cast.coreR; this.coreG = cast.coreG; this.coreB = cast.coreB;
    this.edgeR = cast.edgeR; this.edgeG = cast.edgeG; this.edgeB = cast.edgeB;

    const age = nowMs - cast.bornAtMs;
    if (age < cast.chargeMs) {
      this.writeCharge(cast, clamp01(age / cast.chargeMs), nowMs);
    } else if (age < cast.totalMs) {
      this.writeFlight(cast, clamp01((age - cast.chargeMs) / cast.travelMs));
    } else {
      this.writeImpact(cast, clamp01((age - cast.totalMs) / cast.tailMs));
    }

    // The cast circle outlives the charge by a beat, so a burst does not blink its runes off in the
    // same frame the bolt leaves. Driven from here rather than from `writeCharge` for exactly that.
    if (cast.profile.runes) this.writeRunes(cast, age);
  }

  /** Stage 1: element sprites spiralling in onto a brightening core at the staff hand. */
  private writeCharge(cast: LiveCast, phase: number, nowMs: number): void {
    const radius = cast.profile.radius;
    const fadeOut = Math.min(1, (1 - phase) * 6);
    // A slow beat on the core. Deterministic — a function of the clock and a hash, not a draw.
    const beat = 0.88 + 0.12 * Math.sin(nowMs * 0.021 + hash01(cast.seed, 0, 1) * TAU);

    this.write("glow", cast.originX, cast.originY, cast.originZ,
      radius * (1.1 + 2.4 * phase * phase), 0, false, 0,
      (0.30 + 0.85 * phase * phase) * beat * fadeOut);
    this.write("glow", cast.originX, cast.originY, cast.originZ,
      radius * (2.2 + 3.2 * phase), 0, false, 0.8, (0.10 + 0.32 * phase) * fadeOut);

    for (let index = 0; index < cast.profile.chargeMotes; index += 1) {
      const a = hash01(cast.seed, index, 2);
      const b = hash01(cast.seed, index, 3);
      const c = hash01(cast.seed, index, 4);
      // Each mote runs its own inward pass 1.6 times over the charge, offset by a hash, so the read
      // is a continuous stream converging rather than one synchronised ring closing.
      const p = fract(phase * 1.6 + c);
      const distance = radius * (0.4 + 4.4 * (1 - p));
      const angle = a * TAU + p * 2.6;
      const elevation = (b - 0.5) * 1.3;
      this.write(
        this.mote(cast, index),
        cast.originX + Math.cos(angle) * distance,
        cast.originY + Math.sin(elevation) * distance * 0.6,
        cast.originZ + Math.sin(angle) * distance,
        radius * (0.34 + 0.42 * p) * (0.75 + 0.5 * b),
        a * TAU,
        false,
        1,
        Math.min(1, p * 5) * (1 - p * p) * (0.5 + 0.5 * p) * fadeOut,
      );
    }

    // A FEW sparks spitting off the hand while the cast winds up. Deliberately the smallest of the
    // three stages: this is the sound of a match being struck, not the fire. They fall AWAY from the
    // gather — the motes above converge inward, so sparks moving the other way keep the wind-up from
    // reading as one uniform swirl.
    for (let index = 0; index < cast.profile.chargeSparks; index += 1) {
      const a = hash01(cast.seed, index, 26);
      const b = hash01(cast.seed, index, 27);
      const c = hash01(cast.seed, index, 28);
      const p = fract(phase * 1.15 + c);
      const angle = a * TAU;
      const speed = radius * (2.6 + b * 3.2);
      const seconds = p * 0.34;
      const horizontal = speed * seconds;
      const vy = speed * 0.55 - SPARK_GRAVITY * seconds;
      this.write(
        "spark",
        cast.originX + Math.cos(angle) * horizontal,
        cast.originY + (speed * 0.55 * seconds - 0.5 * SPARK_GRAVITY * seconds * seconds),
        cast.originZ + Math.sin(angle) * horizontal,
        sparkWidth(b),
        this.rollAlong(Math.cos(angle) * speed, vy, Math.sin(angle) * speed),
        false,
        0.1,
        Math.min(1, p * 6) * Math.pow(1 - p, 1.8) * 1.7 * fadeOut,
        SPARK_STRETCH_MIN + (SPARK_STRETCH_MAX - SPARK_STRETCH_MIN) * b,
      );
    }
  }

  /** The two counter-rotating ground quads under a burst or surge caster. */
  private writeRunes(cast: LiveCast, age: number): void {
    // 1.4x the charge, so they hold under the caster through the first beat of the flight, then go.
    const span = cast.chargeMs * 1.4;
    if (age >= span) return;
    const phase = clamp01(age / span);
    const envelope = Math.min(1, phase * 5) * (1 - phase) * (1 - phase);
    if (envelope <= MIN_BRIGHTNESS) return;

    const radius = cast.profile.radius;
    // Counter-rotating, and at different rates: two rings turning together read as one texture, and
    // the whole point of the second quad is that the circle looks driven rather than pasted on.
    this.write("rune", cast.originX, cast.casterGroundY + 0.04, cast.originZ,
      radius * 8.5, phase * 2.2, true, 0.35, envelope * 0.9);
    this.write("glyph", cast.originX, cast.casterGroundY + 0.07, cast.originZ,
      radius * 5.2, -phase * 3.1, true, 0.7, envelope * 1.1);
  }

  /** Stage 2: the bolt, its halo, the ribbon it drops, and the surge's opening sweep. */
  private writeFlight(cast: LiveCast, phase: number): void {
    const radius = cast.profile.radius;
    const roll = this.travelRoll(cast, phase);
    this.pathAt(cast, phase);
    const headX = this.point.x;
    const headY = this.point.y;
    const headZ = this.point.z;

    // A missed bolt guts out over the last third of its flight, so the failure has started to read
    // before it reaches the point where nothing happens.
    const guttering = cast.hit ? 1 : 1 - 0.55 * clamp01((phase - 0.66) / 0.34);

    this.write("streak", headX, headY, headZ, radius * 3.0, roll, false, 0.15, 1.15 * guttering);
    this.write("glow", headX, headY, headZ, radius * 3.6, 0, false, 0.75, 0.55 * guttering);

    // Trail drops are QUANTISED onto fixed points of the path, so a sprite really does stay where it
    // was dropped and fade in place. Interpolating from the live head instead drags the whole ribbon
    // forward every frame, which reads as a rubber band rather than as a wake.
    // A few sparks shed off the bolt in passing. Dropped at fixed points of the path like the trail
    // is, so they stay where they were shed and fall away rather than being dragged along.
    for (let index = 0; index < cast.profile.flightSparks; index += 1) {
      const a = hash01(cast.seed, index, 24);
      const b = hash01(cast.seed, index, 25);
      const shedAt = phase - (0.06 + a * 0.5);
      if (shedAt <= 0) continue;
      const age = phase - shedAt;
      this.pathAt(cast, shedAt);
      const drop = age * age * 5.5 * radius;
      const spread = radius * (0.5 + b * 1.4) * age * 6;
      const angle = b * TAU;
      this.write(
        "spark",
        this.point.x + Math.cos(angle) * spread,
        this.point.y - drop,
        this.point.z + Math.sin(angle) * spread,
        sparkWidth(b),
        roll,
        false,
        0.2,
        Math.pow(1 - clamp01(age / 0.55), 2.0) * 1.6 * guttering,
        SPARK_STRETCH_MIN + (SPARK_STRETCH_MAX - SPARK_STRETCH_MIN) * a,
      );
    }

    const step = cast.profile.trailStep;
    if (step > 0) {
      const newest = Math.floor(phase / step);
      const life = step * cast.profile.trail;
      for (let index = 0; index < cast.profile.trail; index += 1) {
        const at = (newest - index) * step;
        if (at <= 0) break;
        const dying = clamp01((phase - at) / life);
        const brightness = (1 - dying) * (1 - dying) * 0.6 * guttering;
        if (brightness <= MIN_BRIGHTNESS) continue;
        this.pathAt(cast, at);
        this.write("trail", this.point.x, this.point.y, this.point.z,
          radius * (2.2 - 1.1 * dying), this.travelRoll(cast, at), false, 0.55, brightness);
      }
    }

    if (cast.profile.slash) {
      // The surge's opening frame: one wide sweep at the hand as the spell tears loose.
      const sweep = clamp01(phase / 0.32);
      this.pathAt(cast, 0.12);
      this.write("slash", this.point.x, this.point.y, this.point.z,
        radius * (5.5 + 5.0 * sweep), roll, false, 0.25,
        Math.min(1, sweep * 6) * (1 - sweep) * (1 - sweep) * 1.2);
    }
  }

  /** Stage 3: the landing — or, on a miss, the fizzle that has to read as one at a glance. */
  private writeImpact(cast: LiveCast, phase: number): void {
    const profile = cast.profile;
    const radius = profile.radius;
    const seconds = (cast.tailMs / 1000) * phase;

    if (cast.hit) {
      // The flash owns the first fifth of the tail and nothing else. It is the frame that says the
      // spell connected, so it is short, hot, and much larger than the bolt that delivered it.
      const flash = clamp01(phase / 0.18);
      this.write("flash", cast.impactX, cast.impactY, cast.impactZ,
        radius * (4.5 + 5.5 * flash), hash01(cast.seed, 0, 7) * TAU, false, 0.05,
        (1 - flash) * (1 - flash) * 1.4);

      if (profile.ring) {
        const ring = clamp01(phase / 0.6);
        this.write("ring", cast.impactX, cast.impactGroundY + 0.05, cast.impactZ,
          radius * (3 + 12 * ring), 0, true, 0.45,
          Math.min(1, ring * 10) * (1 - ring) * (1 - ring) * 0.9);
      }

      for (let index = 0; index < profile.smoke; index += 1) {
        const a = hash01(cast.seed, index, 8);
        const b = hash01(cast.seed, index, 9);
        const rise = clamp01((phase - 0.06 - a * 0.14) / 0.8);
        if (rise <= 0) continue;
        const drift = radius * (0.6 + b * 1.2) * rise;
        this.write("smoke",
          cast.impactX + Math.cos(a * TAU) * drift,
          cast.impactY + rise * radius * 3.2,
          cast.impactZ + Math.sin(a * TAU) * drift,
          radius * (1.8 + 3.6 * rise), a * TAU + rise * 0.5, false, 1,
          // Kept low: this is additive, so smoke can only ADD light. Bright smoke over a lit field
          // is a white smear, and the settle only has to say "something burned here".
          Math.min(1, rise * 5) * (1 - rise) * (1 - rise) * 0.42);
      }

      if (profile.decal) {
        this.write(cast.element.decal, cast.impactX, cast.impactGroundY + 0.03, cast.impactZ,
          radius * 11, hash01(cast.seed, 0, 10) * TAU, true, 0.75,
          Math.min(1, phase * 16) * Math.pow(1 - phase, 0.7) * 0.85);
      }
    } else {
      // The fizzle. It SHRINKS where a hit expands, and it is edge-tinted rather than core-tinted,
      // so the two differ in shape and in colour and not only in how much is on screen.
      const collapse = clamp01(phase / 0.5);
      this.write("glow", cast.impactX, cast.impactY, cast.impactZ,
        radius * (3.0 - 2.3 * collapse), 0, false, 0.95,
        (1 - collapse) * (1 - collapse) * 0.8);
    }

    // THE SPARK BURST. The thing a spell landing is mostly made of, and the reason a surge reads as
    // ninety times more expensive than a lash rather than four times.
    //
    // Each spark is thrown on its own ballistic arc and STRETCHED along the direction it is
    // currently travelling, recomputed per frame from the analytic velocity — so a spark that is
    // still climbing is a near-vertical streak and one that has turned over lies flat, exactly the
    // spray in Hovl's own spark systems. A round dot at this size and count reads as static; the
    // stretch is what makes it move.
    const sparkCount = cast.hit
      ? profile.impactSparks
      : Math.max(3, Math.round(profile.impactSparks / 4));
    for (let index = 0; index < sparkCount; index += 1) {
      const a = hash01(cast.seed, index, 21);
      const b = hash01(cast.seed, index, 22);
      const c = hash01(cast.seed, index, 23);
      const angle = a * TAU;
      // Biased upward and outward. Fully spherical scatter buries half the burst in the floor.
      const elevation = 0.1 + b * 1.25;
      const speed = radius * (7 + c * 12) * (cast.hit ? 1 : 0.45);
      const cosE = Math.cos(elevation);
      const sinE = Math.sin(elevation);
      const horizontal = cosE * speed * seconds;
      const vertical = sinE * speed * seconds - 0.5 * SPARK_GRAVITY * seconds * seconds;
      const y = cast.impactY + vertical;
      // Below the floor is gone, not clamped: a spark is a spent ember, and sliding along the
      // ground the way debris does reads as litter.
      if (y < cast.impactGroundY) continue;
      // Analytic velocity of the same arc, for the stretch direction.
      const vy = sinE * speed - SPARK_GRAVITY * seconds;
      const roll = this.rollAlong(Math.cos(angle) * cosE * speed, vy, Math.sin(angle) * cosE * speed);
      const fade = Math.min(1, phase * 22) * Math.pow(1 - phase, 2.2);
      this.write(
        "spark",
        cast.impactX + Math.cos(angle) * horizontal,
        y,
        cast.impactZ + Math.sin(angle) * horizontal,
        sparkWidth(b),
        roll,
        false,
        // Core-tinted: a spark is the hot part. The element's colour still comes through because
        // core and edge share a hue.
        0.1,
        fade * 2.0,
        // Longer as it flies faster, which is what sells it as motion rather than as a dash.
        SPARK_STRETCH_MIN + (SPARK_STRETCH_MAX - SPARK_STRETCH_MIN) * c,
      );
    }

    // About a third of the scatter on a miss, spec section 4: a miss has to be cheap as well as
    // legible, and a fizzle throwing a full impact's worth of debris is neither.
    const count = cast.hit ? profile.impactMotes : Math.max(2, Math.round(profile.impactMotes / 3));
    for (let index = 0; index < count; index += 1) {
      const a = hash01(cast.seed, index, 11);
      const b = hash01(cast.seed, index, 12);
      const c = hash01(cast.seed, index, 13);
      const angle = a * TAU;
      const elevation = 0.15 + b * 1.15;
      const speed = radius * (4 + c * 5) * (cast.hit ? 1 : 0.5);
      const horizontal = Math.cos(elevation) * speed * seconds;
      const vertical = Math.sin(elevation) * speed * seconds - 0.5 * DEBRIS_GRAVITY * seconds * seconds;
      // Debris settles ON the floor rather than through it. Clamping is cheaper than reaping and it
      // reads better: chunks slide to a stop instead of vanishing at ground level.
      const y = Math.max(cast.impactY + vertical, cast.impactGroundY + 0.05);
      this.write(
        this.mote(cast, index),
        cast.impactX + Math.cos(angle) * horizontal,
        y,
        cast.impactZ + Math.sin(angle) * horizontal,
        radius * (0.5 + 0.4 * b) * (1 - 0.35 * phase),
        angle + phase * (c - 0.5) * 6,
        false,
        1,
        Math.min(1, phase * 14) * Math.pow(1 - phase, 1.7) * 1.1,
      );
    }
  }

  /** The element's signature sprite for one particle index. */
  private mote(cast: LiveCast, index: number): CellId {
    const motes = cast.element.motes;
    return motes[index % motes.length] ?? "spark";
  }

  /** Point on the arced path at `t`, into `this.point`. A parabola peaking at the midpoint. */
  private pathAt(cast: LiveCast, t: number): void {
    this.point.set(
      cast.originX + (cast.impactX - cast.originX) * t,
      cast.originY + (cast.impactY - cast.originY) * t + 4 * cast.arcLift * t * (1 - t),
      cast.originZ + (cast.impactZ - cast.originZ) * t,
    );
  }

  /**
   * In-plane roll that lays a sprite's local -X along the direction of travel, in SCREEN space.
   *
   * The tangent is transformed by the inverse camera rotation rather than projected, which needs no
   * matrix and no near-plane special case: in camera space x is screen right and y is screen up, so
   * the screen angle falls straight out of `atan2`. The `+ PI` is the sprite handedness measured off
   * the atlas — see the file header.
   */
  private travelRoll(cast: LiveCast, t: number): number {
    return this.rollAlong(
      cast.impactX - cast.originX,
      cast.impactY - cast.originY + 4 * cast.arcLift * (1 - 2 * t),
      cast.impactZ - cast.originZ,
    ) + Math.PI;
  }

  /**
   * Screen-space roll that lays a sprite's X axis along a WORLD direction.
   *
   * The billboard already faces the camera, so a world vector has to be brought into the sprite's
   * own frame before its angle means anything — that is what `inverseFacing` is for. Shared by the
   * bolt (which adds PI, because its sprite's dense end is at -X) and by every stretched spark,
   * which is symmetric and does not care which end leads.
   */
  private rollAlong(dx: number, dy: number, dz: number): number {
    this.direction.set(dx, dy, dz);
    this.direction.applyQuaternion(this.inverseFacing);
    return Math.atan2(this.direction.y, this.direction.x);
  }

  /**
   * One instance: matrix, tint and atlas cell.
   *
   * `mix` picks along the element's core-to-edge ramp, 0 hot centre and 1 outer. `flat` lays the
   * quad on the ground instead of facing the camera; `roll` spins it in its own plane, which is a
   * screen-space roll for a billboard and a compass rotation for a ground quad, because in both
   * cases the plane's normal is its local +Z.
   */
  private write(
    cell: CellId,
    x: number,
    y: number,
    z: number,
    size: number,
    roll: number,
    flat: boolean,
    mix: number,
    brightness: number,
    /**
     * Length along the sprite's own X, as a multiple of `size`. 1 is a square billboard.
     *
     * This is what makes a spark a SPARK. Hovl's spark systems stretch each particle along its
     * velocity, so a burst reads as a spray of little streaks rather than a cloud of dots — visible
     * in the pack's own screenshots, and the single biggest difference between "sparks" and
     * "confetti". The quad is scaled on X and then rolled to the direction of travel, so `roll` and
     * `stretch` are always set together.
     */
    stretch = 1,
  ): void {
    if (brightness <= MIN_BRIGHTNESS || size <= 0) return;
    const slot = this.live;
    if (slot >= this.capacity) return;
    const spec = ATLAS_CELLS[cell];

    this.position.set(x, y, z);
    this.scale.set(size * stretch, size, size);
    const base = flat ? this.flatFacing : this.facing;
    if (roll === 0) {
      this.orient.copy(base);
    } else {
      this.spin.setFromAxisAngle(this.spriteNormal, roll);
      this.orient.copy(base).multiply(this.spin);
    }
    this.matrix.compose(this.position, this.orient, this.scale);
    this.mesh.setMatrixAt(slot, this.matrix);

    const light = brightness * spec.gain * ATLAS_HDR_GAIN;
    this.colour.setRGB(
      (this.coreR + (this.edgeR - this.coreR) * mix) * light,
      (this.coreG + (this.edgeG - this.coreG) * mix) * light,
      (this.coreB + (this.edgeB - this.coreB) * mix) * light,
    );
    this.mesh.setColorAt(slot, this.colour);

    const offset = slot * 2;
    this.atlasOffsets[offset] = (spec.index % ATLAS_GRID) * ATLAS_CELL_SPAN;
    // Row 0 is the top of the image and flipY puts the top at v = 1. See the file header.
    this.atlasOffsets[offset + 1] =
      (ATLAS_GRID - 1 - Math.floor(spec.index / ATLAS_GRID)) * ATLAS_CELL_SPAN;

    this.live = slot + 1;
  }
}

/**
 * The atlas texture, sampler settings and all.
 *
 * The DOM guard is not paranoia. `TextureLoader` goes through `ImageLoader`, which builds an `<img>`
 * with `document.createElementNS`, and this repo runs vitest in the default NODE environment with no
 * jsdom — verified by constructing one under plain node, which throws
 * `ReferenceError: document is not defined`. Any headless test of the particle cap, the determinism
 * of the hashes or `flightMs` would die in this constructor before reaching what it came to check.
 *
 * The empty `Texture` still gets ASSIGNED to `material.map`, which is the part that matters: three
 * builds the program from `map !== null`, so the browser and the test compile the same shader
 * parameters and only the pixels are missing on the side that never draws.
 */
function loadAtlas(): THREE.Texture {
  const texture = typeof document === "undefined"
    ? new THREE.Texture()
    // The error callback is the difference between a visible fault and an invisible one. Without it
    // a missing or renamed atlas resolves to an unloaded texture, three samples it as opaque WHITE,
    // and every spell in the game silently becomes a white square — which looks like a broken
    // shader rather than a missing file, and sends the next person to read this code instead of the
    // build output. `debug/gameDebug.ts getErrors()` has no reach here, so the console is the
    // channel, and `tools/verify-magic.ts` fails the run on any console error.
    : new THREE.TextureLoader().load(ATLAS_URL, undefined, undefined, (error: unknown) => {
      console.error(
        `[spellVfx] spell atlas failed to load from ${ATLAS_URL}. Every spell will draw as a white `
        + "square. Rebuild it with `npx tsx tools/build-vfx-atlas.ts`.",
        error,
      );
    });
  // NoColorSpace, matching `render/vfx.ts`'s own sprite: the atlas is a MASK, not a picture. The
  // bake writes `luminance * alpha` into RGB with alpha pinned to 255, so the byte value IS the
  // share of the instance tint this texel adds. Decoding it as sRGB would put a gamma curve through
  // a falloff that was already authored as one and crush every soft edge in the pack.
  texture.colorSpace = THREE.NoColorSpace;
  // Mipmapped, and the bake's 3 px guard band exists for this: a spell lands 40 m away as often as
  // 4 m, and at mip 4 and beyond an unguarded cell bleeds its neighbour's corner into the sprite.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  // Clamped, so a shifted UV can never wrap into the cell on the far side of the sheet.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** FNV-1a, so the same cast id scatters the same way on every reload. Shape from `render/vfx.ts`. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Integer hash to 0..1. Deterministic, allocation-free, and not an rng stream draw. */
function hash01(seed: number, index: number, salt: number): number {
  let hash = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97) >>> 0;
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}
