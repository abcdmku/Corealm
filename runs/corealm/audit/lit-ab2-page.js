(function (arg) {
  var R = window.__probeRenderer.r;
  var n = 0;
  if (arg.mode === "group") {
    R.scene.traverse(function (o) { if (o.name === arg.value) { o.visible = false; n++; } });
  } else if (arg.mode === "material") {
    R.scene.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < mats.length; i++) if (mats[i] && (mats[i].name || "").indexOf(arg.value) >= 0) { o.visible = false; n++; return; }
    });
  } else if (arg.mode === "sun") {
    R.sun.intensity = +arg.value; n = 1;
  } else if (arg.mode === "env") {
    R.scene.environmentIntensity = +arg.value; n = 1;
  } else if (arg.mode === "restore") {
    R.scene.traverse(function (o) { if (o.name !== "dungeon-gravelmaw" && o.name !== "nav-obstacles" && !/^solid-carve/.test(o.name)) o.visible = true; });
    R.sun.intensity = 3.0; R.scene.environmentIntensity = 0.5; n = 1;
  }
  return n;
})
