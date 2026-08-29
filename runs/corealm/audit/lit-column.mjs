// Vertical scan of a screenshot column: the sky gradient and where the horizon band sits.
import sharp from 'sharp';
const [,,file,colArg='720',step='8'] = process.argv;
const col = +colArg;
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const at = (x, y) => { const i = (y * info.width + x) * ch; return [data[i], data[i+1], data[i+2]]; };
const row = (y) => { let s=[0,0,0]; for (let x=col-6;x<=col+6;x++){const p=at(x,y);s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];} return s.map(v=>Math.round(v/13)); };
console.log(file.split(/[\/]/).pop(), 'column', col);
let prev = null;
for (let y = 60; y < info.height - 110; y += +step) {
  const v = row(y);
  const d = prev ? Math.abs(v[0]-prev[0])+Math.abs(v[1]-prev[1])+Math.abs(v[2]-prev[2]) : 0;
  console.log(`  y=${String(y).padStart(3)} ${v.join(',').padEnd(12)} dSum ${d}`);
  prev = v;
}
