(function (arg) {
  var hook = window.__probeRenderer;
  if (!hook) return "no hook";
  var R = hook.r;
  var n = 0;
  R.scene.traverse(function (o) {
    if (o.name === arg.name) { o.visible = arg.visible; n++; }
  });
  return "toggled " + n + " named " + arg.name + " to visible=" + arg.visible;
})
