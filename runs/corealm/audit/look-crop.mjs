import sharp from 'sharp';
const [,,src,x,y,w,h,out,scale='3'] = process.argv;
await sharp(src).extract({left:+x,top:+y,width:+w,height:+h}).resize(+w*+scale,+h*+scale,{kernel:'nearest'}).png().toFile(out);
console.log(out);
