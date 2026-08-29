(function () {
  var R = window.__probeRenderer.r;
  function walk(o, depth) {
    return o.children.map(function (c) {
      var mats = c.isMesh ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
      return { name: c.name || c.type, type: c.type, visible: c.visible, n: c.children.length,
        count: c.isInstancedMesh ? c.count : undefined,
        mat: mats.map(function (m) { return m ? (m.name || m.type) + "|" + (m.color ? m.color.getHexString() : "-") + "|bl" + m.blending + "|tm" + m.toneMapped + "|r" + m.roughness + "|m" + m.metalness : "?"; }),
        kids: depth > 0 ? walk(c, depth - 1) : undefined };
    });
  }
  var over = R.scene.getObjectByName("overlays");
  return over ? walk(over, 1) : "no overlays";
})
