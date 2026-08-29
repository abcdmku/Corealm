import sharp from 'sharp';
const [,,file,x,y,w,h,scale='4',out='runs/corealm/screenshots/lit-crop.png'] = process.argv;
await sharp(file).extract({ left:+x, top:+y, width:+w, height:+h }).resize(+w*+scale, +h*+scale, { kernel:'nearest' }).toFile(out);
console.log('wrote', out);
