// Scene census for the lighting wave. Plain JS, not TS: tsx's esbuild transform injects a `__name`
// helper that does not exist inside page scope.
(function () {
  var hook = window.__probeRenderer;
  if (!hook) return { error: "no probe hook" };
  var R = hook.r;
  function describe(o) { var c = []; var n = o; while (n) { c.unshift(n.name || n.type); n = n.parent; } return c.join("/"); }

  // 1. Everything that ADDS light to a pixel: emissive materials and non-normal blending.
  var emissive = [];
  var additive = [];
  var seenE = {}, seenA = {};
  R.scene.traverse(function (o) {
    if (!o.isMesh) return;
    var vis = true, n = o; while (n) { if (!n.visible) { vis = false; break; } n = n.parent; }
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m) continue;
      if ((m.blending === 2 || m.blending === 3) && !seenA[m.uuid]) {
        seenA[m.uuid] = 1;
        var cols = [];
        var live = o.isInstancedMesh ? o.count : 1;
        if (o.instanceColor) for (var q = 0; q < Math.min(live, 8); q++) {
          cols.push([+o.instanceColor.getX(q).toFixed(2), +o.instanceColor.getY(q).toFixed(2), +o.instanceColor.getZ(q).toFixed(2)]);
        }
        additive.push({
          path: describe(o), visible: vis, blending: m.blending, live: live,
          toneMapped: m.toneMapped, fog: m.fog, opacity: m.opacity, sample: cols,
        });
      }
      var ei = m.emissiveIntensity || 0;
      if (m.emissive && ei > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0 && !seenE[m.uuid]) {
        seenE[m.uuid] = 1;
        emissive.push({ path: describe(o).slice(-70), visible: vis, name: m.name, emissive: "#" + m.emissive.getHexString(), intensity: ei, toneMapped: m.toneMapped, hasMap: !!m.emissiveMap });
      }
    }
  });

  // 2. Effective albedo: material.color x the mean texel of its base map, which is what three
  // multiplies per fragment. Anything under ~0.01 renders as black no matter how it is lit.
  var texMean = {};
  function mapMean(tex) {
    if (!tex || !tex.image) return null;
    if (texMean[tex.uuid]) return texMean[tex.uuid];
    try {
      var c = document.createElement("canvas");
      c.width = 64; c.height = 64;
      var g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(tex.image, 0, 0, 64, 64);
      var d = g.getImageData(0, 0, 64, 64).data;
      var s = [0, 0, 0], k = 0;
      for (var i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; k++; }
      var v = k ? [s[0] / k / 255, s[1] / k / 255, s[2] / k / 255] : null;
      texMean[tex.uuid] = v;
      return v;
    } catch (e) { return null; }
  }
  function toLinear(v) { return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var albedo = [];
  var seenM = {};
  R.scene.traverse(function (o) {
    if (!o.isMesh) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m || !m.color || seenM[m.uuid]) continue;
      seenM[m.uuid] = 1;
      var mm = mapMean(m.map);
      var lin = mm ? [toLinear(mm[0]), toLinear(mm[1]), toLinear(mm[2])] : [1, 1, 1];
      var eff = [m.color.r * lin[0], m.color.g * lin[1], m.color.b * lin[2]];
      albedo.push({
        mat: m.name || m.type,
        color: "#" + m.color.getHexString(),
        map: mm ? mm.map(function (v) { return +(v * 255).toFixed(0); }).join(",") : null,
        vc: m.vertexColors === true,
        effLum: +(0.2126 * eff[0] + 0.7152 * eff[1] + 0.0722 * eff[2]).toFixed(4),
        obj: describe(o).slice(-70),
      });
    }
  });
  albedo.sort(function (a, b) { return a.effLum - b.effLum; });

  // 3. Vertex-colour census. A UBYTE COLOR_0 read into an integer array truncates to zero and
  // paints the mesh black; this reports any colour attribute whose mean is near zero.
  var vcol = [];
  var seenG = {};
  R.scene.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.color) return;
    if (seenG[o.geometry.uuid]) return;
    seenG[o.geometry.uuid] = 1;
    var col = o.geometry.attributes.color;
    var mn = 9, mx = -9, sum = 0, k = Math.min(col.count, 4096);
    for (var i = 0; i < k; i++) for (var c = 0; c < 3; c++) { var v = col.getComponent(i, c); if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    var mean = sum / (k * 3);
    if (mean < 0.35) vcol.push({ obj: describe(o).slice(-70), min: +mn.toFixed(3), max: +mx.toFixed(3), mean: +mean.toFixed(3), norm: col.normalized, arr: col.array.constructor.name });
  });

  // 4. Lights.
  var lights = [];
  R.scene.traverse(function (o) {
    if (!o.isLight) return;
    lights.push({
      type: o.type, name: describe(o).slice(-50), intensity: o.intensity,
      color: "#" + o.color.getHexString(),
      distance: o.distance, decay: o.decay, visible: o.visible,
    });
  });

  return {
    exposure: R.renderer.toneMappingExposure,
    environmentIntensity: R.scene.environmentIntensity,
    fog: R.scene.fog ? { color: [+R.scene.fog.color.r.toFixed(4), +R.scene.fog.color.g.toFixed(4), +R.scene.fog.color.b.toFixed(4)], near: R.scene.fog.near, far: R.scene.fog.far } : null,
    lights: lights,
    emissive: emissive,
    additive: additive,
    darkest: albedo.slice(0, 24),
    brightest: albedo.slice(-8),
    darkVertexColours: vcol.slice(0, 24),
    materialCount: Object.keys(seenM).length,
  };
})
