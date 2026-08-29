// Forward ACES (three's RRTAndODTFit) on each shipped SKY_STOP, at toneMappingExposure 1.0.
// The result is what that stop DISPLAYS as, i.e. the authored colour the pre-compensation solved for.
const STOPS=[[1.000,0x4e79ae],[0.450,0x6997cb],[0.120,0x89bdee],[0.045,0xa8d8f2],[0.012,0xc1f7ff],[0.000,0xffdf9e],[-0.012,0xcbe3f2],[-0.180,0xcbe3f2],[-0.340,0x8f9689],[-1.000,0x4a4436]];
const s2l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const l2s=c=>c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
const IN=[[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]];
const OUT=[[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]];
const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const fit=v=>v.map(x=>{const a=x*(x+0.0245786)-0.000090537,b=x*(0.983729*x+0.432951)+0.238081;return a/b;});
const aces=(lin,exp=1.0)=>{let c=lin.map(x=>x*exp/0.6);c=mul(IN,c);c=fit(c);c=mul(OUT,c);return c.map(x=>Math.min(1,Math.max(0,x)));};
const hex=v=>'0x'+v.map(x=>Math.round(Math.min(1,Math.max(0,x))*255).toString(16).padStart(2,'0')).join('');
for(const [e,h] of STOPS){
  const lin=[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
  const disp=aces(lin).map(l2s);
  console.log(`e ${String(e).padStart(6)}  ships 0x${h.toString(16).padStart(6,'0')}  displays ${hex(disp)}`);
}
