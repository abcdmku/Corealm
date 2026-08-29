import sharp from 'sharp';
const [,,file,...pts] = process.argv;
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const at=(x,y)=>{const i=(y*info.width+x)*ch;return [data[i],data[i+1],data[i+2]];};
const box=(x,y,r)=>{let s=[0,0,0],n=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=info.width||yy>=info.height)continue;const p=at(xx,yy);s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];n++;}return s.map(v=>Math.round(v/n));};
console.log(file, info.width+'x'+info.height);
for (const p of pts){const [x,y,r='3',label='']=p.split(',');const v=box(+x,+y,+r);
  const mx=Math.max(...v),mn=Math.min(...v);
  console.log(`  ${(label||p).padEnd(16)} (${x},${y}) rgb ${v.join(',').padEnd(12)} sat ${(mx?((mx-mn)/mx):0).toFixed(2)} b-r ${v[2]-v[0]}`);}
