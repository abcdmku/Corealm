// Predicts the pixel a given albedo lands on, under the shipped rig and the new one, so the light
// balance is chosen from numbers rather than from screenshots taken one at a time.
const s2l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const l2s=c=>c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
const lin=h=>[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
const IN=[[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]];
const OUT=[[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]];
const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const fitc=v=>v.map(x=>{const a=x*(x+0.0245786)-0.000090537,b=x*(0.983729*x+0.432951)+0.238081;return a/b;});
const aces=(c,e=1)=>mul(OUT,fitc(mul(IN,c.map(x=>x*e/0.6)))).map(x=>Math.min(1,Math.max(0,x)));
const px=(c,e=1)=>aces(c,e).map(l2s).map(x=>Math.round(x*255));

const sunDir=[58,42,34]; const L=Math.hypot(...sunDir); const dotUp=sunDir[1]/L;
const sunCoef=(hex,i)=>lin(hex).map(v=>v*i/Math.PI);
const hemiCoef=(hex,i)=>lin(hex).map(v=>v*i/Math.PI);

// Environment irradiance measured by runs/corealm/audit/sky-irradiance.mjs.
const envOldUp=[0.123,0.276,0.543];
const envNewUpRaw=[0.163,0.332,0.558];
const desat=(v,s)=>{const y=0.2126*v[0]+0.7152*v[1]+0.0722*v[2];return v.map(x=>y+(x-y)*s);};
const envNewUp=desat(envNewUpRaw,0.35).map(v=>v*0.38);

const rigs={
  shipped:{sun:sunCoef(0xffe9c4,3.0),env:envOldUp,envGround:envOldUp,hemi:hemiCoef(0x9fc4dd,0.55)},
  new:{sun:sunCoef(0xffe9c4,3.0),env:envNewUp,envGround:envNewUp.map(v=>v*0.75),hemi:hemiCoef(0xcfd6d2,0.18)},
};
const albedos={ 'grass groundLow #76854f':0x76854f, 'dirt #8e8067':0x8e8067, 'roof tile #a8402c':0xa8402c,
  'anvil dark #3a3d42':0x3a3d42, 'timber #7a6a55':0x7a6a55, 'white wall #ddd8cc':0xddd8cc };
for(const [name,rig] of Object.entries(rigs)){
  console.log('===',name,' sun dotNL(flat ground)',dotUp.toFixed(3));
  const litG=[0,1,2].map(k=>rig.sun[k]*dotUp+rig.envGround[k]+rig.hemi[k]);
  const shdG=[0,1,2].map(k=>rig.envGround[k]+rig.hemi[k]);
  const litP=[0,1,2].map(k=>rig.sun[k]*0.75+rig.env[k]+rig.hemi[k]);
  const shdP=[0,1,2].map(k=>rig.env[k]+rig.hemi[k]);
  console.log('  ground illuminant lit',litG.map(v=>v.toFixed(3)).join(','),' shadow',shdG.map(v=>v.toFixed(3)).join(','),
    ' ratio Y', ((0.2126*litG[0]+0.7152*litG[1]+0.0722*litG[2])/(0.2126*shdG[0]+0.7152*shdG[1]+0.0722*shdG[2])).toFixed(2));
  for(const [an,ah] of Object.entries(albedos)){
    const a=lin(ah);
    const ground=an.startsWith('grass')||an.startsWith('dirt');
    const lt=ground?litG:litP, sh=ground?shdG:shdP;
    console.log('   ',an.padEnd(24),'lit',px([0,1,2].map(k=>a[k]*lt[k])).join(',').padEnd(12),
      'shadow',px([0,1,2].map(k=>a[k]*sh[k])).join(','));
  }
}
