import sharp from 'sharp';
const [,, src, x, y, w, h, out, scale] = process.argv;
await sharp(src).extract({left:+x, top:+y, width:+w, height:+h}).resize({width: Math.round(+w*(+scale||3)), kernel:'nearest'}).toFile(out);
console.log('ok', out);
