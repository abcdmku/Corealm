import sharp from 'sharp';
// Mean and 5th/50th/95th percentile luminance of the frame, minus the HUD strips, so a lighting
// change can be judged as a whole frame rather than one lucky pixel.
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels; const hist = new Uint32Array(256); let n = 0; let sum = 0; let sat = 0;
  for (let y = 60; y < info.height - 80; y += 2) for (let x = 0; x < info.width; x += 2) {
    const i = (y * info.width + x) * ch;
    const r = data[i], g = data[i+1], b = data[i+2];
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[l]++; n++; sum += l;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b); sat += mx ? (mx-mn)/mx : 0;
  }
  const q = (p) => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= n * p) return i; } return 255; };
  console.log(`${f.split(/[\/]/).pop().padEnd(34)} meanY ${(sum/n).toFixed(1).padStart(6)}  p5 ${String(q(0.05)).padStart(3)}  p50 ${String(q(0.5)).padStart(3)}  p95 ${String(q(0.95)).padStart(3)}  meanSat ${(sat/n).toFixed(3)}`);
}
