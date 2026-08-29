import { createDetailAtlas, createMacroVariation, disposeGeneratedTextures } from "../../../game/src/render/proceduralTextures.js";
for (let i=0;i<3;i++){
  disposeGeneratedTextures();
  let t=performance.now(); createDetailAtlas(); const a=performance.now()-t;
  t=performance.now(); createMacroVariation(); const m=performance.now()-t;
  console.log(`atlas ${a.toFixed(1)} ms  macro ${m.toFixed(1)} ms`);
}
