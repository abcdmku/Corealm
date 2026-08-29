import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

# ---------------------------------------------------------------- use it in scatterInstanced
old = '''      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material) return;
      parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });'''
new = '''      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material) return;
      parts.push({
        geometry: mesh.geometry,
        // The six platformer rocks ship with no UVs and no texture, so a scattered crag drew as a
        // smooth flat cone. See `stoneDetail`.
        material: needsStoneDetail(mesh.geometry, material) ? stoneDetail(material) : material,
        matrix: mesh.matrixWorld.clone(),
      });'''
assert old in s
s = s.replace(old, new, 1)

# ---------------------------------------------------------------- the material itself
anchor = '// ------------------------------------------------------------ region fields'
assert anchor in s

block = r'''// ------------------------------------------------------- untextured stone

/**
 * Screen-space relief and mottling for a mesh that has NO UVs and therefore cannot be textured.
 *
 * THE MEASUREMENT. Of the 213 shipped GLBs, 19 carry no texture at all, and the six that matter
 * are the ultimate-platformer rocks: `boulder_large`, `boulder_medium`, `cliff_tall` and
 * `cliff_step_1..3`. Their primitives carry POSITION and NORMAL and nothing else — no TEXCOORD_0,
 * no COLOR_0 — under one `baseColorFactor` of (0.384, 0.208, 0.108) at roughness 0.85. The
 * stylized-nature-megakit rocks beside them (`rock_medium_*`, `pebble_*`, `path_rock_*`) all carry
 * TEXCOORD_0 and an embedded `Rocks_Diffuse` or `PathRocks_Diffuse` jpeg. So this is not a tint
 * being flattened, a texture failing to load, or an atlas tiling once across a large mesh: there is
 * no UV set to sample any texture with, at any scale, and no material swap can fix it. It is why
 * runs/corealm/screenshots/w3-karrowmoor_terraces.png is two thirds smooth pale-tan cones — the
 * Karrowmoor `crags` scatter layer draws `boulder_medium` at up to 2.4x and `cliff_tall` at 1.8x.
 *
 * WHAT THIS DOES INSTEAD. Two octaves of 3D value noise evaluated at the WORLD position need no UVs
 * at all, and the same scalar drives three things: the diffuse mottling, a roughness break-up, and
 * — through `dFdx`/`dFdy` of that scalar — a bump-mapped normal. That last one is what actually
 * kills the cone read; colour alone leaves the silhouette smooth. The perturbation is three's own
 * `perturbNormalArb` inlined, exactly as `materials.ts` `GROUND_NORMAL_BODY` does it and for the
 * same reason: that function is only compiled under `USE_BUMPMAP` and these materials have no
 * bumpMap, so it is not in the program to call.
 *
 * COST. No extra draw calls — the derived material replaces the source on the same
 * `InstancedMesh`, one for one. One extra compiled program per distinct source material, which is
 * two for the whole world (`boulder_medium`'s `Rock` and `cliff_tall`'s), and it is paid at the
 * boot warmup rather than on a frame. Per fragment it is 16 hash evaluations plus the four
 * derivatives, and only on rock.
 *
 * Exported because `render/entityViews.ts` draws the SAME six assets through `BatchedMesh` for
 * landmark and scatter entities and is a different owner's file; `buildings.ts` has moved every
 * composition it owns off the platformer rocks, but `content/regions.ts` still names
 * `boulder_large` as the Great Cairn's hero mesh and `boulder_medium` as the Thornline Stones'.
 */
const STONE_DETAIL_CACHE = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/**
 * The neutral the flat platformer brown is pulled toward, and how far.
 *
 * (0.384, 0.208, 0.108) linear renders as sRGB (166, 125, 93), which is the tan in the shots. At
 * 0.75 toward 0x6d6f6e it lands at sRGB (124, 114, 105) — a warm grey that sits with the megakit
 * rocks beside it instead of glowing against them — and the noise then swings it 0.74x to 1.26x.
 */
const STONE_TINT = 0x6d6f6e;
const STONE_TINT_MIX = 0.75;

/** How hard the noise gradient bends the normal. 2.6 was read off the crags at 20-30 m, not close up. */
const STONE_BUMP_SCALE = 2.6;

const STONE_SHARED_HEADER = /* glsl */ `
varying vec3 vStoneWorld;
`;

const STONE_VERTEX_BODY = /* glsl */ `
{
  // `transformed` is still the object-space position after <project_vertex>; this repeats that
  // chunk's own instancing and batching steps rather than trying to invert the view matrix, which
  // GLSL ES 1.00 has no `inverse` for.
  vec4 stoneObject = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    stoneObject = batchingMatrix * stoneObject;
  #endif
  #ifdef USE_INSTANCING
    stoneObject = instanceMatrix * stoneObject;
  #endif
  vStoneWorld = ( modelMatrix * stoneObject ).xyz;
}
`;

const STONE_FRAGMENT_HEADER = /* glsl */ `
float gStoneRelief = 0.0;

float stoneHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float stoneNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( stoneHash( i + vec3( 0.0, 0.0, 0.0 ) ), stoneHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
         mix( stoneHash( i + vec3( 0.0, 1.0, 0.0 ) ), stoneHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( stoneHash( i + vec3( 0.0, 0.0, 1.0 ) ), stoneHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
         mix( stoneHash( i + vec3( 0.0, 1.0, 1.0 ) ), stoneHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
`;

const STONE_COLOUR_BODY = /* glsl */ `
{
  // 0.53 m and 2.4 m features, plus a bedding term in world Y warped by the coarse octave. The
  // bedding is what makes a 9 m crag read as rock rather than as noise sprayed on a cone.
  float fine = stoneNoise( vStoneWorld * 1.9 );
  float coarse = stoneNoise( vStoneWorld * 0.42 );
  float bedding = sin( vStoneWorld.y * 2.1 + coarse * 6.28 );
  gStoneRelief = fine * 0.55 + coarse * 0.45 + bedding * 0.13;
  diffuseColor.rgb *= 0.74 + 0.52 * gStoneRelief;
}
`;

const STONE_ROUGHNESS_BODY = /* glsl */ `
roughnessFactor = clamp( roughnessFactor * ( 0.86 + 0.26 * gStoneRelief ), 0.2, 1.0 );
`;

const STONE_NORMAL_BODY = /* glsl */ `
{
  vec2 dHdxy = vec2( dFdx( gStoneRelief ), dFdy( gStoneRelief ) ) * ${STONE_BUMP_SCALE.toFixed(1)};
  vec3 sigmaX = normalize( dFdx( - vViewPosition ) );
  vec3 sigmaY = normalize( dFdy( - vViewPosition ) );
  vec3 r1 = cross( sigmaY, normal );
  vec3 r2 = cross( normal, sigmaX );
  float det = dot( sigmaX, r1 );
  normal = normalize( abs( det ) * normal - sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 ) );
}
`;

/** True when a (geometry, material) pair has no UV set and no base-colour map to sample with one. */
export function needsStoneDetail(geometry: THREE.BufferGeometry, material: THREE.Material): boolean {
  if (geometry.getAttribute("uv") !== undefined) return false;
  const standard = material as THREE.MeshStandardMaterial;
  return standard.isMeshStandardMaterial === true && standard.map === null;
}

/** The derived material for one untextured source material. Cached, so the program compiles once. */
export function stoneDetail(source: THREE.Material): THREE.MeshStandardMaterial {
  const cached = STONE_DETAIL_CACHE.get(source);
  if (cached) return cached;

  const derived = (source as THREE.MeshStandardMaterial).clone();
  derived.name = `${source.name || "stone"}-detail`;
  derived.color.lerp(new THREE.Color(STONE_TINT), STONE_TINT_MIX);
  // Required: without a cache key of its own, three keys the program on the material's PROPERTIES,
  // so an untouched copy of the same GLB material would be handed this one's compiled program.
  derived.customProgramCacheKey = () => "corealm-stone-detail-v1";
  derived.onBeforeCompile = (shader) => {
    shader.vertexShader = `${STONE_SHARED_HEADER}\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${STONE_VERTEX_BODY}`,
    );
    shader.fragmentShader = `${STONE_SHARED_HEADER}${STONE_FRAGMENT_HEADER}\n${shader.fragmentShader}`
      .replace("#include <color_fragment>", `#include <color_fragment>\n${STONE_COLOUR_BODY}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${STONE_ROUGHNESS_BODY}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${STONE_NORMAL_BODY}`);
  };
  STONE_DETAIL_CACHE.set(source, derived);
  return derived;
}

'''

s = s.replace(anchor, block + anchor, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
