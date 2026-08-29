const s2l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const l2s=c=>c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
const lin=h=>[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
const IN=[[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]];
const OUT=[[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]];
const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const fitc=v=>v.map(x=>{const a=x*(x+0.0245786)-0.000090537,b=x*(0.983729*x+0.432951)+0.238081;return a/b;});
const px=c=>mul(OUT,fitc(mul(IN,c.map(x=>x/0.6)))).map(x=>Math.min(1,Math.max(0,x))).map(l2s).map(x=>Math.round(x*255));
const Y=v=>0.2126*v[0]+0.7152*v[1]+0.0722*v[2];
const desat=(v,s)=>{const y=Y(v);return v.map(x=>y+(x-y)*s);};
const envUp=[0.163,0.332,0.558];
const dotUp=42/Math.hypot(58,42,34);
const grass=lin(0x76854f), wall=lin(0xddd8cc), anvil=lin(0x3a3d42);
for (const sat of [0.3,0.45,0.6]) for (const inten of [0.38,0.5,0.62]) for (const hemiI of [0.18,0.3]) {
  const sun=lin(0xffe9c4).map(v=>v*3.0/Math.PI);
  const env=desat(envUp,sat).map(v=>v*inten);
  const hemi=lin(0xcfd6d2).map(v=>v*hemiI/Math.PI);
  const litG=[0,1,2].map(k=>sun[k]*dotUp+env[k]*0.75+hemi[k]);
  const shdG=[0,1,2].map(k=>env[k]*0.75+hemi[k]);
  const shdP=[0,1,2].map(k=>env[k]+hemi[k]);
  const gl=px([0,1,2].map(k=>grass[k]*litG[k])), gs=px([0,1,2].map(k=>grass[k]*shdG[k]));
  const ws=px([0,1,2].map(k=>wall[k]*shdP[k])), as=px([0,1,2].map(k=>anvil[k]*shdP[k]));
  console.log(`sat ${sat} int ${inten} hemi ${hemiI} | grassLit ${gl.join(',').padEnd(12)} grassShd ${gs.join(',').padEnd(12)} ratio ${(Y(litG)/Y(shdG)).toFixed(2)} | wallShd ${ws.join(',').padEnd(12)} b-r ${ws[2]-ws[0]} | anvilShd ${as.join(',')}`);
}
