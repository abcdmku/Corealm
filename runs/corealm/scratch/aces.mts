const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m: number[][], v: number[]): number[] => m.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const fit = (v: number): number => {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
};
const s2l = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexToLinear = (hex: number): number[] => [16, 8, 0].map((s) => s2l(((hex >> s) & 255) / 255));
const linearToHex = (v: number[]): string =>
  "#" + v.map((c) => Math.round(Math.min(1, Math.max(0, l2s(c))) * 255).toString(16).padStart(2, "0")).join("");
const aces = (lin: number[], exposure: number): number[] => {
  let c = lin.map((x) => x * exposure / 0.6);
  c = mul(IN, c);
  c = c.map(fit);
  c = mul(OUT, c);
  return c.map((x) => Math.min(1, Math.max(0, x)));
};
const acesInverseSearch = (targetHex: number, exposure: number): string => {
  // Crude per-channel bisection on the authored sRGB value until ACES output matches the target.
  const target = hexToLinear(targetHex);
  let lo = [0, 0, 0];
  let hi = [4, 4, 4];
  for (let step = 0; step < 60; step += 1) {
    const mid = lo.map((v, i) => (v + hi[i]!) / 2);
    const out = aces(mid, exposure);
    for (let i = 0; i < 3; i += 1) {
      if (out[i]! < target[i]!) lo[i] = mid[i]!; else hi[i] = mid[i]!;
    }
  }
  return linearToHex(lo.map((v, i) => (v + hi[i]!) / 2));
};
const exposure = 1.0;
for (const hex of [0x4f83b8, 0x7ba7cc, 0xa9c6dc, 0xcfe0e8, 0xe8d8b8, 0x9a8c72, 0x4a4436, 0xb8cfe0]) {
  console.log("authored", "#" + hex.toString(16).padStart(6, "0"), "-> displayed", linearToHex(aces(hexToLinear(hex), exposure)));
}
console.log("--- to DISPLAY these, author these ---");
for (const hex of [0x4f83b8, 0x7ba7cc, 0xa9c6dc, 0xcfe0e8, 0xe8d8b8, 0xb8cfe0]) {
  console.log("want", "#" + hex.toString(16).padStart(6, "0"), "-> author", acesInverseSearch(hex, exposure));
}
