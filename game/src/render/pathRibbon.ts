/**
 * The guide ribbon: a ground route that reads as paint on the ground rather than as a wire.
 *
 * `THREE.Line` with `LineBasicMaterial` is one device pixel wide on every WebGL platform
 * (`linewidth` is ignored), so the old route was a hairline that vanished at any distance and
 * looked like a debug draw when it did not. This is a strip instead: two edge vertices per sample,
 * each seated on its OWN ground height so the strip banks with the slope, and a fragment program
 * that paints a soft translucent body, a thin brighter rim, and a run of chevrons that drift toward
 * the destination so the direction of travel is legible without an arrowhead.
 *
 * On the house pattern (`render/materials.ts`, `render/spellVfx.ts`): a stock `MeshBasicMaterial`
 * patched through `onBeforeCompile` — fog and tone mapping come for free — with its own
 * `customProgramCacheKey`, because three keys programs on material properties and NOT on the patch.
 *
 * Overdraw: one ribbon under a metre wide along one route. `render/scene.ts` removed 42 road
 * ribbons that covered the whole world for overdraw; this is nothing like that scale, and it is
 * depth-tested against the ground it sits 0.22 m above rather than drawn over everything.
 */
import * as THREE from "three";

/** Full width is twice this. A little over a metre: a stripe from the follow camera, not a wire. */
export const RIBBON_HALF_WIDTH = 0.55;
/** Metres between chevrons. */
const CHEVRON_SPACING = 1.9;
/** Metres per second the chevrons drift toward the destination. */
const CHEVRON_SPEED = 1.35;
/** A corner's miter is capped here, so a hairpin does not spike. */
const MITER_LIMIT = 1.6;

export interface RibbonUniforms {
  uTime: { value: number };
  uLength: { value: number };
  /**
   * Metres along the centreline where the visible ribbon begins. Slid forward every frame from
   * the player's render position, which is what keeps a walk smooth: the geometry stands still
   * and only the fade moves, so nothing is rebuilt between re-plans and nothing pops when one
   * happens — the new ribbon starts exactly where the old one's head was.
   */
  uHead: { value: number };
}

export interface RibbonBuild {
  geometry: THREE.BufferGeometry;
  /** Metres along the centreline. */
  length: number;
  /** The centreline as (x, z, metres along) triples, for `projectAlong`. */
  centre: Float32Array;
}

/**
 * Where a world point sits against a ribbon's centreline: how far along, and how far off to the
 * side. Linear in the sample count; a route is at most a few hundred samples.
 */
export function projectAlong(centre: Float32Array, x: number, z: number): { along: number; lateral: number } {
  const count = centre.length / 3;
  let bestAlong = 0;
  let bestLateral = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < count; index += 1) {
    const ax = centre[index * 3]!;
    const az = centre[index * 3 + 1]!;
    const bx = centre[(index + 1) * 3]!;
    const bz = centre[(index + 1) * 3 + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const lateral = Math.hypot(x - px, z - pz);
    if (lateral < bestLateral) {
      bestLateral = lateral;
      const alongA = centre[index * 3 + 2]!;
      const alongB = centre[(index + 1) * 3 + 2]!;
      bestAlong = alongA + (alongB - alongA) * t;
    }
  }
  return { along: bestAlong, lateral: Number.isFinite(bestLateral) ? bestLateral : 0 };
}

/**
 * Strip geometry along an XZ polyline. `groundY` is called once per edge vertex.
 *
 * `aTrail` carries (metres along, -1..1 across) so the fragment program can place chevrons by
 * distance and fade the edges by position, with no dependence on the UV chunks a stock material
 * only compiles in when it has a map.
 */
export function buildRibbonGeometry(
  samples: readonly (readonly [number, number])[],
  groundY: (x: number, z: number) => number,
  halfWidth: number,
  lift: number,
): RibbonBuild | null {
  const count = samples.length;
  if (count < 2) return null;

  const positions = new Float32Array(count * 2 * 3);
  const trail = new Float32Array(count * 2 * 2);
  const indices = new Uint32Array((count - 1) * 6);
  const centre = new Float32Array(count * 3);

  let along = 0;
  for (let index = 0; index < count; index += 1) {
    const [x, z] = samples[index]!;
    const prev = samples[Math.max(index - 1, 0)]!;
    const next = samples[Math.min(index + 1, count - 1)]!;
    if (index > 0) along += Math.hypot(x - prev[0], z - prev[1]);
    centre[index * 3] = x;
    centre[index * 3 + 1] = z;
    centre[index * 3 + 2] = along;

    // The averaged tangent at a corner, and the miter that keeps the strip its full width there.
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tangentLength = Math.hypot(tx, tz) || 1;
    tx /= tangentLength;
    tz /= tangentLength;
    let miter = 1;
    if (index > 0 && index < count - 1) {
      let ox = next[0] - x;
      let oz = next[1] - z;
      const outLength = Math.hypot(ox, oz) || 1;
      ox /= outLength;
      oz /= outLength;
      const cosHalf = tx * ox + tz * oz;
      miter = Math.min(MITER_LIMIT, 1 / Math.max(cosHalf, 1 / MITER_LIMIT));
    }
    const nx = -tz * halfWidth * miter;
    const nz = tx * halfWidth * miter;

    const left = index * 2;
    const right = left + 1;
    const leftX = x + nx;
    const leftZ = z + nz;
    const rightX = x - nx;
    const rightZ = z - nz;
    positions[left * 3] = leftX;
    positions[left * 3 + 1] = groundY(leftX, leftZ) + lift;
    positions[left * 3 + 2] = leftZ;
    positions[right * 3] = rightX;
    positions[right * 3 + 1] = groundY(rightX, rightZ) + lift;
    positions[right * 3 + 2] = rightZ;
    trail[left * 2] = along;
    trail[left * 2 + 1] = 1;
    trail[right * 2] = along;
    trail[right * 2 + 1] = -1;

    if (index < count - 1) {
      const quad = index * 6;
      indices[quad] = left;
      indices[quad + 1] = right;
      indices[quad + 2] = left + 2;
      indices[quad + 3] = right;
      indices[quad + 4] = right + 2;
      indices[quad + 5] = left + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aTrail", new THREE.BufferAttribute(trail, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, length: along, centre };
}

/**
 * The paint. Balanced against a SwiftShader capture of the Bracken Pit route (2026-09-02): at the
 * first cut the body was 0.30 alpha and the chevrons were mixed 45 % toward white, and from the
 * follow camera the result read as a string of white dashes with no band between them. The body
 * now carries the colour and the chevrons are a lighter tint of it, not white.
 */
const RIBBON_FRAGMENT = `
{
  float across = abs(vTrail.y);
  float body = 1.0 - smoothstep(0.62, 1.0, across);
  float rim = smoothstep(0.70, 0.80, across) * (1.0 - smoothstep(0.90, 1.0, across));
  // Chevrons: a band by distance TO GO, so the pattern is pinned to the destination and a re-plan
  // from a new start does not re-phase it. The EDGES are held back so the centre leads and the
  // apex points the way the route runs. (Subtracting across here put the apex toward the player:
  // the edges led and the centre lagged, an arrow pointing home. Measured on the Bracken Pit capture.)
  float toGo = uLength - vTrail.x;
  float phase = fract((-toGo - uTime * ${CHEVRON_SPEED.toFixed(3)} + across * 0.6) / ${CHEVRON_SPACING.toFixed(3)});
  float chevron = smoothstep(0.0, 0.16, phase) * (1.0 - smoothstep(0.30, 0.46, phase));
  // Nothing under the character's feet — the head slides with them — and an ease-out where the
  // destination ring takes over.
  float headFade = smoothstep(0.0, 1.8, vTrail.x - uHead);
  float tailFade = 1.0 - smoothstep(uLength - 1.6, uLength - 0.2, vTrail.x);
  float fade = headFade * mix(0.15, 1.0, tailFade);
  vec3 tint = mix(diffuseColor.rgb, vec3(1.0), 0.28);
  diffuseColor.rgb = mix(diffuseColor.rgb, tint, clamp(chevron * body + rim * 0.6, 0.0, 1.0));
  diffuseColor.a *= (body * 0.5 + rim * 0.4 + chevron * body * 0.35) * fade;
}
`;

/** One material per ribbon (it owns `uLength`); every ribbon shares one program. */
export function createRibbonMaterial(colour: THREE.Color, uniforms: RibbonUniforms): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Annotation paint, not a lit surface: under the scene's ACES exposure the route colour came
    // out as a pale wash (measured on the same capture as the fragment balance above).
    toneMapped: false,
  });
  // Required: see the header. Parameter-identical stock materials would otherwise be handed this
  // program, or this material one of theirs, depending on which compiled first.
  material.customProgramCacheKey = (): string => "corealm-guide-ribbon-v1";
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uLength = uniforms.uLength;
    shader.uniforms.uHead = uniforms.uHead;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aTrail;\nvarying vec2 vTrail;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvTrail = aTrail;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vTrail;\nuniform float uTime;\nuniform float uLength;\nuniform float uHead;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${RIBBON_FRAGMENT}`);
  };
  return material;
}
