// three 0.185 ACESFilmicToneMapping, ported exactly, to find the linear value at which the frame
// clips to 255 and to convert measured screen bytes back to the linear radiance behind them.
const IN = [[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]];
const OUT = [[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]];
const mul = (m, v) => m.map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2]);
const fit = (v) => v.map(x => { const a = x*(x+0.0245786)-0.000090537, b = x*(0.983729*x+0.4329510)+0.238081; return a/b; });
const sat = (v) => v.map(x => Math.min(1, Math.max(0, x)));
const lin2srgb = (x) => x <= 0.0031308 ? x*12.92 : 1.055*Math.pow(x,1/2.4)-0.055;
export function aces(rgb, exposure = 1.0) {
  const c = rgb.map(x => x * exposure / 0.6);
  return sat(mul(OUT, fit(mul(IN, c)))).map(x => Math.round(lin2srgb(x)*255));
}
if (process.argv[1].endsWith('lit-aces.mjs')) {
  const exp = +(process.argv[2] ?? 1.0);
  console.log('exposure', exp, '(three multiplies by exposure/0.6, so effective gain', (exp/0.6).toFixed(3) + ')');
  for (const v of [0.05,0.1,0.2,0.3,0.5,0.75,1.0,1.1,1.25,1.5,2.0,2.5,3.2,5.0]) {
    console.log('  linear', String(v).padEnd(5), '->', aces([v,v,v], exp).join(','));
  }
  // Bisect the neutral value at which every channel reaches 255.
  let lo = 0.1, hi = 20;
  for (let i = 0; i < 60; i++) { const m = (lo+hi)/2; if (aces([m,m,m], exp)[0] >= 255) hi = m; else lo = m; }
  console.log('  clips to 255 at linear', hi.toFixed(3));
  let lo2 = 0.1, hi2 = 20;
  for (let i = 0; i < 60; i++) { const m = (lo2+hi2)/2; if (aces([m,m,m], exp)[0] >= 250) hi2 = m; else lo2 = m; }
  console.log('  reaches 250 at linear', hi2.toFixed(3));
}
