// Solves the `background` column of SKY_STOPS: given the colour a stop should DISPLAY as, bisect
// the sRGB hex that three's ACESFilmic tone mapping at exposure 1.0 maps onto it. Inverse of
// runs/corealm/audit/aces-fit.mjs, which checks the forward direction.
const s2l=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const l2s=c=>c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
const IN=[[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]];
const OUT=[[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]];
const mul=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const fit=v=>v.map(x=>{const a=x*(x+0.0245786)-0.000090537,b=x*(0.983729*x+0.432951)+0.238081;return a/b;});
const aces=(lin,exp=1.0)=>{let c=lin.map(x=>x*exp/0.6);c=mul(IN,c);c=fit(c);c=mul(OUT,c);return c.map(x=>Math.min(1,Math.max(0,x)));};
const hex2lin=h=>[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255].map(s2l);
const lin2hex=v=>v.map(x=>Math.round(Math.min(1,Math.max(0,x))*255).toString(16).padStart(2,'0')).join('');

// Bisect per channel is not exact because ACES mixes channels, so iterate the whole triple.
function solve(target){
  const want = hex2lin(target);           // linear colour we want on screen after ACES+sRGB
  let guess = want.slice();
  for(let i=0;i<80;i++){
    const got = aces(guess);
    for(let c=0;c<3;c++){
      const err = want[c]-got[c];
      guess[c] = Math.max(0, guess[c] + err*0.8);
    }
  }
  return guess;
}
for(const arg of process.argv.slice(2)){
  const target = parseInt(arg,16);
  const lin = solve(target);
  const shipHex = lin2hex(lin.map(l2s));
  const back = aces(hex2lin(parseInt(shipHex,16))).map(l2s);
  console.log(`want 0x${arg}  ship 0x${shipHex}  round-trips to 0x${lin2hex(back)}`);
}
