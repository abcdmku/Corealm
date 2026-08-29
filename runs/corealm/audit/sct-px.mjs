import sharp from 'sharp';
const img = sharp('/tmp/leaves.png');
const meta = await img.metadata();
const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let r=0,g=0,b=0,n=0;
for (let i=0;i<data.length;i+=4){ if(data[i+3]<128) continue; r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++; }
console.log('size', meta.width, meta.height, 'opaque px', n, 'mean rgb', (r/n).toFixed(0), (g/n).toFixed(0), (b/n).toFixed(0));
