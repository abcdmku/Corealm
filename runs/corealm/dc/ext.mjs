import { chromium } from "playwright";
async function probe(name, args) {
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  await p.goto("about:blank");
  const r = await p.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return { ok: false };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ok: true,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      multiDraw: !!gl.getExtension("WEBGL_multi_draw"),
    };
  });
  console.log(name, JSON.stringify(r));
  await b.close();
}
await probe("swiftshader", ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]);
await probe("realgpu", ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]);
