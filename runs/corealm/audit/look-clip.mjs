import sharp from 'sharp';
// Counts fully-clipped pixels (all three channels >= 250) outside the HUD strips. The chimney
// smoke sprite is the only thing in these frames that reaches that value.
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels; let clipped = 0; let near = 0; let n = 0;
  for (let y = 60; y < info.height - 90; y += 1) for (let x = 0; x < info.width; x += 1) {
    const i = (y * info.width + x) * ch; n++;
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r >= 250 && g >= 250 && b >= 250) clipped++;
    else if (r >= 235 && g >= 235 && b >= 235) near++;
  }
  console.log(`${f.split(/[\/]/).pop().padEnd(32)} clipped>=250 ${String(clipped).padStart(6)}  235-249 ${String(near).padStart(6)}  of ${n}`);
}
