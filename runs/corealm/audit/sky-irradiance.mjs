// Numerically integrates the authored sky gradient into diffuse irradiance for a few normals,
// so the environment's contribution can be compared against the sun and the hemisphere light.
const STOPS_COMP = [
  [1.000, 0x4e79ae],[0.450,0x6997cb],[0.120,0x89bdee],[0.045,0xa8d8f2],
  [0.012,0xc1f7ff],[0.000,0xffdf9e],[-0.012,0xd6e6ea],[-0.250,0x8f9689],[-1.000,0x4a4436],
];
const STOPS_AUTH = [
  [1.000, 0x4f83b8],[0.450,0x7ba7cc],[0.120,0xa9c6dc],[0.045,0xbdd6e4],
  [0.012,0xcfe0e8],[0.000,0xe8d8b8],[-0.012,0xc4d2d6],[-0.250,0x7a8076],[-1.000,0x4a4436],
];
const s2l = c => c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4);
const hex2lin = h => [(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
function sample(stops,e){ e=Math.min(1,Math.max(-1,e));
  for(let i=0;i<stops.length-1;i++){const [ue,uc]=stops[i],[le,lc]=stops[i+1];
    if(e<=ue&&e>=le){const t=(ue-le)<=0?0:(e-le)/(ue-le);const a=hex2lin(lc),b=hex2lin(uc);
      return [0,1,2].map(k=>a[k]+(b[k]-a[k])*t);}}
  return hex2lin(stops[e>0?0:stops.length-1][1]); }
function irradiance(stops, n){ // cosine-weighted hemisphere integral / PI  -> average radiance
  let sum=[0,0,0], w=0; const N=200;
  for(let i=0;i<N;i++) for(let j=0;j<2*N;j++){
    const th=(i+0.5)/N*Math.PI, ph=(j+0.5)/(2*N)*2*Math.PI;
    const d=[Math.sin(th)*Math.cos(ph), Math.cos(th), Math.sin(th)*Math.sin(ph)];
    const c = d[0]*n[0]+d[1]*n[1]+d[2]*n[2]; if(c<=0) continue;
    const dw = Math.sin(th)*(Math.PI/N)*(2*Math.PI/(2*N));
    const L = sample(stops, d[1]); // elevation = y for a unit dir
    sum=[0,1,2].map(k=>sum[k]+L[k]*c*dw); w+=c*dw; }
  return sum.map(v=>v/Math.PI); }
const fmt=v=>v.map(x=>x.toFixed(3)).join(', ');
for (const [name,stops] of [['ACES-precompensated (what ships)',STOPS_COMP],['authored (what displays)',STOPS_AUTH]]){
  console.log('---',name);
  for(const [ln,n] of [['up      ',[0,1,0]],['side    ',[1,0,0]],['down    ',[0,-1,0]],['45 up   ',[0.707,0.707,0]]]){
    const E=irradiance(stops,n); console.log('  E',ln,fmt(E),' b-r',(E[2]-E[0]).toFixed(3)); }
}
// sun for comparison: diffuse = albedo * color*intensity/PI * dotNL
const sun = hex2lin(0xffe9c4).map(v=>v*3.0/Math.PI);
console.log('--- sun 0xffe9c4 @3.0, diffuse coefficient at dotNL=1:', fmt(sun));
const hemiSky = hex2lin(0x9fc4dd).map(v=>v*0.55/Math.PI);
const hemiGnd = hex2lin(0x4a4436).map(v=>v*0.55/Math.PI);
console.log('--- hemi 0.55 sky coeff:', fmt(hemiSky), ' ground coeff:', fmt(hemiGnd));
