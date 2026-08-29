// Measures clipped-white, pure-black and near-black pixel populations plus the brightest blob
// locations in a screenshot. Used to establish WHICH thing clips white in the settlement shots.
import sharp from 'sharp';
const files = process.argv.slice(2);
for (const file of files) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, W = info.width, H = info.height;
  // Ignore the HUD strips: top 60 px, bottom 110 px, and the right 160 px badge.
  const inHud = (x, y) => y < 60 || y > H - 110 || (y < 60) || (x > W - 200 && y < 60);
  let clip = 0, near = 0, black = 0, dark = 0, total = 0;
  const blobs = [];
  const blackBlobs = [];
  for (let y = 60; y < H - 110; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total += 1;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mn >= 252) { clip += 1; blobs.push([x, y]); }
      else if (mn >= 240) near += 1;
      if (mx === 0) { black += 1; blackBlobs.push([x, y]); }
      else if (mx <= 12) dark += 1;
    }
  }
  const cluster = (pts) => {
    const out = [];
    for (const [x, y] of pts) {
      let hit = null;
      for (const c of out) if (Math.abs(c.cx - x) < 40 && Math.abs(c.cy - y) < 40) { hit = c; break; }
      if (hit) { hit.n += 1; hit.sx += x; hit.sy += y; hit.cx = hit.sx / hit.n; hit.cy = hit.sy / hit.n; }
      else out.push({ n: 1, sx: x, sy: y, cx: x, cy: y });
    }
    return out.sort((a, b) => b.n - a.n).slice(0, 8).map(c => `(${Math.round(c.cx)},${Math.round(c.cy)})x${c.n}`);
  };
  console.log(file.split(/[\/]/).pop(), `${W}x${H}`);
  console.log(`  clipped(min>=252) ${clip} px ${(100*clip/total).toFixed(3)}%  near(min>=240) ${near}`);
  console.log(`  pureblack(max==0) ${black} px ${(100*black/total).toFixed(3)}%  vdark(max<=12) ${dark}`);
  if (clip) console.log('  white blobs:', cluster(blobs).join(' '));
  if (black) console.log('  black blobs:', cluster(blackBlobs).join(' '));
}
