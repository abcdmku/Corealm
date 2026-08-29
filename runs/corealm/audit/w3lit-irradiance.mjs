// Diffuse irradiance the sky gradient puts on an up-facing and a down-facing surface, for the
// shipped stops against a candidate table. The environment map IS a light, so any change to the
// lower hemisphere has to be costed here before it is made.
const s2l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const SAT=0.45;
const OLD=[[1.000,0x4f83b8],[0.450,0x7ba7cc],[0.120,0xa5c6dc],[0.045,0xbed4de],[0.012,0xcfe0e2],[0.000,0xe3d8b7],[-0.012,0xd4dadb],[-0.250,0x9fa699],[-1.000,0x403828]];
const NEW=[[1.000,0x4f83b8],[0.450,0x7ba7cc],[0.120,0xa5c6dc],[0.045,0xbed4de],[0.012,0xcfe0e2],[0.000,0xe3d8b7],[-0.012,0xd0d9de],[-0.180,0xd0d9de],[-0.340,0x9fa699],[-1.000,0x403828]];
function sample(stops,e){
  e=Math.min(1,Math.max(-1,e));
  for(let i=0;i<stops.length-1;i++){
    const [ue,uh]=stops[i], [le,lh]=stops[i+1];
    if(e<=ue&&e>=le){
      const t=(ue-le)<=0?0:(e-le)/(ue-le);
      const a=[(lh>>16&255)/255,(lh>>8&255)/255,(lh&255)/255].map(s2l);
      const b=[(uh>>16&255)/255,(uh>>8&255)/255,(uh&255)/255].map(s2l);
      return a.map((v,c)=>v+(b[c]-v)*t);
    }
  }
  const h=stops[e>0?0:stops.length-1][1];
  return [(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
}
function desat(c){const l=0.2126*c[0]+0.7152*c[1]+0.0722*c[2];return c.map(v=>l+(v-l)*SAT);}
// Cosine-weighted hemisphere integral for a normal pointing +Y or -Y, over elevation only
// (the gradient has no azimuth), normalised so a uniform 1.0 sky gives 1.0.
function irr(stops,up){
  let s=[0,0,0],w=0;
  const N=4000;
  for(let i=0;i<N;i++){
    const theta=(i+0.5)/N*Math.PI;      // polar angle from +Y
    const y=Math.cos(theta);
    const solid=Math.sin(theta);
    const cos = up? y : -y;
    if(cos<=0) continue;
    const c=desat(sample(stops,y));
    const k=cos*solid;
    for(let j=0;j<3;j++) s[j]+=c[j]*k;
    w+=k;
  }
  return s.map(v=>v/w);
}
const f=v=>v.map(x=>x.toFixed(4)).join(", ");
console.log("up   old", f(irr(OLD,true)),  " new", f(irr(NEW,true)));
console.log("down old", f(irr(OLD,false)), " new", f(irr(NEW,false)));
// Full-sphere mean, which is what a rough surface facing sideways sees half of.
const sph=(stops)=>{let s=[0,0,0],w=0;for(let i=0;i<4000;i++){const th=(i+0.5)/4000*Math.PI;const y=Math.cos(th);const k=Math.sin(th);const c=desat(sample(stops,y));for(let j=0;j<3;j++)s[j]+=c[j]*k;w+=k;}return s.map(v=>v/w);};
console.log("sphere old", f(sph(OLD)), " new", f(sph(NEW)));
