(function ({ pts }) {
  var hook = window.__probeRenderer;
  if (!hook) return { error: "no probe hook" };
  var R = hook.r, THREE = hook.THREE;
  var W = window.innerWidth, H = window.innerHeight;
  var ray = new THREE.Raycaster();
  R.camera.updateMatrixWorld(true);
  function describe(o) { var c = []; var n = o; while (n) { c.unshift(n.name || n.type); n = n.parent; } return c.join("/"); }
  function matInfo(m) {
    if (!m) return null;
    return {
      type: m.type, name: m.name,
      color: m.color ? "#" + m.color.getHexString() : null,
      vertexColors: m.vertexColors === true,
      map: m.map ? (m.map.name || "map") : null,
      emissive: m.emissive ? "#" + m.emissive.getHexString() : null,
      emissiveIntensity: m.emissiveIntensity,
      metalness: m.metalness, roughness: m.roughness,
      transparent: m.transparent, blending: m.blending, fog: m.fog, toneMapped: m.toneMapped,
      envMapIntensity: m.envMapIntensity, opacity: m.opacity,
    };
  }
  function colStats(col) {
    if (!col) return null;
    var mn = 9, mx = -9, sum = 0, n = Math.min(col.count, 4096);
    for (var i = 0; i < n; i++) for (var c = 0; c < 3; c++) { var v = col.getComponent(i, c); if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    return mn.toFixed(3) + ".." + mx.toFixed(3) + " mean " + (sum / (n * 3)).toFixed(3) + " norm=" + col.normalized + " arr=" + col.array.constructor.name;
  }
  var hits = [];
  for (var k = 0; k < pts.length; k++) {
    var px = pts[k][0], py = pts[k][1];
    ray.setFromCamera(new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1), R.camera);
    var found = ray.intersectObject(R.scene, true).filter(function (h) {
      var n = h.object; while (n) { if (!n.visible) return false; n = n.parent; }
      return true;
    });
    var top = [];
    for (var j = 0; j < Math.min(found.length, 3); j++) {
      var h = found[j];
      var ic = h.object.instanceColor;
      var instCol = (ic && h.instanceId !== undefined) ? [ic.getX(h.instanceId).toFixed(3), ic.getY(h.instanceId).toFixed(3), ic.getZ(h.instanceId).toFixed(3)].join(",") : null;
      top.push({
        path: describe(h.object), dist: +h.distance.toFixed(2),
        point: [+h.point.x.toFixed(2), +h.point.y.toFixed(2), +h.point.z.toFixed(2)],
        instanceId: h.instanceId, instanceColor: instCol,
        colorAttr: colStats(h.object.geometry && h.object.geometry.attributes.color),
        material: matInfo(Array.isArray(h.object.material) ? h.object.material[0] : h.object.material),
      });
    }
    hits.push({ px: px, py: py, top: top });
  }
  // Emissive and additive census: everything that can ADD light to a pixel.
  var glow = [];
  var amb = [];
  R.scene.traverse(function (o) {
    if (!o.isMesh) return;
    var vis = true, n = o; while (n) { if (!n.visible) { vis = false; break; } n = n.parent; }
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m) continue;
      if (m.blending === 2 || m.blending === 3) {
        var live = o.isInstancedMesh ? o.count : 1;
        var cols = [];
        if (o.instanceColor) for (var q = 0; q < Math.min(live, 12); q++) cols.push([+o.instanceColor.getX(q).toFixed(2), +o.instanceColor.getY(q).toFixed(2), +o.instanceColor.getZ(q).toFixed(2)]);
        amb.push({ path: describe(o), visible: vis, blending: m.blending, count: live, capacity: o.isInstancedMesh ? o.instanceMatrix.count : 1, toneMapped: m.toneMapped, fog: m.fog, opacity: m.opacity, sampleColors: cols });
      }
      var ei = m.emissiveIntensity || 0;
      if (m.emissive && ei > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
        glow.push({ path: describe(o), visible: vis, name: m.name, emissive: "#" + m.emissive.getHexString(), intensity: ei, toneMapped: m.toneMapped });
      }
    }
  });
  // Effective albedo census: material.color multiplied by the mean texel of its base map, which is
  // what three actually multiplies per fragment. A kit texture that already carries the colour plus
  // a tint on top of it is the double-darkening this looks for.
  var texMean = {};
  function mapMean(tex) {
    if (!tex || !tex.image) return null;
    var key = tex.uuid;
    if (texMean[key]) return texMean[key];
    try {
      var c = document.createElement("canvas");
      c.width = 64; c.height = 64;
      var g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(tex.image, 0, 0, 64, 64);
      var d = g.getImageData(0, 0, 64, 64).data;
      var s2 = [0, 0, 0], n2 = 0;
      for (var i2 = 0; i2 < d.length; i2 += 4) { if (d[i2 + 3] < 8) continue; s2[0] += d[i2]; s2[1] += d[i2 + 1]; s2[2] += d[i2 + 2]; n2++; }
      var out = n2 ? [s2[0] / n2 / 255, s2[1] / n2 / 255, s2[2] / n2 / 255] : null;
      texMean[key] = out;
      return out;
    } catch (e) { return null; }
  }
  function srgbToLinear(v) { return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var albedo = [];
  var seenMat = {};
  R.scene.traverse(function (o) {
    if (!o.isMesh) return;
    var vis = true, n = o; while (n) { if (!n.visible) { vis = false; break; } n = n.parent; }
    if (!vis) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m || !m.color || seenMat[m.uuid]) continue;
      seenMat[m.uuid] = 1;
      var mm = mapMean(m.map);
      var lin = mm ? [srgbToLinear(mm[0]), srgbToLinear(mm[1]), srgbToLinear(mm[2])] : [1, 1, 1];
      var eff = [m.color.r * lin[0], m.color.g * lin[1], m.color.b * lin[2]];
      var lum = 0.2126 * eff[0] + 0.7152 * eff[1] + 0.0722 * eff[2];
      albedo.push({
        mat: m.name || m.type, color: "#" + m.color.getHexString(),
        mapMean: mm ? mm.map(function (v) { return +(v * 255).toFixed(0); }).join(",") : null,
        effLum: +lum.toFixed(4), obj: describe(o).slice(-90),
      });
    }
  });
  albedo.sort(function (a, b) { return a.effLum - b.effLum; });
  // Ambience blob analysis: project every live additive instance to screen and report, per screen
  // cluster, how many overlap and what they sum to. Additive blending means the SUM is what the
  // tone mapper sees.
  var blobs = [];
  R.scene.traverse(function (o) {
    if (!o.isInstancedMesh || !o.instanceColor) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats[0].blending !== 2) return;
    var v = new THREE.Vector3();
    var m4 = new THREE.Matrix4();
    var pts = [];
    for (var i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
      var scl = new THREE.Vector3().setFromMatrixScale(m4).x;
      var wp = v.clone();
      v.project(R.camera);
      if (v.z > 1) continue;
      pts.push({
        x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H,
        c: [o.instanceColor.getX(i), o.instanceColor.getY(i), o.instanceColor.getZ(i)],
        scale: scl, dist: R.camera.position.distanceTo(wp),
      });
    }
    // Cluster by screen proximity: a blob is what overlaps within one sprite radius.
    var used = [];
    for (var a = 0; a < pts.length; a++) {
      if (used[a]) continue;
      var grp = [a]; used[a] = 1;
      for (var b = 0; b < pts.length; b++) {
        if (used[b]) continue;
        if (Math.abs(pts[a].x - pts[b].x) < 30 && Math.abs(pts[a].y - pts[b].y) < 30) { grp.push(b); used[b] = 1; }
      }
      var sum = [0, 0, 0];
      for (var g = 0; g < grp.length; g++) { sum[0] += pts[grp[g]].c[0]; sum[1] += pts[grp[g]].c[1]; sum[2] += pts[grp[g]].c[2]; }
      blobs.push({ n: grp.length, x: Math.round(pts[a].x), y: Math.round(pts[a].y),
        sum: sum.map(function (z) { return +z.toFixed(2); }),
        scale: +pts[a].scale.toFixed(2), dist: +pts[a].dist.toFixed(1) });
    }
  });
  blobs.sort(function (a, b) { return (b.sum[0] + b.sum[1] + b.sum[2]) - (a.sum[0] + a.sum[1] + a.sum[2]); });
  var census = {};
  R.scene.traverse(function (o) {
    if (!o.isMesh) return;
    var col = o.geometry && o.geometry.attributes.color;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m || m.vertexColors !== true || !col) continue;
      var sum = 0, n = Math.min(col.count, 2048);
      for (var q = 0; q < n; q++) for (var c = 0; c < 3; c++) sum += col.getComponent(q, c);
      var mean = sum / (n * 3);
      var key = (m.name || m.type);
      if (!census[key]) census[key] = { count: 0, mean: +mean.toFixed(3), arr: col.array.constructor.name, norm: col.normalized, color: m.color ? "#" + m.color.getHexString() : null, map: !!m.map, sampleObj: describe(o), min: 9, max: -9 };
      var e = census[key];
      for (var q2 = 0; q2 < n; q2++) for (var c2 = 0; c2 < 3; c2++) { var v2 = col.getComponent(q2, c2); if (v2 < e.min) e.min = v2; if (v2 > e.max) e.max = v2; }
      e.count++;
    }
  });
  return { blobs: blobs.slice(0, 10), hits: hits, darkest: albedo.slice(0, 30), brightest: albedo.slice(-8), materials: albedo.length, additive: amb, emissive: glow.slice(0, 40), emissiveCount: glow.length, census: census };
})
